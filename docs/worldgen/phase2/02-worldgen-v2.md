# Đợt 2 — Worldgen 2.0.0: B2 hồ, B4 composition núi

Trạng thái: **kế hoạch** (2026-10-24). Phần kết quả sẽ được bổ sung vào cuối file sau khi triển khai.
Quyết định của anh ngày 2026-10-24 (duyệt Đợt 1 có điều kiện) là đầu vào của kế hoạch này.

## 1. Nguyên tắc

- Mỗi thay đổi chỉ chạm một stage:
  - B2 chỉ sửa stage `hydrology` (chọn hồ, hình học hồ, thuộc tính hồ).
  - B4 chỉ sửa stage `composition`. Stage `ridges` chỉ thêm dữ liệu đọc ra, không đổi thuật toán.
- **Không đổi `terrain`**: hash stage terrain của 20 seed phải giữ nguyên so với golden v1. Bờ biển, núi, độ cao không đổi, nên mọi khác biệt trên ảnh đến từ B2/B4.
- Không thêm dependency. Không random không seed. Mọi thứ tự duyệt có thứ tự chuẩn.
- Bất biến thuỷ văn giữ nguyên: một receiver cho mỗi ô, acyclic, cân bằng lưu lượng, mỗi hồ một cửa ra, không có X-crossing trên sông.
- Z1 là một vùng của thế giới lớn: không ép sông ra biển; sông ra biên giữ `regionBoundary`.
- Lưu bạch: không thêm stamp để lấp chỗ trống; đồng bằng và thung lũng được phép trống.

## 2. B2 — Hồ

### Hiện trạng v1 (số đo trên 20 seed)

| Chỉ số | v1 |
|---|---|
| Số hồ | 160 |
| Hồ móc câu/lưỡi liềm (độ đặc ô < 0,7) | 34 |
| Hồ dài tự nhiên (độ dãn ≥ 2,2 và độ đặc ≥ 0,75) | 17 |
| Hồ thung lũng dài (loại thung lũng, độ dãn ≥ 1,8) | 30/58 |
| Hồ nông (sâu nhất < 0,03) | 63 |
| Hồ không có sông đổ vào | 54 |
| Hồ có lưu vực < 5 lần diện tích | 29 |

Nguyên nhân (Giai đoạn 1): hố nông trong fBm tần số cao và trên ô đỉnh ridged. Mọi hố sâu hơn 0,01 và rộng ≥ 12 ô đều thành hồ, nước dâng tới mép tràn, nên đường bờ là một đường đồng mức của địa hình nhiễu: móc câu, lưỡi liềm.

### Thay đổi

1. **Chọn hồ theo cân bằng nước.** Tính lưu vực của mỗi vùng trũng trên đồ thị dòng chảy trước khi tạo hồ (topoOrder + accumulate, như sau này).
   - Diện tích mặt nước tối đa = lưu vực / R, với R = 4 (`lakeCatchmentRatio`). Mặt nước còn bị giới hạn bởi `maxLakeArea` như cũ.
   - Lưu vực nhỏ thì hồ nhỏ hoặc không có hồ. Lưu vực lớn (thung lũng có sông) thì hồ lấp đầy chỗ trũng, nên hồ dài tự nhiên được giữ.
2. **Hình học: mặt nước là phần sâu nhất, không phải cả vùng trũng.**
   - Lấy các ô sâu nhất trước, liên thông 4 hướng với ô sâu nhất, tới khi đạt diện tích cho phép.
   - Bỏ các nhánh rộng 1 ô (ô chỉ có ≤ 1 láng giềng hồ, lặp lại).
   - Lấp lỗ ≤ 2 ô bên trong.
   - Phần trũng nông còn lại là đất ngập (cùng mực `filled`), thoát nước theo cây flood như cơ chế `maxLakeArea` đang làm. Không ép hồ tròn: đường bờ vẫn là đường đồng mức thật, chỉ ở độ sâu lớn hơn, nơi địa hình trơn hơn.
