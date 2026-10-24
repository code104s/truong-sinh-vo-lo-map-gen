# Giai đoạn 2 — Nhật ký thay đổi

Mỗi mục ghi đợt, loại thay đổi (render / art / worldgen), phiên bản worldgen và báo cáo chi tiết.

## Sửa fps bản xem trước (render, không đổi worldgen, 2026-10-24)

Owner đo bản xem trước 8–12 fps. Đo từng phần (SwiftShader, 1280×800, tsvl-07): shader địa hình chiếm khoảng 80% thời gian một khung hình.

### Đổi
- `src/render/terrainLayer.ts`: shader bỏ qua các số hạng có trọng số đúng bằng 0 (gợn sóng biển trên đất liền và xa bờ, nước khi landW = 1, nét bờ ngoài dải 0,07 ô). 60 ảnh (20 seed × Z1/Z2/Z3) giống hệt từng pixel.
- `src/render/terrainCache.ts` (mới): vẽ địa hình vào texture (vùng nhìn + lề 30%, lưới texel khớp pixel thiết bị) và một nền toàn bản đồ 2048². Chỉ vẽ lại khi camera ra khỏi vùng đã lưu hoặc zoom đứng yên 160 ms. So với trước: lệch tối đa 1/255 trên 0,004% pixel.
- `src/app/main.ts`, `src/render/camera.ts`: vẽ theo yêu cầu (camera đổi, bật tắt layer, đổi kích thước); đứng yên thì không vẽ. HUD ghi fps của các khung liền nhau, đứng yên ghi `idle`.

### Đo (SwiftShader, trung vị một bước kéo, `scripts/qa/pan-cost.cjs`)
- Z1 326 → 119 ms, Z2 438 → 95 ms, Z3 473 → 82 ms. Mỗi lần ra khỏi lề phải vẽ lại một lần (khoảng 1,3 khung hình cũ).

## Đợt 2, B4 — composition núi (worldgen 2.0.0, 2026-10-24)

Báo cáo cuối Đợt 2 (sáu phần): [02-worldgen-v2.md](02-worldgen-v2.md), mục 9.

### Thêm
- `logic.variantFamilies` trong manifest (họ dáng là logic; validator kiểm). `StampInstance.family` = họ mà vai trò địa hình chọn.
- `src/worldgen/composition.ts`: `summitFamily`, `ridgeFamily`, `slopeRatio`, `isSummitGround`, `valleyCorridor`, `mountainDistance`, `FAMILY_FALLBACK`; vai trò `spur`, `summit` (thay `massif`).
- `src/qa/metrics.ts`: `structureMetrics` (M4–M6, M9). `tests/composition.test.ts`: M4–M9.
- `scripts/qa/wave2-metrics.ts`.

### Đổi
- Bỏ lưới massif 3 ô và lưới đồi 4 ô. Thay bằng: sống chính / nhánh theo hướng, đỉnh phụ trên gò và sống, đồi chỉ trong dải chân núi 6 ô.
- Không footprint trong hành lang thung lũng (1 ô quanh sông lớn).
- `tone` theo hướng sườn và vị trí trong massif, không còn ngẫu nhiên.
- `src/render/stampArt.ts`: đọc họ từ `logic.variantFamilies`.
- `src/app/main.ts`: `setCamera` cho ảnh QA cùng camera.

## Đợt 2, B2 — hồ (worldgen 2.0.0, 2026-10-24)

`WORLDGEN_VERSION` = 2.0.0. Golden v1 (`golden/worldgen-v1.json`) giữ nguyên và có test khoá sha256; hash 2.0.0 ghi vào `golden/worldgen-v2.candidate.json` cho tới khi anh nghiệm thu. Stage `terrain` của 20 seed vẫn bằng v1. Chi tiết và số đo: [02-worldgen-v2.md](02-worldgen-v2.md), mục "Kết quả B2".

