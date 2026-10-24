# Đợt 0 — Baseline và kiểm tra tiền điều kiện

Trường Sinh Vô Lộ · World Map Z1 · Giai đoạn 2 · 2026-10-24

Tài liệu đầu vào: báo cáo Giai đoạn 1 (Claude Doc) https://claude.ai/artifact/LLQi5y3RuJMBvp5G4C4kLt.

Baseline đạt: pipeline, golden, tất định và số liệu Giai đoạn 1 đều khớp khi chạy lại. Chưa sửa dòng code runtime nào. Đợt 1 (B1, B3, C1) có thể bắt đầu.

## 1. Trạng thái mã nguồn

- Bản làm việc trùng khớp với bản trong thư mục dự án `truong-sinh-vo-lo/code` (so từng file, trừ `node_modules` và `dist`).
- Trước đây dự án chưa có Git. Em tạo repo cục bộ trong `code/` với commit baseline `e8ffdfe` ("Baseline: PoC 0 round 1 + Phase 1 analysis scripts (worldgen 1.0.0)") và `.gitignore` cho `node_modules/`, `dist/`, `qa-out/`. Repo chưa có remote; mọi thay đổi từ đây đều có commit riêng để so và hoàn tác.
- Thay đổi duy nhất sau baseline trong Đợt 0 là công cụ QA: `src/app/artPreview.ts` (thêm hook đọc silhouette cho trang xem art, không ảnh hưởng game) và `scripts/art-metrics.mjs` (mới).

## 2. Cấu trúc pipeline đã xác nhận

| Tầng | File | Ghi chú cho Giai đoạn 2 |
| --- | --- | --- |
| Terrain | `src/worldgen/terrain.ts` | fBm nền, mặt nạ núi × ridged, độ nghiêng, bờ biển |
| Thuỷ văn | `src/worldgen/hydrology.ts`, `flow.ts` | priority-flood (mọi ô mép là điểm thoát), hồ một cửa ra, topoOrder, sông, lưu vực |
| Sống núi | `src/worldgen/ridges.ts` | địa hình đảo ngược, đỉnh, cụm |
| Composition | `src/worldgen/composition.ts` | stamp main/shoulder/guest/ridge + lưới massif/gò |
| Hash | `src/worldgen/index.ts` | header chứa `JSON.stringify(manifest.logic)` → đổi `logic` = đổi byte |
| Render | `src/render/*` | fields (SDF, height, shade) → shader giấy/đất/nước; sông vector; stamp Canvas2D; sương; overlay |

Ranh giới quan trọng: phần `logic` của manifest (footprint, số biến thể) nằm trong hash; phần `visual` (kích thước ảnh, anchor, tham số vẽ) thì không. Đợt 1 chỉ được đổi phần `visual`.

## 3. Kiểm tra baseline

| Hạng mục | Kết quả |
| --- | --- |
| Test (vitest) | 138/138 pass |
| Golden `golden/worldgen-v1.json` | 20/20 seed khớp từng stage |
| Tất định | Node = Chromium worker = Chromium main thread trên 20/20 seed |
| Thời gian gen (Node, trung vị 7 lần) | trung vị 56,5 ms, tối đa 66,9 ms |
| Thời gian gen (worker, Chromium headless) | trung vị 185 ms, tối đa 279 ms |
| Dựng scene (`buildMs`, Chromium) | trung vị 152 ms, tối đa 342 ms |
| Vẽ art (`artMs`) | 231 ms |
| V1 độ bão hoà HSV lớn nhất | 0,286 |

## 4. Số liệu Giai đoạn 1 chạy lại

| Chỉ số | Báo cáo GĐ1 | Chạy lại |
| --- | --- | --- |
| Số hồ | 160 | 160 |
| Đoạn sông | 766 | 766 |
| Stamp | 6.821 | 6.821 |
| Hồ không có sông vào | 54 | 54 |
| Tỉ lệ stamp từ lưới massif/gò mỗi seed | 69–86% | 69,1–86,4% |
| Đoạn sông vẽ bằng nét bút khô | 37% | 287/766 = 37,5% |

Các chỉ số dùng làm mốc cho Đợt 1:

| Chỉ số | Baseline |
| --- | --- |
| Cửa sông hở (đầu cuối cách nước đã render > 0,3 ô) | 33 đoạn |
| Đoạn ra từ hồ bị thuôn đầu | 130/130 |
| Đoạn ra biên vùng | 210 |
| Hồ bị thu nhỏ khi render (diện tích < 0,85 lần) | 52/160, nhỏ nhất 0,26 lần |
| Tỉ lệ tương phản sông lớn / sông nhỏ (theo seed) | 0,84–1,12 |
| IoU silhouette giữa các cặp núi (36 biến thể, không tính gò) | p10 0,72 · p50 0,80 · p90 0,89 |
| Tỉ lệ ngang/cao của núi | 0,83–1,29 (mọi núi gần vuông) |

## 5. Tên dự án