3. **Thuộc tính hồ vào worldgen.** `Lake` thêm:
   - `surface`: mực nước thật, có thể thấp hơn mép tràn.
   - `maxDepth`.
   - `catchment`.
   - `kind`: núi / thung lũng / đồng bằng, cùng luật đang dùng ở `hydroView`.
   - `outletType`: `river` / `lake` / `ocean` / `regionBoundary`, theo nơi cửa ra dẫn tới.

   `hydroView` đọc từ worldgen thay vì tự tính.
4. **Trường hợp tsvl-18 (A4).** Em đã kiểm trên v1:
   - Hồ 2 tràn qua đúng một ô sông vào hồ 3, nên đây là kết nối nước có thật.
   - Hai hồ cách nhau 1 ô nên lượt làm mờ nối liền chúng trên ảnh.
   - `analyze.ts` gán pixel cho mọi hồ trong vòng 2 ô, nên phần giữa bị đếm hai lần.

   Kết luận: cả ba yếu tố cùng góp vào. Em sẽ:
   - Sửa cách gán pixel thành "hồ gần nhất". Đây là sửa lỗi đo, không đổi ngưỡng; em báo cả số theo cách đo cũ lẫn mới.
   - Thêm test hồi quy tổng hợp: hai hồ cách 1 ô có sông nối thì được phép liền trên ảnh; không có sông nối thì phải có một dải đất ngăn.
   - Ghi lại số liệu v1 của tsvl-18 trong test.

### Tiêu chí nghiệm thu B2 (đặt trước khi làm)

| # | Tiêu chí | Ngưỡng |
|---|---|---|
| L1 | Bất biến thuỷ văn (`checkHydrology`, test hydrology hiện có) | 0 lỗi trên 20 seed |
| L2 | Hồ móc câu (độ đặc ô < 0,7) | ≤ 10% số hồ (v1: 21%) |
| L3 | Hồ dài tự nhiên (độ dãn ≥ 2,2, độ đặc ≥ 0,75) | ≥ 14 (80% của 17) |
| L4 | Cân bằng nước | mọi hồ: lưu vực ≥ 4 × diện tích |
| L5 | Không mất hồ hẹp khi render (A4, cách gán mới) | mọi hồ 0,85–1,4 |
| L6 | Hồ thung lũng dài | ≥ 80% số v1 (≥ 24) |
| L7 | Bờ không còn nhánh 1 ô | 0 ô hồ có ≤ 1 láng giềng hồ |

### Đánh giá A3 đề xuất (theo yêu cầu của anh)

Thay "trung bình hồ núi tối hơn trung bình hồ đồng bằng ≥ 4 L*" bằng hai phép đo tách biệt:

1. **Độ sâu là yếu tố chính.** Trong từng loại hồ, L* giảm theo độ sâu: hệ số dốc âm, và nhóm độ sâu sâu nhất tối hơn nhóm nông nhất ≥ 4 L*.
2. **Loại hồ ở cùng độ sâu.** Chia ô hồ theo 4 nhóm độ sâu (0–0,02, 0,02–0,04, 0,04–0,06, > 0,06). Trong mỗi nhóm có ≥ 30 mẫu của cả hai loại: hồ núi tối hơn hồ đồng bằng ≥ 2 L* và không ngược chiều ở nhóm nào.

Em sẽ đo cả cách cũ và cách mới, nhưng chỉ dùng cách mới làm tiêu chí khi anh đồng ý.

### Kết quả B2 (2026-10-24)

Đo trên 20 seed cũ. "Trước" là v1 (worldgen 1.0.0, ảnh Đợt 1); "sau" là B2 (2.0.0). Bảng đầy đủ: `qa-out/wave2-b2/lake-criteria.txt`.

