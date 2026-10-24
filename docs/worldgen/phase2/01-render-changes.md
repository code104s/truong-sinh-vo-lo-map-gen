# Đợt 1 — Render và art (B1 hồ, C1 sông, B3 núi)

Ngày: 2026-10-24. Phạm vi: chỉ render và art. `WORLDGEN_VERSION` vẫn 1.0.0, golden không đổi.
Tiêu chí và cách đo lấy nguyên từ [00-baseline.md](00-baseline.md) mục 8, không sửa sau khi đo.

## 1. Tóm tắt kết quả

| # | Tiêu chí | Baseline | Sau Đợt 1 | Kết quả |
|---|---|---|---|---|
| A1 | Byte worldgen | 20/20 khớp golden v1 | 20/20 khớp, worker = main = Node | Đạt |
| A2 | Vòng gợn trong hồ | 3 vòng/hồ | 0 (nhánh shader hồ không có vòng gợn) | Đạt |
| A3 | Hồ núi tối hơn hồ đồng bằng ≥ 4 L* | không phân biệt | trung bình gộp 20 seed: núi 73,4 / thung lũng 76,5 / đồng bằng 79,6 L*, chênh núi–đồng bằng 6,2 | Đạt (gộp); 15/17 seed có đủ hai loại |
| A4 | Diện tích hồ render / ô hồ trong 0,85–1,4 | nhỏ nhất 0,26; 52 hồ < 0,85 | 1,01–1,43; 159/160 hồ trong khoảng | Chưa đạt 1 hồ (mục 6) |
| A5 | Tương phản dòng lớn / dòng nhỏ ≥ 2 ở ≥ 18/20 seed | 0,84–1,12 | 2,07–2,68; 20/20 seed ≥ 2 | Đạt |
| A6 | Cửa sông hở | 33 | 0 (test Node, lề 0,35 ô cho domain warp) | Đạt |
| A7 | Cửa ra hồ bắt đầu trong nước, rộng ≥ 0,8 | 130 đoạn thuôn còn 20% | 130/130 ở cả hai LOD | Đạt |
| A8 | Sông ra biên chạm mép, không hẹp lại | 210 đoạn dừng ở tâm ô biên | 210/210 ở cả hai LOD | Đạt |
| A9 | Khoảng hở bút khô ở LOD xa | có (nét bị bỏ ngẫu nhiên ở mọi LOD) | 0 | Đạt |
| A10 | ≥ 90% biến thể đúng họ, đủ 5 họ | 1 họ | 91,7% (44/48), đủ 5 họ | Đạt |
| A11 | IoU trung vị giữa các cặp núi ≤ 0,60 | 0,798 | 0,515 (p10 0,397, p90 0,871) | Đạt |
| A12 | Không hỏng hiển thị | 0 lỗi | 0 lỗi trang; soát 20 seed × 3 zoom | Đạt (mục 6 ghi các điểm xấu còn lại) |
| A13 | buildMs, artMs tăng ≤ 30% | 150 ms, 231 ms | buildMs trung vị 135 ms ở lần chụp cuối (150,5 ms ở lần trước; dao động giữa các lần chạy khoảng 10%), artMs 169–208 ms | Đạt |
| A14 | Bão hoà HSV lớn nhất ≤ 0,35 | 0,286 | 0,290 | Đạt |

Ảnh trước/sau: `qa/phase2/wave1/boards/` (mỗi seed một bảng Z1, Z2, Z3; `overview_Z1.png` cho cả 20 seed). Contact sheet núi: `qa/phase2/wave1/art.png`.

## 2. Dữ liệu dẫn xuất cho render

**Vấn đề.** Renderer không biết hồ nào là hồ núi hay hồ đồng bằng, sông nào là dòng chính, đoạn nào chảy ra từ hồ hay ra khỏi vùng.

**Giải pháp.** `src/render/hydroView.ts` tính từ `WorldData` mỗi lần dựng, không ghi ngược:

- Bậc Strahler cho ô sông (duyệt `hydro.order` ngược).
- Loại hồ theo luật ở 00-baseline: núi nếu mực nước ≥ `mountainLevel − 0,04` hoặc (độ cao vành ≥ 0,25 và mực nước ≥ `hillLevel`); thung lũng nếu độ cao vành ≥ 0,12 và (độ dãn ≥ 1,8 hoặc ≥ 50% vành dốc); còn lại là đồng bằng. Trên 20 seed: 60 hồ núi, 40 thung lũng, 60 đồng bằng.
- Độ sâu hồ = mực nước − độ cao ô.
- Kiểu đầu dòng (`source`, `lakeOutflow`) và cuối dòng (`ocean`, `lake`, `junction`, `regionBoundary`). Trên 20 seed: 147 ra biển, 176 vào hồ, 233 hợp lưu, 210 ra biên vùng; 130 đoạn bắt đầu từ cửa ra hồ.

