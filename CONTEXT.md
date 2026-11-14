# CONTEXT.md — Ngôn ngữ Miền Thống nhất (`pdf-layout-vi` & `PDF Layout VI Studio`)

Tài liệu khóa cứng thuật ngữ miền (Ubiquitous Language) cho cả Website (`dich.html`) và Ứng dụng Windows (`desktop/app/`):

- **Đoạn chữ (`Segment`)**: Một đơn vị văn bản có tọa độ bounding box trên trang PDF nguồn (ví dụ `p1-1`), được bóc tách bởi `web_api.prepare()`.
- **Lô dịch (`Batch`)**: Tập hợp các `Segment` chưa dịch gom theo ngân sách ký tự (`chunkChars`, mặc định `7000`), trả về từ `web_api.next_items()`.
- **Nền tảng kết nối (`Connector`)**: Công cụ AI chạy cục bộ qua CLI (`Codex`, `Claude Code`, `Gemini CLI`, `Antigravity`, `Muse`, `OpenCode`, `Copilot`, `Qwen`, `Ollama`) hoặc API trực tiếp (`OpenRouter`).
- **Bộ máy Vector (`Vector Engine`)**: Pyodide 0.29.5 + PyMuPDF 1.28.2 WebAssembly + `dich_pdf.py` + `web_api.py` chạy trong Web Worker offline 100%, giữ nguyên chữ thật (selectable/searchable) thay vì rasterize ảnh.
- **Phiếu kiểm định (`QA Scorecard`)**: Kết quả kiểm tra 8 tiêu chí (`qa()`) hoặc 7 chỉ số đối chiếu (`score()`): số trang, ký tự lỗi phông (**Tofu**), tỷ lệ tiếng Việt có dấu / tiếng Anh sót, liên kết nội/ngoại, mất lớp chữ vector, cặp dòng chồng đè, độ trùng bố cục.
- **Cầu nối cục bộ (`Local Bridge`)**: Server Node.js nhúng qua `ELECTRON_RUN_AS_NODE=1` lắng nghe trên `127.0.0.1` cung cấp REST API cho giao diện Studio mà không phụ thuộc Python/Node ngoài hệ thống.