| # | Tiêu chí | v1 | B2 | Đạt |
|---|---|---|---|---|
| L1 | Bất biến thuỷ văn | 0 lỗi | 0 lỗi | ✓ |
| L2 | Hồ móc câu ≤ 10% | 34/160 (21,2%) | 12/135 (8,9%) | ✓ |
| L3 | Hồ dài tự nhiên ≥ 14 | 17 | 20 | ✓ |
| L4 | Lưu vực ≥ 4 × diện tích | (không đo) | 135/135 | ✓ |
| L5 | Tỉ lệ diện tích render 0,85–1,4 | 1,01–1,427 (cách gán cũ) | 1,026–1,127 (hồ gần nhất) | ✓ |
| L6 | Hồ thung lũng dài ≥ 24 | 30 | 37 | ✓ (xem ghi chú 3) |
| L7 | 0 ô hồ có ≤ 1 láng giềng | (không đo) | 0 | ✓ |

**Khác với kế hoạch** (em ghi rõ để anh xét):

1. **Mực nước dừng ở yên ngựa giữa hai lòng chảo** (thêm mới, tham số `lakeSaddleDepth` = 0,005). Chỉ cân bằng nước thì chưa đủ: phần lớn hồ móc câu có lưu vực rất lớn, nên nước vẫn lấp cả vùng trũng cong (L2 còn 17%). Quy tắc mới: nước dâng từ ô thấp nhất; khi vượt một yên ngựa sang lòng chảo khác sâu hơn 0,005 dưới yên ngựa và rộng ít nhất nửa `minLakeArea` (6 ô), hồ dừng ở yên ngựa. Lòng chảo kia thành đất trũng cùng mực `filled`. Chỗ lõm nhỏ trên đáy một lòng sông dài không bị tính, nên hồ dài vẫn giữ (L3 tăng từ 17 lên 20).
   - Về vật lý: với lượng nước dư, hai lòng chảo sẽ nhập lại. Mô hình không có thể tích hay bốc hơi, nên đây là lựa chọn để mặt hồ là một lòng chảo đọc được, không phải mô phỏng.
   - Em đã quét tham số và báo đủ đường cong, không chọn riêng điểm đẹp: độ sâu yên ngựa 0,005 / 0,01 / 0,02 → hồ móc câu 6,3% / 11,2% / 15,6% (với điều kiện mọi lòng chảo); kích thước lòng chảo tối thiểu 4 / 6 / 8 / 12 ô → 7,7% / 8,2% / 9,7% / 11,9%.
   - Cái giá: diện tích mặt hồ tổng giảm 29% (9 858 → 7 013 ô) và số hồ giảm 160 → 135. Ví dụ tsvl-18 hồ 1 từ 183 ô (móc câu) còn 42 ô ở lòng chảo sâu nhất.
2. **Bờ hồ:** bỏ nhánh rộng 1 ô như kế hoạch. Thêm một bước: ở một mũi nhọn 1 ô trên thân hồ rộng ≥ 2 ô, ô góc bên cạnh (cùng vùng trũng, cùng mực `filled`) được lấp trước khi cắt, trong ngân sách nước. Không có bước này, đầu nhọn của hồ dài bị cắt dần và L3 tụt còn 13.
3. **L6:** bộ phân loại "thung lũng" (giữ nguyên từ Đợt 1) đòi độ dãn ≥ 1,8 hoặc bờ dốc, nên hầu hết hồ thung lũng đều dài theo định nghĩa. Đo theo luật cũ của `analyze.ts` (luật dùng cho số 30 của v1) thì B2 có 28 hồ thung lũng dài, vẫn ≥ 24.
4. **Lấp lỗ ≤ 2 ô:** không làm. Sau B2 chỉ còn 3 đảo 1 ô trên 20 seed, đều là đất cao hơn mặt nước thật, nên em giữ làm đảo.
5. **`outletType`:** `none` / `ocean` / `lake` / `regionBoundary`. Bỏ giá trị `river` trong kế hoạch vì mọi cửa ra đều chảy qua sông hoặc đổ thẳng; điều cần biết là nước đi về đâu. 20 seed: 53 hồ ra biển, 42 hồ đổ vào hồ khác, 40 hồ ra biên vùng.