### Thêm
- `src/worldgen/hydrology.ts`: hồ chọn theo cân bằng nước (`lakeCatchmentRatio` = 4), nước dâng từ ô thấp nhất và dừng ở yên ngựa giữa hai lòng chảo (`lakeSaddleDepth` = 0,005), làm sạch bờ. `Lake` thêm `surface`, `maxDepth`, `catchment`, `kind`, `outletType`; stream hydrology ghi các trường này.
- `src/qa/golden.ts`, `scripts/update-golden.ts`: golden candidate / final theo major version, không bao giờ ghi đè v1.
- `src/qa/metrics.ts`: `cellShape`, `lakeShapes` (dùng chung cho test và `analyze.ts`).
- `tests/lakes.test.ts`: L2–L7, thuộc tính hồ, hồi quy tsvl-18 (hai hồ chỉ liền trên ảnh khi có dòng nối).
- `scripts/qa/lake-criteria.py`, `scripts/qa/lake-tone.py`, `scripts/qa/review-cameras.ts`; `qa-shots.mjs --cameras` để chụp trước/sau cùng camera khi worldgen dời tiêu điểm Z2/Z3.

### Đổi
- `src/render/hydroView.ts`: đọc loại hồ và `outletType` từ worldgen; độ sâu tính từ mặt nước thật.
- `scripts/analysis/analyze.ts`: gán pixel hồ theo hồ gần nhất, báo kèm số theo cách cũ; ghi độ sâu hồ vào mẫu.
- `tests/composition.test.ts`: bỏ kiểm V6 (anh đã thay V6 bằng mật độ theo vùng; M7/M8 vào ở B4c). Ở B2, tsvl-04 có 60,06% đất trống.
- `tests/render-geometry.test.ts`: số đường ra hồ trong A7 cập nhật 130 → 113.

## Đợt 1 — render và art (2026-10-24)

`WORLDGEN_VERSION` giữ nguyên 1.0.0. Golden `golden/worldgen-v1.json` không đổi (20/20 seed khớp từng stage). Chi tiết và số đo: [01-render-changes.md](01-render-changes.md).

### Thêm
- `src/render/hydroView.ts`: dữ liệu thuỷ văn dẫn xuất chỉ cho render (bậc Strahler, loại hồ núi / thung lũng / đồng bằng, độ sâu hồ, kiểu đầu và cuối của từng đoạn sông: `source` / `lakeOutflow`, `ocean` / `lake` / `junction` / `regionBoundary`). Không ghi ngược vào `WorldData`.
- `src/render/riverGeometry.ts`: hình học sông thuần (không Pixi), kiểm được trong Node.
- `tests/render-geometry.test.ts`: kiểm A6–A9 (cửa sông chạm nước, cửa ra hồ đủ rộng, sông ra biên chạm mép, LOD xa không có khoảng hở).
- `scripts/qa/before_after.py`, `scripts/qa/lake-stats.ts`, `scripts/qa/render-prof.ts`: công cụ QA.
- `scripts/art-metrics.mjs`: phân loại họ dáng theo luật A10 đặt trước.

### Đổi
- `src/render/fields.ts`: mặt nạ hồ tách khỏi biển (hồ làm mờ một lượt thay vì hai, giữ hồ hẹp); kênh R của texture chứa độ sâu hồ, kênh B của SDF chứa loại hồ; thêm `sampleSdf`; nội suy bicubic không cấp phát.
- `src/render/terrainLayer.ts`: nhánh shader riêng cho hồ (không vòng gợn, không quầng, đậm theo độ sâu, ba kiểu theo loại hồ). Biển giữ nguyên.
- `src/render/riverLayer.ts`: chỉ còn phần vẽ; độ đậm theo lưu lượng tại chỗ; LOD xa và suối không còn nét đứt; đầu nét dùng `butt` để bỏ chấm đậm ở chỗ nối.
- `src/render/stampArt.ts`: năm họ dáng núi (dãy, chóp, đỉnh bằng, vách, đồi), nét phủ phách cho vách và đỉnh bằng.
- `src/render/stampLayer.ts`: ba lớp mực xa / giữa / gần theo `tone` của composer.
- `src/assets/manifest.json`: chỉ `visual.source.params` (thêm `families`, bỏ `peaks` / `humps`). `logic` không đổi.
- `src/app/main.ts`: dựng `HydroView` một lần, dùng chung cho terrain và sông.
- `src/app/artPreview.ts`, `scripts/shot-art.mjs`: contact sheet ghi tên họ; sửa timeout khi tải trang.
- `scripts/analysis/analyze.ts`, `scripts/analysis/measure_shots.py`: thêm loại hồ vào mẫu, đo L* hồ theo loại, bỏ qua seed thiếu ảnh.

## Đợt 0 — baseline (2026-10-24)

Không đổi mã runtime. Báo cáo: [00-baseline.md](00-baseline.md).
