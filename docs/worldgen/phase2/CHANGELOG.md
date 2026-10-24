# Giai đoạn 2 — Nhật ký thay đổi

Mỗi mục ghi đợt, loại thay đổi (render / art / worldgen), phiên bản worldgen và báo cáo chi tiết.

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