**tsvl-18 (A4).** Đo lại v1 bằng cách gán mới: hồ 3 có tỉ lệ 1,087 (cách cũ 1,427), hồ 2 là 1,095 (cách cũ 1,348). Vậy con số 1,427 là lỗi gán pixel, chồng lên một kết nối nước có thật mà lượt làm mờ nối liền trên ảnh. Ở B2, hồ 3 chỉ có lưu vực 44 ô nên không còn là mặt nước (cân bằng nước cho tối đa 11 ô). Test `tests/lakes.test.ts` ghi lại các số v1 này và kiểm trên cả 20 seed: hai hồ chỉ được liền nhau trên ảnh khi hồ này đổ vào hồ kia.

**Độ sâu và loại hồ.** Độ sâu render giờ tính từ mặt nước thật (`surface` = ô hồ cao nhất), không từ mép tràn. Hồ nông hơn trước nên nhạt hơn: 47 hồ có độ sâu tối đa < 0,02 (đo cũ của v1: 14). Loại hồ do worldgen tính bằng cùng luật của `hydroView` nhưng trên `surface`: núi 42, thung lũng 37, đồng bằng 56 (v1 theo `hydroView`: 60 / 40 / 60).

## 3. B4 — Composition núi

### Hiện trạng v1

- 69–86% stamp đến từ hai lưới đều (lưới massif 3 ô, lưới đồi 4 ô).
- Họ dáng chọn theo hash vị trí.
- `tone` (xa/giữa/gần) ngẫu nhiên.
- Phủ stamp theo vùng (trung bình 20 seed): núi 90,5%, cao nguyên 81,5%, chân núi 63,4%, thung lũng 23,0%, đồng bằng/đồi trống 32,6%, ven biển 11,8%.

### Cấu trúc mới (mỗi massif = một cluster của `ridges`)

1. **Chủ phong:** đỉnh cao nhất, `mountain.main`. Họ theo địa hình quanh đỉnh:
   - **đỉnh bằng** nếu vùng trong 0,03 của độ cao đỉnh rộng ≥ 6 ô;
   - **vách** nếu độ dốc hai sườn đông/tây chênh ≥ 2 lần;
   - còn lại là **chóp**.
2. **Khách phong:** các đỉnh khác của cluster, `mountain.tall`, cùng bộ phân loại. Tỉ lệ theo độ cao tương đối.
3. **Sống núi chính:** các path ridge dẫn tới đỉnh, xếp stamp nối tiếp như hiện nay (giữ V4).
   - Đoạn chạy ngang (đông–tây) dùng họ **dãy** (`mountain.main`/`mountain.low`).
   - Đoạn chạy dọc (bắc–nam) dùng **chóp/vách** hẹp (`mountain.tall`) xếp chồng. Nhìn từ trên xuống với núi dựng đứng, một sống dọc phải hiện thành chuỗi đỉnh chồng nhau, không phải một dải ngang.
4. **Nhánh núi:** path ridge ngắn hơn, nhập vào sống chính. Dùng `mountain.low`, họ dãy hoặc vách theo độ lệch sườn, tỉ lệ giảm dần về đầu nhánh.
5. **Đỉnh phụ thay lưới massif:** cực đại địa phương nhỏ (bán kính 2, chênh ≥ 0,02) trên vùng núi chưa có stamp cấu trúc nào phủ.
   - Vị trí lấy từ địa hình, không từ lưới.
   - Khoảng cách theo footprint, duyệt theo độ cao giảm dần với thứ tự chuẩn.
6. **Chân núi thay lưới đồi:**
   - Đồi (`hill`) chỉ đặt trong dải chân núi (cách nền núi ≤ 6 ô), dọc theo dải đó, thưa dần ra ngoài.
   - Đồng bằng và đồi trống xa núi không đặt stamp.
