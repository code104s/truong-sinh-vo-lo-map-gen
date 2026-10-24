# Trường Sinh Vô Lộ — PoC 0

Bản đồ sơn thủy sinh theo seed, 128×128 ô: địa hình, sông hồ, dãy núi thủy mặc. Chỉ PoC 0; chưa có làng, chunk streaming hay gameplay.

## Chạy

```bash
npm install
npm run dev            # mở http://localhost:5173/?seed=tsvl-01
```

Trên trang: lăn chuột để zoom, kéo để pan, `D` bật overlay debug (ridge, đỉnh, footprint), phím `1`–`5` bật/tắt từng layer. Thêm `&view=Z1|Z2|Z3` để nhảy tới ba góc review, `&bench=1` để chạy vòng zoom 10 giây và đọc FPS trên HUD.

## Kiểm thử và đo

| Lệnh | Việc |
| --- | --- |
| `npm test` | Vitest: tất định 10 lần chạy, golden 20 seed theo từng stage, bất biến thủy văn và thứ tự tôpô, ridge so với thủy văn thuận, composition không phụ thuộc thứ tự, chỉ số V2–V6, lint hàm cấm, manifest |
| `npm run bench` | Thời gian worldgen theo stage, trung vị 7 lần, 20 seed (Node) |
| `npm run bench:fps` | Vòng zoom trong Chromium headless (GPU phần mềm: chỉ là sàn, không phải số desktop) |
| `npm run qa:shots` | 20 seed × Z1/Z2/Z3 + overlay, hash worker vs main thread vs golden Node, thống kê độ bão hòa; ghi `qa-out/index.html` và `report.json` |
| `npm run qa:ridges` | Ảnh so sánh heightmap với ridge/đỉnh/sông/footprint cho 20 seed |
| `npm run qa:metrics` | In chỉ số thủy văn và V2–V6 cho 20 seed |
| `npm run golden:update` | Ghi lại golden. Chỉ dùng khi cố ý đổi output, kèm tăng `WORLDGEN_VERSION` |

Các lệnh trình duyệt cần Playwright: `npm i -D playwright@1.63.0 && npx playwright install chromium`.

## Cấu trúc

- `src/core` — RNG sfc32/cyrb128, hash không trạng thái, simplex 2D, heap, SHA-256. Không dùng hàm toán không khả chuyển.
- `src/worldgen` — terrain → hydrology (priority-flood, D8, hồ một cửa ra, thứ tự tôpô từ đồ thị receiver) → ridges (địa hình đảo ngược) → composition (đặt stamp núi). Thuần, không DOM, không PixiJS, không đồng hồ.
- `src/render` — năm layer PixiJS 8: shader giấy/đất/nước, sông vector, stamp núi vẽ thủ tục bằng Canvas2D, sương, overlay.
- `src/assets/manifest.json` — `logic` (footprint, số biến thể: đổi là phải tăng version) tách khỏi `visual` (kích thước ảnh, anchor, nguồn ảnh: đổi tự do).
- `src/qa/metrics.ts` — các phép đo dùng chung cho test, script và trình duyệt.
- `golden/worldgen-v1.json` — hash từng stage cho 20 seed `tsvl-01`…`tsvl-20`.
