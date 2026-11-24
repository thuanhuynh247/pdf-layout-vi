# pdf-layout-vi — website phát hành gói kỹ năng pdf-translation-layout

Trang tĩnh (HTML/CSS/JS thuần, không cần build) deploy trên Vercel tại https://pdf.huynhanhthuan.com. Đăng ký → Google Apps Script → Google Sheets, email gửi từ hello@huynhanhthuan.com qua Mailtrap Email API.

```
index.html, privacy.html     Trang chính, chính sách dữ liệu
dich.html                    Dịch PDF ngay trên trình duyệt (bản tháng 12): Dán qua AI bất kỳ, khóa OpenRouter, Translator API của Chrome; chấm bản dịch có sẵn
engine/                      Bộ máy chạy trong trình duyệt: Pyodide 0.29.5, PyMuPDF 1.28.2 (WebAssembly), phông, dich_pdf.py, web_api.py. Lắp lại bằng tools/dung_web.py của kho công cụ.
                             Mặc định (ENGINE_SOURCE "cdn") Pyodide và PyMuPDF tải từ jsDelivr và PyPI, kiểm SHA-256; engine/pyodide và file .whl chỉ là bản dự phòng (xem docs/ADR-003)
assets/js/dich-app.js, dich-worker.js   Giao diện và Web Worker của trang dịch
y-duoc.html                  Trang giới thiệu bản Y Dược v4.1 (Anh → Việt, Pháp → Việt, kiểm liều và đơn vị đo); /dich?linh-vuc=y-duoc bật sẵn chế độ Y Dược
dung-voi-claude.html         Hướng dẫn 4 bước dùng trong Claude.ai, không cài gì (bản 3.1)
chat-luong.html              Đo chất lượng: bộ chấm, kết quả đo, file để kiểm lại
tai-ve/                      File tải thẳng bản 3.1: skill cho Claude, plugin Antigravity (công khai)
benchmark/                   File mẫu, kết quả và phiếu kiểm định cho trang đo chất lượng (công khai)
config.js                    ← tệp duy nhất cần sửa (URL Apps Script, phiên bản, nguồn tải bộ máy, link GPT, link GitHub)
assets/css/tokens.css        Design tokens (màu, chữ, khoảng cách) — xem docs/DESIGN_SYSTEM.md
assets/css/site.css          Component
assets/js/main.js            So sánh trang, khung chữ, form, sao chép, VietQR
assets/js/p13-boxes.js       Khung chữ trang 13 trích từ layout log thật
assets/img, assets/fonts     Ảnh render từ PDF thật, VietQR, OG, Plus Jakarta Sans (subset)
assets/media                 Video demo đọc song ngữ trang 13 (2,97 MB) và 2 mẫu giọng đọc MP3, xuất từ engine v3.0.1
vercel.json                  Header bảo mật (CSP), cache
.vercelignore                Không đưa apps-script/, docs/, tools/, release/ và file .py ở thư mục gốc lên web (engine/*.py vẫn được đưa lên)

apps-script/Code.gs          Máy chủ đăng ký (dán vào Apps Script của Google Sheet). Token Mailtrap để ở Script Properties MAILTRAP_TOKEN, không đưa vào repo
apps-script/test/            Kiểm thử Code.gs bằng Node (giả lập dịch vụ Google): node apps-script/test/code.test.js
tools/make_vietqr.py         Sinh lại ảnh VietQR nếu đổi tài khoản
docs/ADR-001-…md             Quyết định kiến trúc ban đầu
docs/ADR-002-…md             Chuyển sang Mailtrap + pdf.huynhanhthuan.com
docs/ADR-003-…md             Trang /dich tải bộ máy từ jsDelivr và PyPI để giảm băng thông Vercel
docs/DESIGN_SYSTEM.md        Design system "Proof Sheet"
release/                     Gói nâng cao v3.0.1 đã làm sạch (zip để tải lên Drive, không đưa lên web)
HUONG_DAN_TRIEN_KHAI.md      Hướng dẫn từng bước cho người không lập trình
desktop/                     PDF Layout VI Studio v4.0.0 PRO (.exe trên Windows, tách biệt hoàn toàn layout website): Kết nối 10 nền tảng AI + Auto-Failover, Bộ nhớ dịch TM 0ms, Xem trực quan so sánh PDF Gốc↔Dịch (Side-by-Side & Split Curtain Slider), Hàng đợi đa tệp (Batch Queue), Từ điển thuật ngữ (5 bộ mẫu), Biên tập trực tiếp & dựng lại PDF tức thì, Lịch sử dự án, Command Palette (Ctrl+K), Dark/Light Theme & Loopback-only CORS
docs/ADR-004-…md, ADR-005…   Kiến trúc Desktop Studio v3.5 → v4.0 PRO, schema web_api & đường biên bảo mật
CONTEXT.md                   Ngôn ngữ Miền Thống nhất (Ubiquitous Language) cho dự án
.github/workflows/package-win.yml  CI tự động test & đóng gói PDF-Layout-VI-*-setup.exe & portable.exe trên GitHub Releases
```

Chạy thử bản web trên máy: `python -m http.server 8000` trong thư mục này rồi mở http://localhost:8000.  
Chạy / kiểm thử / đóng gói app Windows Desktop (`.exe`):
```bash
cd desktop
npm install
npm test           # Chạy kiểm thử unit & HTTP seam (node:test)
npm start          # Mở ứng dụng Electron + AI CLI Bridge
npm run build:win  # Đóng gói NSIS Setup & Portable .exe vào desktop/release/
npm run build:win:yduoc  # Ấn bản Y Dược (appId riêng, cài song song) vào desktop/release-yduoc/
# Chạy thử ấn bản Y Dược khi phát triển: PDF_LAYOUT_EDITION=y-duoc npm start
```