7. **Thung lũng:** footprint không được cách sông lớn (≥ 3 × ngưỡng) dưới 1 ô trong vùng núi, để thung lũng sông đọc được.
8. **Lớp mực theo cấu trúc:**
   - gần (+1): chủ phong và stamp phía nam (phía người xem) của massif;
   - xa (−1): stamp phía bắc và đầu nhánh;
   - giữa (0): còn lại.
9. **Họ dáng trở thành logic:**
   - `manifest.assets[key].logic.variantFamilies` liệt kê họ của 12 biến thể. Worldgen đọc nó để chọn biến thể trong đúng họ. Art đọc cùng danh sách, không còn ở `visual`.
   - Chống lặp (V3) áp dụng trong họ. Hết biến thể trong họ thì lùi sang họ gần nhất theo bảng cố định.

### Tiêu chí nghiệm thu B4 (đặt trước khi làm)

| # | Tiêu chí | Ngưỡng |
|---|---|---|
| M1 | V2: mỗi dãy ≥ 3 núi có đúng một chủ phong; không footprint trên nước | 20/20 seed |
| M2 | V3: không biến thể lặp kề nhau; không biến thể > 25% một nhóm | 20/20 seed |
| M3 | V4: ≥ 90% cặp stamp kề nhau trên sống chồng 20–45% | giữ nguyên |
| M4 | Stamp từ lưới đều | ≤ 30% tổng stamp (v1: 69–86%) |
| M5 | Họ dáng theo vai trò | 100% stamp có họ do bộ phân loại địa hình/hướng sống chọn (test so khớp) |
| M6 | Thung lũng mở | 0 footprint trong 1 ô của sông lớn ở vùng núi |
| M7 | Mật độ theo vùng (thay V6), trung bình 20 seed | núi 70–95%; cao nguyên 40–85%; chân núi 25–60%; thung lũng ≤ 12%; đồng bằng/đồi trống ≤ 15%; ven biển ≤ 12% |
| M8 | Không seed nào lấp đồng bằng | đồng bằng ≤ 25% ở mọi seed |
| M9 | Lớp mực theo chiều sâu | ở ≥ 90% massif có cả hai lớp: y trung bình của lớp xa < lớp gần |

Ngưỡng M7 lấy từ hiện trạng v1 và ý định lưu bạch: giữ khối núi đặc, kéo đồng bằng và thung lũng xuống. Nếu anh muốn khoảng khác, em đổi trước khi đo.

## 4. Hiệu năng, tính tất định, version

- `WORLDGEN_VERSION` = 2.0.0 ngay khi commit worldgen đầu tiên của Đợt 2.
- Golden:
  - `golden/worldgen-v1.json` giữ nguyên, không sửa. Test kiểm file này không đổi.
  - Trong Đợt 2, hash v2 ghi vào `golden/worldgen-v2.candidate.json`, dùng để so Node = worker = main.
  - Chỉ đổi tên thành `golden/worldgen-v2.json` sau khi anh nghiệm thu.
- Hash stage `terrain` của 20 seed phải bằng v1 (test riêng).
- Thời gian sinh (Node, trung vị 20 seed) tăng ≤ 20% so với 56,5 ms. Worker và `buildMs` báo kèm.
- Test thứ tự ứng viên và thứ tự chunk (composition) giữ nguyên.

## 5. File dự kiến sửa

| File | B2 | B4 | Ghi chú |
|---|---|---|---|
| `src/worldgen/config.ts` | ✓ | ✓ | version 2.0.0; tham số mới: `lakeCatchmentRatio`, khoảng cách footprint, ngưỡng đỉnh phụ |
| `src/worldgen/hydrology.ts` | ✓ | | chọn hồ, hình học, thuộc tính hồ |
| `src/worldgen/composition.ts` | | ✓ | cấu trúc massif, chọn họ, tone |
| `src/worldgen/index.ts` | ✓ | | ghi thuộc tính hồ mới vào stream hydrology |
| `src/assets/manifest.json`, `manifestTypes.ts` | | ✓ | `logic.variantFamilies` |
| `src/render/hydroView.ts`, `stampArt.ts` | ✓ | ✓ | đọc dữ liệu từ worldgen |
| `src/qa/metrics.ts` | ✓ | ✓ | chỉ số hồ, mật độ vùng (đã thêm `regionDensity`), nguồn stamp |
| `tests/*` | ✓ | ✓ | thay test V6 bằng M7/M8; thêm L1–L7, M4–M9, test terrain không đổi, test tsvl-18 |
| `scripts/analysis/analyze.ts` | ✓ | | gán pixel hồ theo hồ gần nhất |

