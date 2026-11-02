# ADR-001: Kiến trúc website phát hành miễn phí gói kỹ năng pdf-translation-layout

**Trạng thái:** Chấp nhận, phần gửi email và tên miền đã được thay bằng [ADR-002](ADR-002-gui-email-qua-mailtrap.md)
**Ngày:** 01/11/2026
**Người quyết định:** Huỳnh Anh Thuận

## Bối cảnh

Cần một website phát hành miễn phí gói kỹ năng `pdf-translation-layout` v3.0.1 cho người dùng Antigravity, Claude Code và ChatGPT. Người dùng để lại thông tin, nhận email gồm link tải, hướng dẫn cài theo nền tảng và thông tin ủng hộ cà phê qua Vietcombank.

Ràng buộc:

| Ràng buộc | Ý nghĩa với thiết kế |
|---|---|
| Chi phí 0đ | Chỉ dùng gói miễn phí, không mua tên miền ở giai đoạn đầu |
| Người vận hành không lập trình | Không có máy chủ, không có cơ sở dữ liệu phải bảo trì; dữ liệu xem được trong công cụ quen thuộc (Google Sheets) |
| Tải dự kiến thấp–vừa | Vài chục đến vài trăm đăng ký mỗi ngày lúc cao điểm sau một bài Facebook |
| Email phải vào hộp thư chính | Người gửi cần là một hộp thư thật có uy tín, không phải tên miền lạ |
| Dữ liệu cá nhân | Thu họ tên, email: cần sự đồng ý rõ ràng và chính sách dữ liệu |

## Quyết định

**Trang tĩnh trên Vercel + Google Apps Script làm máy chủ đăng ký + Google Sheets làm cơ sở dữ liệu + Gmail (MailApp) gửi email + Google Drive lưu tệp zip + VietQR tạo sẵn dạng ảnh tĩnh.**

```
Trình duyệt ──POST JSON (text/plain)──▶ Apps Script Web App (doPost)
   │                                         │ 1. bẫy bot, kiểm tra dữ liệu, giới hạn 20 lượt/phút
   │                                         │ 2. khóa ghi, chống trùng email
   │                                         ├──▶ Google Sheets "DangKy" (1 dòng / người)
   │                                         └──▶ MailApp: email HTML + link Drive + VietQR
   │                                                 └─ hết 100 email/ngày → "Chờ gửi"
   ◀──── {ok, sent | queued | duplicate} ────┘
Trigger mỗi giờ: xuLyHangDoi() gửi bù hàng chờ, rồi gửi thông báo phiên bản mới
```

## Các phương án đã cân nhắc

### A. Vercel (tĩnh) + Google Apps Script + Sheets + Gmail — **chọn**

| Tiêu chí | Đánh giá |
|---|---|
| Độ phức tạp | Thấp: 1 tệp `Code.gs`, 1 tệp `config.js` |
| Chi phí | 0đ |
| Khả năng mở rộng | 100 email/ngày (Gmail cá nhân), xếp hàng phần vượt; 1.500/ngày nếu chuyển sang Google Workspace |
| Mức quen thuộc | Cao: dữ liệu nằm trong Google Sheets, có sẵn sheet thống kê |

**Ưu:** Không cần tên miền, email đến từ Gmail thật nên ít vào spam, dữ liệu xem và lọc ngay trong Sheets, không có khóa API nào phải giữ bí mật trên website.
**Nhược:** Trần 100 email/ngày; Apps Script khởi động nguội 1–3 giây; URL Web App công khai nên phải tự chống spam (đã có bẫy bot, giới hạn theo phút, chống trùng).

### B. Vercel + Serverless Function + Resend/Brevo + Vercel KV/Supabase

| Tiêu chí | Đánh giá |
|---|---|
| Độ phức tạp | Trung bình–cao: mã Node, biến môi trường, 2–3 dịch vụ |
| Chi phí | 0đ cho dịch vụ, nhưng cần mua tên miền để xác thực người gửi (SPF/DKIM) |
| Khả năng mở rộng | Cao hơn (hàng nghìn email/ngày) |
| Mức quen thuộc | Thấp: dữ liệu nằm trong bảng điều khiển của dịch vụ |