Tên `regionBoundary` khớp quyết định "Z1 là một vùng của thế giới lớn". Hợp đồng dữ liệu đầy đủ (outletType, boundarySide, discharge…) để ở 03-boundary-hydrology (Đợt 3).

**Phương án bỏ.** Ghi loại hồ và bậc sông vào worldgen ngay: đổi byte, phải nâng version, trái phạm vi Đợt 1. B2 sẽ chuyển đúng hàm này vào worldgen.

## 3. B1 — Hồ

**Vấn đề ban đầu.** Hồ vẽ bằng shader biển: ba vòng gợn đồng tâm, quầng mực, viền dày, tất cả hồ giống nhau; hồ hẹp bị làm mờ mất (tỉ lệ diện tích render nhỏ nhất 0,26).

**Nguyên nhân (Giai đoạn 1).** `fields.ts` làm mờ chung một mặt nạ nước hai lượt rồi cắt ở 0,5, nên hồ rộng 1–2 ô co lại; `terrainLayer.ts` chỉ có một nhánh "nước".

**Giải pháp.**

- `fields.ts`:
  - Biển vẫn làm mờ hai lượt. Hồ làm mờ một lượt, nhân hệ số 1,2, rồi lấy max với biển.
  - Kênh R của texture dữ liệu (trước đây không dùng) chứa độ sâu hồ đã chuẩn hoá (0,08 đơn vị độ cao = đậm nhất).
  - Kênh B của texture SDF chứa mã loại hồ của hồ gần nhất trong 2 ô; bằng 0 trên ô biển.
- `terrainLayer.ts`, nhánh hồ riêng:
  - Một lớp chàm tĩnh, đậm theo độ sâu thật: bờ nông nhạt, giữa sâu đậm.
  - Không có vòng gợn, không có quầng. Viền hồ mảnh hơn biển (0,012–0,024 ô thay vì 0,025–0,07).
  - Hồ núi đậm nhất, hơi lạnh, viền sắc. Hồ thung lũng vừa, có vệt gió ngang đứt quãng, viền đứt. Hồ đồng bằng nhạt nhất, hơi xanh lục, bờ mềm (chuyển màu qua 0,14 ô) và dải đất ẩm xanh nhạt phía bờ.
  - Biển giữ nguyên.
- Hình dạng hồ không bị shader ép tròn: shader chỉ đọc khoảng cách tới mép nước thật.

**Khác với kế hoạch.** Kế hoạch có "lấm tấm sậy" cho hồ đồng bằng. Em đã thử: ở Z3 các nét sậy trông như vệt lỗi. Em thay bằng dải đất ẩm xanh nhạt. Có thể làm lại sậy thành stamp ở Lớp 4 sau này.

**Phương án bỏ.**

- Ngưỡng nước riêng cho hồ: cần thêm một trường khoảng cách và một texture nữa. Hệ số 1,2 đủ giữ hồ hẹp.
- Tô hồ theo khoảng cách tới bờ, như biển: đó chính là thứ tạo hình "mắt", và không theo độ sâu thật.

## 4. C1 — Sông

**Vấn đề ban đầu.**

- Dòng chính và suối có cùng độ tương phản (khoảng 15 L*).
- 130 đoạn ra từ hồ bắt đầu bằng đầu thuôn 20%.
- 33 cửa sông hở giấy trước khi chạm nước.
- 210 đoạn ra biên dừng ở tâm ô biên.
- Nét bút khô đứt quãng ở LOD xa trông như sông gãy.

**Nguyên nhân.** `riverLayer.ts` tô mọi ribbon cùng độ đậm, luôn thuôn đầu đoạn, dừng ở tâm ô cuối, và bỏ nét ngẫu nhiên ở mọi LOD.

**Giải pháp.**