## 6. Thứ tự triển khai

1. **Chuẩn bị.**
   - Gắn tag git `worldgen-v1` ở commit 552db23.
   - Lưu ảnh và số liệu v1 làm "trước": dùng bộ ảnh Đợt 1, cùng renderer.
   - Đặt version 2.0.0 và cơ chế golden candidate.
2. **B2** (một commit): hydrology, thuộc tính hồ, test, đo L1–L7, chụp 20 seed.
3. **B4a**: họ dáng thành logic, chọn họ cho chủ phong và khách phong theo địa hình.
4. **B4b**: sống chính và nhánh theo hướng; đỉnh phụ thay lưới massif.
5. **B4c**: dải chân núi thay lưới đồi; hành lang thung lũng; tone theo cấu trúc.
6. **QA cuối:**
   - 20 seed × 3 zoom cùng camera.
   - Node / Chromium / worker.
   - Thời gian sinh.
   - Ảnh Z1 để anh quyết độ đậm núi.
   - Báo cáo tách sáu phần: địa hình, thuỷ văn, composition núi, hiệu năng, tất định, lỗi hình ảnh còn lại.

Sau mỗi bước em chạy toàn bộ test và đo lại; ảnh trước/sau ở cuối B2 và cuối B4.

## 7. Rollback

- Mỗi bước một commit, nên có thể revert riêng B4 mà giữ B2, hoặc ngược lại.
- Quay hẳn về v1: `git checkout worldgen-v1`, hoặc revert các commit Đợt 2. Golden v1 vẫn còn nguyên nên test v1 chạy lại được ngay.
- Tham số mới đều nằm trong `WorldConfig`, nên có thể tinh chỉnh mà không sửa thuật toán. Mỗi lần đổi vẫn là đổi byte, và trong Đợt 2 chỉ cập nhật golden candidate.

## 8. Rủi ro

1. Bỏ hồ ở lưu vực nhỏ làm giảm số hồ. Có thể mất những hồ núi nhỏ đẹp (tarn). Em sẽ báo số hồ theo loại trước và sau.
2. Dải chân núi thưa hơn có thể làm bản đồ trống hơn ở seed ít núi. Đây là lưu bạch có chủ ý, nhưng cần anh xem ảnh.
3. Thay lưới massif bằng đỉnh phụ phụ thuộc vào độ nhám của địa hình. Ở cao nguyên phẳng có thể thiếu điểm đặt; khi đó cao nguyên dùng họ đỉnh bằng ở các đỉnh phụ thưa.
4. Đổi `logic` (thêm `variantFamilies`) làm đổi header hash. Đó là điều đã được phép ở 2.0.0.

## 9. Báo cáo cuối Đợt 2 (2026-10-24)

Commit: B2 `f2a0236`, B4a `13a437d`, B4b `15611e4`, B4c `7e2d408`. "Trước" = v1 (tag `worldgen-v1`, ảnh Đợt 1); "sau" = 2.0.0. Hai bên cùng renderer, cùng camera: Z2/Z3 dùng camera của v1 (`qa-out/wave1/cameras.json`) vì worldgen mới dời tiêu điểm ở 4 seed. Ảnh và số liệu: `qa/phase2/wave2/` (bảng trước/sau từng seed, `overview_Z1.png`, `metrics.json`, `lake-tone.txt`, `bench.txt`, `report.json`).

### 9.1 Chất lượng địa hình