**Ưu:** Hạn mức email lớn, theo dõi mở/nhấp.
**Nhược:** Phải có tên miền riêng; gửi bằng địa chỉ @gmail.com qua dịch vụ bên thứ ba dễ bị đánh dấu spam; nhiều chỗ cấu hình hơn cho người không lập trình.

### C. Google Form + Apps Script gửi email

**Ưu:** Dễ nhất. **Nhược:** Không có trang giới thiệu sản phẩm đúng nghĩa, giao diện Form không trình diễn được điểm mạnh (so sánh trang, khung chữ), khó tùy biến trải nghiệm sau khi gửi.

### D. GitHub công khai, không đăng ký

**Ưu:** Không có gì phải vận hành. **Nhược:** Không thu được email người dùng, không gửi được hướng dẫn theo nền tảng và lời mời ủng hộ. Anh đã chọn phát hành qua link Drive trong email.

## Phân tích đánh đổi

- **Hạn mức email là điểm nghẽn duy nhất đáng kể.** Một bài Facebook tốt có thể mang về vài trăm đăng ký trong 1 ngày. Thiết kế chấp nhận trễ tối đa ~24 giờ cho người vượt hạn mức thay vì mất đăng ký: dòng được ghi trước, email gửi sau. Trang báo rõ cho người dùng “email sẽ đến trong 24 giờ”.
- **Cổng đăng ký là “cổng mềm”.** Link Drive nằm trong email, ai có link vẫn chia sẻ được. Với gói miễn phí giấy phép MIT, mục tiêu là có liên hệ người dùng, không phải chặn sao chép.
- **Vercel Hobby chỉ cho dùng phi thương mại.** Theo Fair Use Guidelines của Vercel (cập nhật 14/09/2026): “Asking for Donations does not fall under commercial usage.” Lời mời ủng hộ cà phê nằm trong phạm vi cho phép. Nếu sau này bán bản trả phí trên cùng website, cần chuyển gói Pro hoặc chuyển sang Cloudflare Pages.
- **Mã VietQR tạo sẵn thành ảnh tĩnh** (`tools/make_vietqr.py`, chuẩn EMVCo/NAPAS, BIN Vietcombank 970436) thay vì gọi dịch vụ ngoài lúc chạy: không phụ thuộc bên thứ ba, không lộ lượt xem trang cho bên khác. Đã giải mã lại ảnh để đối chiếu nội dung và mã CRC.

## Hệ quả

- Dễ hơn: vận hành hằng ngày chỉ là mở Google Sheets; đổi link tải hay phiên bản chỉ sửa `CONFIG` trong Apps Script; đổi giao diện chỉ cần đẩy lên GitHub.
- Khó hơn: không có thống kê mở email; muốn vượt 100 email/ngày phải đổi tài khoản Workspace hoặc chuyển sang phương án B.
- Cần xem lại khi: đăng ký vượt ~80/ngày trong nhiều ngày liên tiếp, hoặc khi có bản trả phí.

## Việc cần làm

1. [ ] Tạo Google Sheet, dán `Code.gs`, chạy `caiDat()`, triển khai Web App
2. [ ] Tải `pdf-translation-layout-v3.0.1.zip` lên Drive, chia sẻ “Bất kỳ ai có đường liên kết”, điền `DOWNLOAD_URL`
3. [ ] Đưa thư mục website lên GitHub (repo riêng tư), nhập vào Vercel, điền `APPS_SCRIPT_URL` trong `config.js`
4. [ ] Quét thử mã VietQR bằng app ngân hàng thật trước khi công bố
5. [ ] Đăng ký thử bằng 2 email (Gmail và Outlook), kiểm tra hộp thư chính và Spam
6. [ ] Theo dõi sheet `ThongKe` tuần đầu; nếu thường xuyên có “Chờ gửi”, cân nhắc Workspace
