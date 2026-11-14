# ADR-004: Tách biệt PDF Layout VI Studio (.exe) khỏi Website & Kiến trúc Smart Optimizer

- **Trạng thái**: Đã áp dụng (`v3.4.0` → `v3.5.0`)
- **Bối cảnh**: Phiên bản `.exe` `v3.3.0` nạp lại giao diện web `/dich` khiến người dùng phải đi qua nhiều bước mới thấy bảng chọn CLI, lẫn lộn thành phần marketing website (FAQ, VietQR, navbar) trong ứng dụng Windows. Đồng thời `web_api.prepare()` trả về các trường (`total`, `words`, `chars`, `scanned`, `batches_total`) cần ánh xạ chuẩn xác qua một module seam kiểm thử được.
- **Quyết định**:
  1. **Tách đôi UI**: Website giữ luồng công khai tại gốc repo; Windows `.exe` đóng gói riêng `desktop/app/` + `desktop/server/` + `engine/` với Windows 11 Studio Fluent dark shell.
  2. **Connector Hub kiểu OpenMausBot**: Thanh trái + View `Kết nối AI` là trung tâm kết nối cho 10 nền tảng, hỗ trợ luồng OAuth stream trong app, ô dán mã stdin, Terminal riêng, kho API Key cục bộ, và Ping test đo độ trễ.
  3. **Deep Module & Seams-Based TDD**: Tách các hàm thuần xử lý dữ liệu (`desktop/app/helpers.js`) và rà soát path traversal `/api/output/save` trên `desktop/server/index.mjs`, khóa hành vi bằng `node --test` (`desktop/test/server.test.mjs`).
  4. **Resilience & Observability**: Tự lưu checkpoint bản dịch vào `localStorage`, tự retry với backoff khi CLI lỗi tạm thời, hiển thị Wise Fintech Bento KPI + biểu đồ LieFlat SVG phân bố chất lượng & độ trễ lô, ẩn mọi secret bằng `<REDACTED>` trong log.
- **Hệ quả**: Binary `.exe` gọn hơn (~111 MB), khởi động 100% offline không chạm CDN, có bộ kiểm thử tự động chạy cả ở local lẫn GitHub Actions CI.