Code và tài liệu đều dùng "Trường Sinh Vô Lộ" (README, `index.html`, `package.json` = `truong-sinh-vo-lo`). Không có chỗ nào dùng tên khác. Các mã định danh viết tắt `TSVL` (magic bytes của định dạng worldgen), `__tsvl` (API debug trên `window`) và seed `tsvl-NN` khớp với tên chính thức nên giữ nguyên.

## 6. Kế hoạch Đợt 1 theo file

Thứ tự: C1 trước (đo được rõ nhất), rồi B1 (dùng chung phần mặt nạ nước với C1), cuối cùng B3.

### Dữ liệu dẫn xuất cho render (mới)

- `src/render/hydroView.ts` (mới): tính từ `WorldData` mà không ghi vào worldgen: cấp Strahler từng ô sông, loại điểm đầu (nguồn hay ra từ hồ) và điểm cuối (biển, hồ, hợp lưu, biên vùng) của mỗi đoạn, loại hồ (núi, thung lũng, đồng bằng) và độ sâu hồ. Hàm thuần, test được trong Node.
- Đây là dẫn xuất tạm thời phía render. Đợt 2 (B2) sẽ đưa loại hồ vào dữ liệu worldgen 2.0.0; C2 sẽ đưa loại cửa ra (`oceanOutlet`, `lakeOutlet`, `regionBoundaryOutlet`) vào hợp đồng thuỷ văn.

### C1 — Sông

- `src/render/riverLayer.ts`: tách phần hình học (`riverGeometry`, thuần, test trong Node) khỏi phần vẽ Pixi.
    - Bề rộng theo lưu lượng như cũ, độ đậm và màu bờ theo cấp Strahler; dòng chính rõ hơn phụ lưu.
    - Chỉ thuôn ở nguồn thật. Đoạn ra từ hồ bắt đầu từ trong mặt nước, đủ bề rộng.
    - Đoạn vào hồ hoặc ra biển kéo dài tới khi chạm nước đã render.
    - Đoạn ra biên vùng kéo tới đúng mép bản đồ, đủ bề rộng.
    - LOD xa không còn khoảng hở bút khô.
    - Đầu nguồn kéo ngược dòng thành nét mảnh nhạt dần (tới khoảng 1/4 ngưỡng sông) để không trông như nhánh cụt.
- `src/render/fields.ts`: xem B1 (mặt nạ nước của hồ).

### B1 — Hồ

- `src/render/fields.ts`: tách mặt nạ hồ khỏi mặt nạ biển. Hồ làm mờ ít hơn để hồ hẹp không co lại. Ghi thêm loại hồ (kênh B của texture SDF, đọc nearest) và độ sâu chuẩn hoá (kênh R của texture dữ liệu, hiện chưa dùng).
- `src/render/terrainLayer.ts`: nhánh shader riêng cho hồ.
    - Không có vòng gợn đồng tâm.
    - Độ đậm theo độ sâu thật.
    - Nét bờ mảnh hơn bờ biển, không có quầng mực.
    - Ba kiểu theo loại hồ, cùng bảng màu: hồ núi đậm, bờ sắc; hồ thung lũng vừa, có vệt gió ngang đứt quãng; hồ đồng bằng nhạt, bờ mềm, có lấm tấm sậy.
    - Biển giữ nguyên.

### B3 — Art núi

- `src/render/stampArt.ts`: một generator với năm họ dáng: dãy dài nhiều đỉnh thấp, chóp nhọn, đỉnh bằng/cao nguyên, vách bất đối xứng, đồi tròn/chân núi. Mỗi biến thể vẽ ba lớp mực gần, trung, xa; chân và sườn thấp tan vào giấy để các stamp chồng lên nhau không thành icon rời.
- `src/assets/manifest.json`: chỉ đổi phần `visual.source.params` (danh sách họ cho từng khoá). Không đổi `logic`.
- `src/render/stampLayer.ts`: dùng `tone` có sẵn để chọn lớp mực gần, trung, xa thay cho alpha 0,86.
- `src/app/artPreview.ts`, `scripts/shot-art.mjs`: contact sheet có ghi tên họ.

## 7. Rủi ro và mâu thuẫn với kiến trúc hiện tại

1. **Chọn họ dáng chưa theo địa hình ở Đợt 1.** Số biến thể nằm trong `logic` (bị hash), nên Đợt 1 chỉ gán họ theo chỉ số biến thể. Biến thể lại do hash vị trí chọn, nên một chóp nhọn vẫn có thể đứng ở chỗ hợp với dãy dài. Chọn họ theo hướng sống, độ dốc và vai trò thuộc B4 (Đợt 2, worldgen 2.0.0).
2. **Loại hồ và cấp sông tạm tính ở render.** Có thể lệch với định nghĩa sau này của B2. Em sẽ giữ cùng một hàm và chuyển sang worldgen ở Đợt 2.
3. **Hồ hẹp vẽ to hơn trước.** Bớt làm mờ thì hồ hẹp hiện lại, nhưng các hồ móc câu cũng lộ rõ hơn. Hình dạng hồ là việc của B2; Đợt 1 không sửa hình học hồ.
4. **Không đo được FPS thật.** Container chỉ có SwiftShader. Em đo `buildMs`, `artMs` và thời gian một khung hình trong SwiftShader làm chỉ báo tương đối; FPS trên máy desktop cần anh kiểm tra.
5. **Chỉ có Chromium.** Firefox và WebKit chưa kiểm được trong container.
6. **Màu đậm hơn có thể chạm trần V1.** Sông và hồ đậm hơn vẫn dùng chàm/mực nhạt; V1 sẽ được đo lại sau mỗi thay đổi.