- Stage `terrain` không đổi: hash 20/20 seed bằng v1 (có test riêng). Đợt này không đụng tới heightmap; các vấn đề địa hình vĩ mô của Giai đoạn 1 (bố cục vùng, C4) vẫn nằm nguyên, chờ đề xuất `04-macro-layout-proposal` ở Đợt 3.
- Thay đổi người xem thấy là do cách đặt nước và núi trên cùng địa hình. Đồng bằng và đồi xa núi giờ để trống (lưu bạch): phủ stamp trên đồng bằng trung bình 7,2% (v1 32,6%).

### 9.2 Thuỷ văn

- L1–L7 đạt hết (bảng ở "Kết quả B2"). Bất biến thuỷ văn 0 lỗi trên 20 seed.
- Hồ: 160 → 135. Hồ móc câu 21,2% → 8,9%. Hồ dài tự nhiên 17 → 20. Tổng diện tích mặt hồ giảm 29%.
- Sông: 766 → 756 đoạn. Số đoạn ra biển (147) và ra biên vùng (210) giữ nguyên; 24 đoạn trước đổ vào hồ giờ thành hợp lưu, vì các hồ đó không còn. Không ép sông nào ra biển.
- `outletType` của hồ: 53 ra biển, 42 vào hồ khác, 40 ra biên vùng.
- A3 theo cách đo đề xuất (chưa là tiêu chí, chờ anh đồng ý): trong mọi loại hồ, L* đều giảm theo độ sâu. Hồ núi tối hơn hồ đồng bằng ở cả 4 nhóm độ sâu, chênh 3,8–7,9 L*. Chênh giữa nhóm nông nhất và sâu nhất là 6,6 L* với hồ núi, nhưng chỉ 3,4 với hồ thung lũng và 2,5 với hồ đồng bằng (ngưỡng đề xuất là 4).

### 9.3 Composition núi

| # | Tiêu chí | v1 | 2.0.0 | Đạt |
|---|---|---|---|---|
| M1 | Một chủ phong mỗi dãy ≥ 3 núi; không footprint trên nước | đạt | 89/89; 0 | ✓ |
| M2 | Không biến thể lặp kề; ≤ 25% một nhóm | đạt | 0; 25,0% | ✓ |
| M3 | Cặp kề trên sống chồng 20–45% | ≥ 90% | 98,8% | ✓ |
| M4 | Stamp từ lưới đều ≤ 30% | 69–86% | 0% | ✓ |
| M5 | Họ theo vai trò địa hình | theo hash | bộ phân loại khớp 100%; 96,5% stamp dùng đúng họ được chọn, phần còn lại lùi theo bảng cố định | ✓ |
| M6 | Không footprint trong hành lang thung lũng | — | 0 | ✓ |
| M7 | Phủ trung bình theo vùng | núi 90,5 / cao nguyên 81,5 / chân núi 63,4 / thung lũng 23,0 / đồng bằng 32,6 / ven biển 11,8 | 93,0 / 67,9 / 50,4 / 5,3 / 7,2 / 8,2 | ✓ |
| M8 | Đồng bằng ≤ 25% ở mọi seed | — | tối đa 15,4% (tsvl-17) | ✓ |
| M9 | Lớp xa nằm phía bắc lớp gần | — | 78/78 massif | ✓ |

Cấu trúc mới: chủ phong + vai (cùng họ với chủ phong), khách phong, sống chính (đông–tây thành dãy, bắc–nam thành chóp/vách xếp chồng), nhánh (`mountain.low`, nhỏ dần về đầu nhánh), đỉnh phụ, chân núi. Tổng stamp 6 821 → 3 122. Theo vai trò: đỉnh phụ 1 509, sống 917, nhánh 166, vai 149, khách phong 142, đồi chân núi 145, chủ phong 94.