- Tách `src/render/riverGeometry.ts` thành hàm thuần (không Pixi) để test trong Node. `riverLayer.ts` chỉ còn phần vẽ.
- Đầu dòng:
  - Đoạn ra từ hồ bắt đầu ở ô hồ cạnh cửa ra, đi sâu vào nước tới SDF ≤ −0,45, với đủ bề rộng.
  - Đoạn bắt đầu từ nguồn kéo dài lên theo nhánh chính tới khi lưu lượng còn 1/4 ngưỡng (tối đa 6 ô), dưới dạng nét mảnh nhạt dần. Nhờ vậy đầu nguồn không bắt đầu đột ngột giữa đồng.
- Cuối dòng:
  - Vào hồ/biển: đi theo gradient SDF tới khi sâu 0,45 ô trong nước. Lề này lớn hơn domain warp 0,35 ô của shader.
  - Ra biên: kéo nguyên bề rộng tới đúng mép bản đồ.
  - Hợp lưu: giữ bề rộng của nhánh phụ, không phình hay thuôn.
- Phần đã vào nước (SDF ≤ −0,1 ô) vẽ chàm nhạt (35%), không có bờ, để sông tan dần vào hồ hay biển thay vì thò thành một dải đậm. Ở Z3 bản trước của thay đổi này trông như cầu tàu chìa vào hồ.
- Thứ bậc:
  - Độ đậm theo hạng lưu lượng tại chỗ, t = log(acc/ngưỡng) / log(acc lớn nhất/ngưỡng), chia 4 bậc dọc theo sông.
  - Suối: 0,2 + 0,3t. Lớp chàm: 0,34 + 0,42t. Bờ: 0,3 + 0,42t.
  - Dòng chính (hạng > 0,6) dùng mực đậm hơn cho bờ.
  - Bề rộng vẫn theo √lưu lượng như cũ.
- Bút khô:
  - LOD xa và suối: không bỏ nét.
  - LOD gần: bờ còn ít khoảng khô, ngưỡng −0,95 + 0,6·bias thay vì −0,75 + bias.
  - Đầu nét đổi `round` sang `butt` vì các đầu tròn chồng nhau tạo chấm đậm như bậc thang.
- Dữ liệu thuỷ văn không đổi (A1).

**Phương án bỏ.**

- Làm đậm cả hệ thống: không tăng tỉ lệ dòng lớn/dòng nhỏ.
- Độ đậm theo cả đoạn: đoạn sông dài có phần thượng lưu nhỏ bị tô đậm như dòng chính. Lần đo đầu cho tỉ lệ chỉ 1,7–1,8, nên em chuyển sang độ đậm tại chỗ.

## 5. B3 — Núi

**Vấn đề ban đầu.** Một generator, một kiểu chuông tròn, nên các núi gần như cùng silhouette (IoU trung vị 0,80). Bản đồ đọc như lưới icon.

**Giải pháp.**

- `stampArt.ts` có năm họ, mỗi họ một công thức silhouette (1 − |d|^a)^b:

| Họ | Dáng | Nét |
|---|---|---|
| dãy | 4–6 đỉnh rải đều trên một sống liền, thấp | phi ma (sợi gai) |
| chóp | một đỉnh nhọn cao, vệ tinh thấp dưới 1/3 | phi ma |
| đỉnh bằng | đỉnh phẳng rộng, vách dựng | phủ phách (rìu bổ) |
| vách | một mặt dựng đứng, một sườn dài | phủ phách |
| đồi | gò tròn thấp | nhẹ |

- Mỗi họ có dải chiều cao, chân núi (độ tan vào sương), độ đậm nét viền, số điểm rêu và dãy nền phía sau riêng.
- Họ gán theo chỉ số biến thể trong `manifest.visual.source.params.families`. `logic` (12 biến thể mỗi khoá, footprint) không đổi, nên hash worldgen không đổi.
- Phân bổ:
  - `mountain.main`: 5 dãy, 3 vách, 3 chóp, 1 đỉnh bằng.
  - `mountain.tall`: 6 chóp, 5 vách, 1 đỉnh bằng.
  - `mountain.low`: 5 dãy, 3 đồi, 3 vách, 1 đỉnh bằng.
  - `hill`: 12 đồi.
- Ba lớp mực:
  - Trong mỗi stamp: dãy nền nhạt (xa) sau khối chính (giữa).
  - Giữa các stamp, theo `tone` composer đã gán: xa alpha 0,82, hơi lạnh; giữa 0,95; gần đậm, ấm.
- Deterministic: mỗi (khoá, biến thể) vẫn vẽ từ luồng `rngFor('art', key#variant)`.

