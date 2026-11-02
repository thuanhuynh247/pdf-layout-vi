# ADR-002: Gửi email qua Mailtrap từ hello@huynhanhthuan.com, website chạy ở pdf.huynhanhthuan.com

**Trạng thái:** Chấp nhận
**Ngày:** 01/11/2026
**Người quyết định:** Huỳnh Anh Thuận
**Thay thế:** phần “gửi email bằng Gmail (MailApp)” và “tên miền .vercel.app” của [ADR-001](ADR-001-kien-truc-phat-hanh.md). Các phần còn lại của ADR-001 (trang tĩnh Vercel, Apps Script, Google Sheets, Drive, VietQR tĩnh) giữ nguyên.

## Bối cảnh

Anh Thuận đã có tên miền `huynhanhthuan.com` (DNS và hộp thư `hello@` đặt ở PIA) và tài khoản Mailtrap. ADR-001 dùng Gmail cá nhân vì lúc đó chưa có tên miền; hạn chế là 100 email/ngày, người nhận thấy địa chỉ @gmail.com, và tên miền website (.vercel.app) không khớp tên miền email.

Số liệu gói Mailtrap Free (trang giá Mailtrap, đọc ngày 01/11/2026): 4.000 email/tháng, 150 email/ngày, 1 tên miền, giữ nhật ký 3 ngày. Vượt hạn mức ngày thì Mailtrap từ chối, không gửi. Gói Basic $15/tháng: 10.000 email, không giới hạn ngày.

## Quyết định

1. **Email đăng ký** gửi qua Mailtrap Email API, luồng **Transactional** (`https://send.api.mailtrap.io/api/send`), từ `hello@huynhanhthuan.com`, Reply-To cùng địa chỉ (về hộp thư ở PIA).
2. **Thông báo phiên bản mới** gửi qua luồng **Bulk** (`https://bulk.api.mailtrap.io/api/send`). Mailtrap yêu cầu email mang tính thông báo/marketing đi luồng Bulk, và luồng này tự thêm liên kết hủy đăng ký cùng header `List-Unsubscribe`.
3. **Chỉ dùng Mailtrap** (anh chọn): không gửi dự phòng bằng Gmail cho người đăng ký. Khi Mailtrap từ chối, đăng ký vẫn được ghi và xếp hàng, trigger mỗi giờ gửi lại. Gmail chỉ dùng để gửi **cảnh báo nội bộ cho anh**, tối đa 1 lần/ngày.
4. **Token Mailtrap** lưu trong Script Properties (`MAILTRAP_TOKEN`), không nằm trong mã nguồn hay repo.
5. **Website** chạy ở `pdf.huynhanhthuan.com` (CNAME tại PIA trỏ về Vercel), cùng tên miền với địa chỉ gửi.

## Phương án đã cân nhắc

| | Mailtrap + Gmail dự phòng | **Chỉ Mailtrap** (chọn) | Giữ Gmail |
|---|---|---|---|
| Địa chỉ người nhận thấy | Thường là hello@, đôi khi @gmail.com | Luôn là hello@ | @gmail.com |
| Sức chứa/ngày | ~245 | 145 (chừa 5) | 95 |
| Khi token hết hạn | Vẫn gửi được (bằng Gmail) | Xếp hàng tới khi anh sửa, có cảnh báo | Không áp dụng |
| Độ phức tạp | Cao nhất (2 đường gửi) | Trung bình | Thấp |

## Xử lý lỗi Mailtrap

| Phản hồi | Ý nghĩa (theo tài liệu Mailtrap) | Hệ thống làm gì |
|---|---|---|
| 200 `success: true` | Đã nhận | Ghi “Đã gửi”, cộng bộ đếm ngày/tháng |
| 401 | Sai token | Xếp hàng, tạm dừng 1 giờ, cảnh báo anh |
| 403 | Tên miền chưa xác thực / token thiếu quyền | Như 401 |
| Lỗi có chữ limit/quota/exceed | Hết hạn mức gói | Xếp hàng, coi như hết hạn mức hôm nay, cảnh báo anh |
| 429 | Quá 150 request/10 giây | Xếp hàng, nghỉ 1 phút |
| 400 khác | Dữ liệu một thư không hợp lệ (ví dụ địa chỉ hỏng) | “Lỗi gửi”, thử tối đa 3 lần, không chặn người khác |
| 5xx, mất mạng | Trục trặc tạm thời | Như 400 |

Hệ thống **tự đếm** số email đã gửi theo ngày/tháng UTC để dừng ở 145/150 và 3.995/4.000, vì API không trả về hạn mức còn lại. Mailtrap không công bố múi giờ reset hạn mức; nếu lệch, nhánh “Mailtrap báo hết hạn mức” vẫn giữ an toàn.

## Hệ quả

- Dễ hơn: thư đến từ tên miền riêng, có DKIM/DMARC của chính anh nên ít vào Spam hơn; xem nhật ký gửi, mở, nhấp trong Mailtrap; sức chứa tăng từ 95 lên 145 email/ngày.
- Khó hơn: có thêm 1 dịch vụ và 1 bí mật (token) phải giữ. **Token Mailtrap mặc định hết hạn sau 365 ngày.** Khi đó email sẽ dừng; hệ thống báo cho anh qua Gmail.
- Người bấm hủy đăng ký trong email Bulk được Mailtrap tự chặn gửi tiếp, nhưng cột “Nhận cập nhật” trong sheet không tự đổi. Khi tổng hợp số liệu cần lưu ý điều này.
- Cần xem lại khi: thường xuyên có dòng “Chờ gửi” do hết hạn mức → nâng Mailtrap Basic rồi sửa `MAILTRAP.DAILY_LIMIT`, `MONTHLY_LIMIT`.

## Việc cần làm

1. [ ] Mailtrap: tên miền `huynhanhthuan.com` ở trạng thái Verified (4 CNAME + 1 TXT DMARC tại PIA)
2. [ ] Tạo API token quyền Admin cho tên miền, đặt hạn dùng, ghi ngày hết hạn vào lịch
3. [ ] Dán token vào Script Properties `MAILTRAP_TOKEN`, chạy `guiThuChoToi`, kiểm tra SPF/DKIM/DMARC đều PASS
4. [ ] Thêm `pdf.huynhanhthuan.com` vào Vercel, tạo CNAME tại PIA theo giá trị Vercel hiển thị
