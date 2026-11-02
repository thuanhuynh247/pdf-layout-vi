# pdf-layout-vi — website phát hành gói kỹ năng pdf-translation-layout

Trang tĩnh (HTML/CSS/JS thuần, không cần build) deploy trên Vercel tại https://pdf.huynhanhthuan.com. Đăng ký → Google Apps Script → Google Sheets, email gửi từ hello@huynhanhthuan.com qua Mailtrap Email API.

```
index.html, privacy.html     Trang chính, chính sách dữ liệu
config.js                    ← tệp duy nhất cần sửa (URL Apps Script, phiên bản)
assets/css/tokens.css        Design tokens (màu, chữ, khoảng cách) — xem docs/DESIGN_SYSTEM.md
assets/css/site.css          Component
assets/js/main.js            So sánh trang, khung chữ, form, sao chép, VietQR
assets/js/p13-boxes.js       Khung chữ trang 13 trích từ layout log thật
assets/img, assets/fonts     Ảnh render từ PDF thật, VietQR, OG, Plus Jakarta Sans (subset)
assets/media                 Video demo đọc song ngữ trang 13 (2,97 MB) và 2 mẫu giọng đọc MP3, xuất từ engine v3.0.1
vercel.json                  Header bảo mật (CSP), cache
.vercelignore                Không đưa apps-script/, docs/, tools/, release/ lên web

apps-script/Code.gs          Máy chủ đăng ký (dán vào Apps Script của Google Sheet). Token Mailtrap để ở Script Properties MAILTRAP_TOKEN, không đưa vào repo
apps-script/test/            Kiểm thử Code.gs bằng Node (giả lập dịch vụ Google): node apps-script/test/code.test.js
tools/make_vietqr.py         Sinh lại ảnh VietQR nếu đổi tài khoản
docs/ADR-001-…md             Quyết định kiến trúc ban đầu
docs/ADR-002-…md             Chuyển sang Mailtrap + pdf.huynhanhthuan.com
docs/DESIGN_SYSTEM.md        Design system "Proof Sheet"
release/                     Gói kỹ năng v3.0.1 đã làm sạch (zip để tải lên Drive)
HUONG_DAN_TRIEN_KHAI.md      Hướng dẫn từng bước cho người không lập trình
```

Chạy thử trên máy: `python -m http.server 8000` trong thư mục này rồi mở http://localhost:8000.