**Điều chỉnh trong lúc soát ảnh.**

- Ban đầu `hill` có 3 biến thể "dãy". Ở Z1 chúng thành các vệt răng cưa nhỏ, đậm, rải khắp đồng bằng như nhiễu, nên em đổi về 12 đồi.
- Ban đầu đỉnh bằng chiếm 8/48 biến thể. Ở Z1 các dải núi dày đọc như một bãi khối hộp, nên em giảm còn 3/36 biến thể núi. Đỉnh bằng hợp với cao nguyên; chọn theo địa hình là việc của B4.
- Dãy núi lúc đầu là các đỉnh rời như răng lược, vì sương chân núi xoá mất phần yên ngựa. Em thêm sống núi liền và rải đỉnh đều.

**Phương án bỏ.**

- Tăng số biến thể lên 20–30: đổi `logic`, đổi byte.
- Chọn họ theo địa hình ngay: cần dữ liệu hướng sống và vai trò trong composer. Đó là B4.

## 6. Còn tồn tại và rủi ro

1. **A4 chưa đạt 1/160 hồ.** tsvl-18, hồ 3 (18 ô) có tỉ lệ 1,427 > 1,4.
   - Hồ 2 chảy vào hồ 3 qua một ô sông. Hai hồ cách nhau 1 ô nên khi làm mờ, phần nước giữa hai hồ liền lại.
   - `analyze.ts` cũng gán pixel cho mọi hồ trong vòng 2 ô, nên phần chung bị đếm cho cả hai hồ.
   - Em không sửa cách đo sau khi thấy kết quả. Nếu anh muốn, có thể bỏ hệ số 1,2 riêng cho các hồ có hồ khác trong vòng 2 ô.
2. **A3 đạt khi tính gộp, chưa đạt ở mọi seed.**
   - Chênh núi–đồng bằng theo seed: 2,0 ở tsvl-15 và 2,9 ở tsvl-02; 15 seed còn lại 4,8–8,4. Ba seed (tsvl-11, 12, 14) không có đủ hai loại hồ để so.
   - Độ đậm theo độ sâu thật nên hồ núi nông có thể nhạt hơn hồ đồng bằng sâu. Đó là hệ quả của yêu cầu "đậm theo độ sâu".
3. **Họ núi chưa theo địa hình.** Một chóp hay đỉnh bằng vẫn có thể đứng giữa đồi thấp. Đây là B4 (Đợt 2).
4. **Hình móc câu của hồ vẫn còn.** Đó là hình học worldgen (B2). Đợt 1 làm hồ hẹp hiện đúng bề rộng nên các hình móc câu còn lộ rõ hơn trước.
5. **Sông vẫn ra biên nhiều** (210 đoạn). Đợt 1 chỉ vẽ cho đúng (liền tới mép); số lượng do worldgen quyết định. Hợp đồng biên vùng ở Đợt 3.
6. **Dải núi nhạt hơn baseline** vì lớp xa có alpha 0,82 và nhiều dãy thấp. Anh xem `overview_Z1.png`. Nếu muốn khối núi nặng hơn thì chỉnh `INK_LAYER` trong `stampLayer.ts`, không đụng worldgen.
7. **Chỉ đo trong Chromium + SwiftShader.** FPS thật và Firefox/WebKit vẫn cần máy desktop.

## 7. Test đã chạy

- `npm test`: 142/142, gồm 4 test mới `tests/render-geometry.test.ts` (A6–A9) và golden từng stage 20/20.
- `node scripts/qa-shots.mjs qa-out/wave1/shots`: 20 seed × Z1/Z2/Z3 + overlay; worker = main = golden; 0 lỗi trang.
- `npx vite-node scripts/analysis/analyze.ts -- qa-out/wave1/analysis` và `python3 scripts/analysis/measure_shots.py`: A3, A4, A5.
- `node scripts/art-metrics.mjs`: A10, A11.
- `npx vite-node scripts/qa/render-prof.ts`: thời gian từng bước dựng trong Node.

## 8. Cần anh quyết định

1. Duyệt Đợt 1 để bắt đầu Đợt 2 (B2 + B4, worldgen 2.0.0)?
2. A4 (1 hồ 1,427) và A3 theo từng seed: chấp nhận như trên, hay muốn em sửa thêm trong Đợt 1?
3. Độ nặng của dải núi ở Z1 (mục 6.6): giữ, hay làm đậm hơn?
