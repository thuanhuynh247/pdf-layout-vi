# ADR-005 — Kiến Trúc PDF Layout VI Studio v4.0.0 PRO

- **Trạng thái**: Đã áp dụng (`v4.0.0`)
- **Ngày**: 2026-11-23
- **Liên quan**: [ADR-004](ADR-004-desktop-studio-architecture.md), [CONTEXT.md](../CONTEXT.md)

## Bối cảnh
Phiên bản `v3.5.0` đã ổn định lõi dịch đơn tệp qua 10 nền tảng AI, Bento KPI và biểu đồ LieFlat SVG. Để phần mềm đạt đẳng cấp ứng dụng biên tập dịch thuật chuyên nghiệp (tương đương nhóm công cụ CAT + PDF Studio thương mại), cần giải quyết 6 giới hạn thực tế:
1. Người dùng phải mở trình xem PDF ngoài để đối chiếu trang gốc và bản dịch.
2. Chỉ xử lý được từng tệp PDF riêng lẻ, chưa hỗ trợ dịch hàng loạt nhiều tài liệu.
3. Chưa có Bộ nhớ dịch cục bộ (Translation Memory) cho tiêu đề/câu lặp lại và chưa tự chuyển mạch AI (Auto-Failover) khi gặp giới hạn tốc độ.
4. Chưa cho phép sửa tay từng đoạn trực tiếp trong bảng và dựng lại PDF tức thì không tốn lượt AI.
5. Chưa có Từ điển thuật ngữ chuyên ngành (Glossary/Termbase) và Thư viện lịch sử dự án.
6. CORS của máy chủ bridge cục bộ đang dùng wildcard (`*`) thay vì khóa chặt về loopback.

## Quyết định kiến trúc
1. **PyMuPDF Offline Visual Renderer (`engine/web_api.py` + `desktop/app/worker.js`)**:
   - Bổ sung `render_page(which, page_no, zoom)` chạy hoàn toàn trong WebAssembly offline, trả PNG base64 cho chế độ xem **Song song (Side-by-Side)** và **Kéo rèm so sánh từng pixel (Split Curtain Slider)**.
2. **Persistence Stores cách ly (`desktop/server/tm-store.mjs`, `history-store.mjs`, `config-store.mjs`)**:
   - Hỗ trợ biến môi trường `PDF_LAYOUT_DATA_DIR` giúp bộ kiểm thử `node:test` cách ly hoàn toàn, không ghi đè dữ liệu `%APPDATA%` của người dùng.
   - Ghi tệp nguyên tử (`write tmp -> rename`) tránh hỏng JSON khi đóng đột ngột.
   - Lưu **Translation Memory** (tối đa 50.000 mục LRU, tra cứu 0ms theo khóa chuẩn hóa `dir|text`), **5 bộ từ điển mẫu** (*Học thuật, Tài chính, Kỹ thuật, Pháp lý, Y sinh*) + từ điển tùy chỉnh, **chuỗi Auto-Failover** và **Lịch sử 200 dự án gần nhất**.
3. **Bảo mật Loopback-Only CORS (`desktop/server/index.mjs`)**:
   - Mọi request `/api/*` có header `Origin` không thuộc `http(s)://127.0.0.1` hoặc `localhost` bị từ chối với `HTTP 403`.
4. **Pro Studio UX (`ui-ux-pro`)**:
   - Bộ biểu tượng SVG thuần, chuyển đổi **Obsidian Dark / Editorial Light** đồng bộ `titleBarOverlay` của Windows 11, **Command Palette (`Ctrl+K`)**, phím tắt `Alt+1..6`, thông báo Windows gốc (`Notification`), xuất song ngữ **CSV (UTF-8 BOM) / Markdown / TMX 1.4 / JSON**, và test tự động kiểm tra khớp 100% DOM ID giữa `app.js` và `index.html`.