**Khác với kế hoạch:**
1. **Đỉnh phụ.** Kế hoạch là "cực đại địa phương bán kính 2, chênh ≥ 0,02". Làm đúng như vậy thì quá thưa: chỉ 364 đỉnh trên 20 seed, và tsvl-17 (seed nhiều núi nhất) trông như đồng bằng. Lấp mọi ô núi theo độ cao giảm dần thì lại thành một tấm thảm đều (phủ núi 99%). Bản cuối đặt đỉnh phụ trên ô cao hơn trung bình trong bán kính 3 ít nhất 0,012, tức gò và sống. Ô được duyệt theo độ cao giảm dần và giữ khoảng cách bằng giới hạn chồng nền 0,15. Chỗ trũng, yên ngựa rộng và mặt cao nguyên phẳng không có stamp, nên khối núi tách thành từng cụm, giữa các cụm có khoảng trống.
2. **Lớp mực.** Kế hoạch chỉ dùng vị trí trong massif (nam/bắc). Với massif lớn (cả một vùng núi là một cluster), cách đó tạo ra một dải đậm ngang ở đáy. Bản cuối cộng thêm hướng sườn: sườn đổ về nam là mặt trước, đổ về bắc là sau đỉnh. Lớp mực lấy theo dấu của tổng hai yếu tố.
3. **Đỉnh bằng.** Ngưỡng là 6 ô trong 0,02 (kế hoạch ghi 0,03). Với 0,03, gần một nửa đỉnh thấp thành mặt bàn. Trong `variantFamilies`: `mountain.low` đổi 3 biến thể "đồi" (vai trò địa hình không bao giờ chọn họ này cho núi thấp) thành 2 đỉnh bằng + 1 chóp; `mountain.tall` có 2 đỉnh bằng thay vì 1.

### 9.4 Hiệu năng

- Sinh thế giới (Node, trung vị 20 seed × 9 lần, chạy xen kẽ v1/v2 trên cùng máy): v1 53,8 ms, 2.0.0 57,3 ms, tức +6,5% (giới hạn +20%).
- Trình duyệt: `buildMs` trung vị 135 → 144 ms. `genMs` trong worker dao động theo tải máy khi chụp, nên không dùng để so.

### 9.5 Tính tất định

- Node = worker = main thread cho 20/20 seed, khớp golden candidate (`golden/worldgen-v2.candidate.json`).
- Golden v1 giữ nguyên (test khoá sha256). Stage `terrain` bằng v1.
- Test thứ tự ứng viên và chunk của composition vẫn đạt. Worldgen không dùng sin/cos/pow/random/Date.
- Toàn bộ 176 test đạt. Golden v2 chính thức chỉ ghi sau khi anh nghiệm thu.

### 9.6 Lỗi hình ảnh còn lại

1. **Hồ nhạt hơn Đợt 1.** Độ sâu giờ đo từ mặt nước thật. Hồ thung lũng và hồ đồng bằng gần như không đổi độ đậm theo độ sâu (xem 9.2). Hướng sửa là render (dải độ sâu `LAKE_DEPTH_RANGE`, độ dốc tông theo loại hồ), để Đợt 3.
2. **Độ đậm núi ở Z1.** Theo yêu cầu, em chưa đổi alpha. Ảnh Z1 xuất lại là `overview_Z1.png`, để anh quyết.
3. **Mặt bàn (đỉnh bằng)** vẫn đọc như hộp ở Z2, chủ yếu trên cao nguyên. Hình mặt bàn do art; đây là việc của art, không phải worldgen.
4. **Đồi chân núi rất nhỏ** (145 đồi trên 20 seed), ở Z2 trông như chấm lẻ. Có thể tăng tỉ lệ hoặc gom thành cụm 2–3 gò.
5. **Vùng núi lớn ở tsvl-17** vẫn có mảng trống rộng trên cao nguyên phẳng: cao nguyên phủ 39–52% ở seed này. Đúng luật, nhưng cần anh xem có chấp nhận được không.
6. **Đất trũng khô** quanh các hồ bị thu nhỏ (phần lòng chảo không còn nước) chưa có cách vẽ riêng (đầm, lau sậy).