## 8. Tiêu chí nghiệm thu Đợt 1 (cách đo xác định trước)

Mọi phép đo dùng cùng 20 seed, cùng camera Z1/Z2/Z3 như baseline. Ảnh "sau" chụp bằng `scripts/qa-shots.mjs`, số liệu bằng `scripts/analysis/*` và `scripts/art-metrics.mjs`.

| # | Tiêu chí | Cách đo | Ngưỡng |
| --- | --- | --- | --- |
| A1 | Không đổi byte worldgen | `npm test` (golden từng stage) và `report.json` (`matchesNodeGolden`) | 20/20 seed khớp `worldgen-v1.json`; `WORLDGEN_VERSION` vẫn 1.0.0 |
| A2 | Hồ không còn hình "mắt" | Code: nhánh hồ không vẽ vòng gợn; ảnh: soát 20 seed Z1/Z2 | 0 vòng gợn đồng tâm trong hồ |
| A3 | Ba loại hồ khác nhau | L* trung bình trong hồ theo loại (`measure_shots.py`) | Hồ núi tối hơn hồ đồng bằng ≥ 4 L*; soát mắt cùng ngôn ngữ thuỷ mặc |
| A4 | Không làm mất hồ hẹp | Diện tích hồ sau render / diện tích ô hồ (`analyze.ts`) | Mọi hồ ≥ 0,85 (baseline nhỏ nhất 0,26) và ≤ 1,4 |
| A5 | Dòng chính rõ hơn dòng nhỏ | `measure_shots.py`: tương phản = L* giấy (trung vị cửa sổ 21 px) − L* tối nhất (cửa sổ 5 px) tại tâm ô sông không bị che; dòng lớn = lưu lượng ≥ 10 lần ngưỡng, dòng nhỏ = < 3 lần ngưỡng | Tỉ lệ trung vị lớn/nhỏ ≥ 2 ở ≥ 18/20 seed (baseline 0,84–1,12) |
| A6 | Không còn cửa sông hở | Test Node trên hình học sông: điểm cuối đoạn vào hồ/biển nằm trong nước đã render (SDF < 0) | 0 đoạn (baseline 33) |
| A7 | Không thuôn ở cửa ra hồ và hợp lưu | Test Node: đoạn ra từ hồ bắt đầu trong nước với bề rộng ≥ 0,8 bề rộng đầy đủ | 130/130 |
| A8 | Sông ra biên liên tục tới mép | Test Node: điểm cuối nằm trên mép bản đồ, bề rộng không giảm | 210/210 |
| A9 | Không còn khoảng hở bút khô ở LOD xa | Test Node: LOD xa không bỏ nét nào | 0 khoảng hở |
| A10 | Năm họ dáng núi | `art-metrics.mjs`: phân loại theo luật đặt trước: dãy (ngang/cao ≥ 1,8 và ≥ 3 đỉnh), chóp (ngang/cao ≤ 0,85, 1 đỉnh), đỉnh bằng (phần đỉnh phẳng ≥ 0,35), vách (độ đối xứng ≤ 0,6), đồi (ngang/cao ≥ 2,2, thấp) | ≥ 90% biến thể rơi đúng họ đã gán; đủ 5 họ |
| A11 | Silhouette khác nhau thật | IoU trung vị giữa các cặp núi | ≤ 0,60 (baseline 0,80) |
| A12 | Không hỏng hiển thị | Soát 20 seed × Z1/Z2/Z3; không lỗi console | 0 lỗi |
| A13 | Hiệu năng render | `buildMs`, `artMs` trong Chromium | Trung vị tăng ≤ 30% so với baseline (152 ms, 231 ms) |
| A14 | V1 | `report.json` | Bão hoà HSV lớn nhất ≤ 0,35 |

Ngưỡng không được nới sau khi đã đo. Nếu một tiêu chí trượt vì nguyên nhân thuộc worldgen, em ghi vào báo cáo Đợt 1 thay vì đổi ngưỡng.

## 9. Vị trí lưu kết quả

- Baseline: `truong-sinh-vo-lo/qa/phase2/baseline/` gồm `shots/` (20 seed × Z1, Z2, Z3, overlay), `report.json`, `analysis/` (analysis.json, shots_measure.json, overlay), `art.png`, `art-metrics.json`.
- Golden v1 giữ nguyên tại `golden/worldgen-v1.json`. Golden v2 sẽ là file mới `golden/worldgen-v2.json`, chỉ ghi sau khi Đợt 2 được nghiệm thu.
