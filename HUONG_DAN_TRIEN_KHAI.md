# Hướng dẫn triển khai website phát hành pdf-translation-layout

Kết quả sau khi làm xong:

- Website ở **https://pdf.huynhanhthuan.com**
- Người đăng ký nhận email từ **hello@huynhanhthuan.com**, gửi qua Mailtrap
- Danh sách đăng ký nằm trong Google Sheets của anh

Thời gian: khoảng 45–60 phút, cộng thời gian chờ DNS cập nhật (thường 15 phút đến vài giờ). Không cần viết code. Chi phí: 0đ với gói Mailtrap Free, Vercel Hobby và Google miễn phí.

Cần có: tài khoản Mailtrap, quyền quản lý DNS tên miền `huynhanhthuan.com` ở PIA, 1 tài khoản Google, GitHub và Vercel.

Thứ tự làm: **Mailtrap → Drive → Sheets + Apps Script → GitHub → Vercel + tên miền → kiểm tra.**

> **Bản ghi DNS là gì?** Là các dòng cấu hình trong trang quản lý tên miền ở PIA. Mỗi dòng có **Loại** (CNAME, TXT…), **Tên/Host** và **Giá trị**. Hướng dẫn này cần 5 dòng cho Mailtrap và 1 dòng cho website. Thêm các dòng mới không ảnh hưởng website hay hộp thư hiện có của anh.

---

## Bước 1 — Mailtrap: xác thực tên miền và tạo token (15 phút + chờ DNS)

### 1a. Kiểm tra tên miền

1. Đăng nhập [mailtrap.io](https://mailtrap.io) → mục **Sending Domains**.
2. Nếu `huynhanhthuan.com` đã có trạng thái **Verified** (cả DKIM và DMARC đều xanh): chuyển sang bước 1b.
3. Nếu chưa: bấm vào tên miền → trang **Domain Verification** liệt kê 5 bản ghi: **4 CNAME** (xác thực tên miền, `rwmt1._domainkey`, `rwmt2._domainkey`, tên miền theo dõi) và **1 TXT** cho DMARC (`_dmarc`). Mở trang quản lý DNS của `huynhanhthuan.com` ở PIA và thêm từng dòng, chép đúng Tên và Giá trị Mailtrap hiển thị.

Lưu ý khi thêm ở PIA:

- **Ô Tên/Host:** xem các bản ghi có sẵn đang ghi theo kiểu nào rồi làm y như vậy. Nếu bên cạnh ô nhập đã có sẵn đuôi `.huynhanhthuan.com` thì chỉ gõ `rwmt1._domainkey`, đừng gõ cả tên miền (sẽ thành `rwmt1._domainkey.huynhanhthuan.com.huynhanhthuan.com`).
- **DMARC:** một tên miền chỉ được có 1 bản ghi TXT ở `_dmarc`. Nếu PIA đã tạo sẵn một bản ghi như vậy thì **sửa** dòng đó theo giá trị Mailtrap đưa, đừng thêm dòng thứ hai.
- **Không sửa bản ghi SPF và MX** đang có (chúng phục vụ hộp thư hello@ ở PIA). Mailtrap không yêu cầu đổi SPF ở tên miền gốc.
- Nếu tên miền đang dùng nameserver của nơi khác (ví dụ Cloudflare) thì thêm bản ghi ở nơi đó, không phải ở PIA.

Quay lại Mailtrap, bấm **Re-check DNS Records**. DNS thường cập nhật trong 15 phút đến vài giờ, hiếm khi tới 24 giờ. Mailtrap cũng tự kiểm tra lại mỗi giờ.

### 1b. Tạo API token

1. Mailtrap → **Settings → API Tokens → Add Token**.
2. Tên: `pdf-layout-website`. Tick quyền **Admin** ở dòng tên miền `huynhanhthuan.com` (Mailtrap yêu cầu quyền Admin trên tên miền để gửi).
3. Hạn dùng: chọn **365 ngày**, rồi **ghi ngày hết hạn vào lịch** để thay token trước hạn.
4. **Save** → sao chép token ngay. Mailtrap chỉ hiện đầy đủ token một lần.

> Token giống mật khẩu: không dán vào code, không gửi qua chat, không đưa lên GitHub. Chỉ dán vào Script Properties ở Bước 3.

---

## Bước 2 — Đưa gói kỹ năng lên Google Drive (3 phút)

1. Mở [drive.google.com](https://drive.google.com) → **Mới → Tải tệp lên** → chọn `pdf-translation-layout-v3.0.1.zip` (thư mục `release-website/release/`).
2. Chuột phải vào tệp → **Chia sẻ → Chia sẻ** → **Quyền truy cập chung**: chọn **Bất kỳ ai có đường liên kết**, vai trò **Người xem** → **Sao chép đường liên kết** → **Xong**.
https://drive.google.com/file/d/1r_LG2brc-KKeJssTjEInCVAel8B1vCNV/view?usp=sharing
> Có bản mới: chuột phải tệp → **Thông tin tệp → Quản lý phiên bản → Tải phiên bản mới lên**. Link giữ nguyên.

---

## Bước 3 — Máy chủ đăng ký: Google Sheets + Apps Script (15 phút)

1. Mở [sheets.new](https://sheets.new) → đặt tên `PDF Layout - Đăng ký`.
2. **Tiện ích mở rộng → Apps Script**.
3. Xóa nội dung có sẵn trong `Mã.gs`, dán **toàn bộ** nội dung tệp `apps-script/Code.gs`.
4. Phần `CẤU HÌNH` ở đầu tệp: dán link Drive vào `DOWNLOAD_URL`. Các dòng `SITE_URL`, `FROM_EMAIL`, `REPLY_TO` đã điền sẵn `pdf.huynhanhthuan.com` và `hello@huynhanhthuan.com`. Bấm **Lưu**.
5. **Lưu token Mailtrap:** bấm **Cài đặt dự án** (bánh răng bên trái) → kéo xuống **Thuộc tính tập lệnh** → **Thêm thuộc tính tập lệnh**:
   - Thuộc tính: `MAILTRAP_TOKEN`
   - Giá trị: dán token ở Bước 1b
   - Bấm **Lưu thuộc tính tập lệnh**.
6. Quay lại **Trình chỉnh sửa** (biểu tượng `< >`) → chọn hàm **caiDat** → **▶ Chạy**.
   - “Cần cấp quyền” → **Xem xét quyền** → chọn tài khoản Google → “Google chưa xác minh ứng dụng này” là bình thường với script của chính anh: **Nâng cao → Đi tới … (không an toàn) → Cho phép**.
   - Quyền script xin: sửa bảng tính này; kết nối dịch vụ ngoài (gọi Mailtrap, tải ảnh QR); chạy theo lịch; gửi email bằng Gmail (**chỉ để gửi cảnh báo cho chính anh** khi Mailtrap lỗi).
7. **Gửi thử qua Mailtrap:** chọn hàm **guiThuChoToi** → **▶ Chạy** → xem **Nhật ký thực thi** bên dưới:
   - `✓ Mailtrap đã nhận…`: mở Gmail. Thư phải đến từ **hello@huynhanhthuan.com**. Mở thư → **⋮ → Hiển thị bản gốc**: ba dòng **SPF, DKIM, DMARC** đều phải là **PASS**.
   - `✗ Mailtrap 401…`: token sai hoặc dán thiếu, làm lại mục 5.
   - `✗ Mailtrap 403…`: tên miền chưa Verified hoặc token thiếu quyền Admin, xem lại Bước 1.
8. **Triển khai → Tùy chọn triển khai mới** → bánh răng → **Ứng dụng web**:
   - Thực thi dưới dạng: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**
   - **Triển khai** → sao chép **URL ứng dụng web** (kết thúc bằng `/exec`).

> **Quan trọng:** mỗi lần sửa `Code.gs` (kể cả phần CONFIG), phải cập nhật bản triển khai: **Triển khai → Quản lý các tùy chọn triển khai → ✏ → Phiên bản: Phiên bản mới → Triển khai.** URL giữ nguyên.
> Đổi token **không** cần triển khai lại: chỉ sửa giá trị trong Thuộc tính tập lệnh.

---

## Bước 4 — Điền URL máy chủ vào website (1 phút)

Mở `config.js` bằng Notepad, dán URL ở Bước 3.8:

```js
APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfy.../exec", 
```

---

## Bước 5 — Đưa website lên GitHub (5 phút)

1. [github.com/new](https://github.com/new) → tên `pdf-layout-vi` → **Private** → **Create repository**.
2. Bấm **uploading an existing file** → mở thư mục `release-website`, chọn **tất cả bên trong** (Ctrl+A), kéo thả vào trang → **Commit changes**.

---

## Bước 6 — Vercel và tên miền pdf.huynhanhthuan.com (10 phút + chờ DNS)

1. [vercel.com/signup](https://vercel.com/signup) → **Hobby** → **Continue with GitHub**.
2. **Add New… → Project** → `pdf-layout-vi` → **Import** → Framework Preset: **Other** → **Deploy**.
3. Vào project → **Settings → Domains → Add Domain** → gõ `pdf.huynhanhthuan.com` → **Add**.
4. Vercel hiển thị 1 bản ghi **CNAME**: Tên `pdf`, Giá trị là một địa chỉ riêng của project (dạng `xxxxxxxx.vercel-dns-0xx.com`). **Chép đúng giá trị Vercel hiển thị**, đừng dùng giá trị mẫu trên mạng.
5. Ở PIA, thêm bản ghi: Loại **CNAME**, Tên `pdf`, Giá trị như trên. Nếu đã có sẵn bản ghi A hoặc CNAME tên `pdf` thì xóa hoặc sửa nó, vì một tên chỉ được trỏ một nơi.
6. Quay lại Vercel, đợi dòng tên miền chuyển sang **Valid Configuration**. Vercel tự cấp chứng chỉ HTTPS miễn phí.

> Kiểm tra DNS nhanh trên Windows: mở Command Prompt, gõ `nslookup -type=CNAME pdf.huynhanhthuan.com`. Thấy địa chỉ vercel-dns là đã trỏ đúng.

Từ giờ mỗi lần sửa tệp trên GitHub, Vercel tự đăng bản mới sau khoảng 30 giây.

---

## Bước 7 — Kiểm tra trước khi công bố (10 phút)

- [ ] Mở https://pdf.huynhanhthuan.com trên máy tính và điện thoại: có ổ khóa HTTPS, kéo được thanh so sánh EN/VI.
- [ ] Đăng ký bằng 1 Gmail và 1 email khác (Outlook, Yahoo, email công ty). Thư từ **hello@huynhanhthuan.com** vào **Hộp thư chính**. Nếu vào Spam, bấm “Không phải thư rác” và kiểm tra lại SPF/DKIM/DMARC như Bước 3.7.
- [ ] Ảnh mã QR hiển thị ngay trong email (Mailtrap đính kèm ảnh vào thư).
- [ ] Bấm **Trả lời** email: địa chỉ nhận là hello@huynhanhthuan.com, gửi thử 1 thư và xem đã về hộp thư ở PIA chưa.
- [ ] Nút tải trong email tải được zip mà không cần đăng nhập Google.
- [ ] **Quét mã VietQR bằng app ngân hàng thật** (trên web và trong email): người nhận HUYNH ANH THUAN, số tài khoản 0161001623062. Thử cả mức 30.000đ. Chỉ cần mở tới màn hình xác nhận.
- [ ] Sheet `DangKy` có 2 dòng “Đã gửi”. Mailtrap → **Email Logs** thấy 2 thư trạng thái Delivered.
- [ ] Dán link vào [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) → **Scrape Again**.
- [ ] Xóa các dòng thử trong sheet trước khi công bố.

---

## Vận hành hằng ngày

| Việc | Cách làm |
|---|---|
| Xem ai đăng ký | Sheet `DangKy`; số liệu ở sheet `ThongKe` |
| Xem hạn mức email | Apps Script → chạy **xemHanMuc**. Gói Free: 150/ngày, 4.000/tháng; hệ thống tự dừng ở 145 và 3.995 rồi xếp hàng phần vượt |
| Xem thư đã gửi, mở, lỗi | Mailtrap → **Email Logs** (gói Free giữ 3 ngày) |
| Biết người đến từ đâu | Gắn `?utm_source=facebook` (hoặc `zalo`, `nhom-ai`…) vào link chia sẻ. Cột **Nguồn** ghi lại |
| Người xin ngừng nhận tin | Sửa cột **Nhận cập nhật** thành `Không`. Người bấm link hủy trong email thông báo được Mailtrap tự chặn, nhưng sheet không tự đổi |
| Người xin xóa dữ liệu | Xóa dòng của họ trong sheet |
| Email lỗi | Cột **Ghi chú** ghi mã lỗi Mailtrap. Gửi lại: đổi Trạng thái thành `Chờ gửi`, Số lần gửi thành `0` |
| Nhận email cảnh báo “Mailtrap từ chối gửi” | Làm theo hướng dẫn trong thư (thường là token hết hạn). Các đăng ký trong lúc lỗi vẫn được giữ và tự gửi lại mỗi giờ sau khi sửa |

### Thay token khi sắp hết hạn

Mailtrap → **API Tokens** → tạo token mới (quyền Admin cho tên miền) → Apps Script → **Cài đặt dự án → Thuộc tính tập lệnh** → sửa `MAILTRAP_TOKEN` → chạy **guiThuChoToi** để thử. Không cần triển khai lại.

### Khi đăng ký vượt hạn mức thường xuyên

Nếu sheet thường có dòng “Chờ gửi” vì hết hạn mức: nâng Mailtrap lên gói **Basic** ($15/tháng, 10.000 email, không giới hạn ngày), rồi sửa `MAILTRAP.DAILY_LIMIT` (ví dụ `10000`) và `MONTHLY_LIMIT` (`10000`) trong CONFIG → cập nhật bản triển khai.

## Phát hành phiên bản mới

1. Drive: **Quản lý phiên bản → Tải phiên bản mới lên** (link giữ nguyên).
2. `Code.gs`: sửa `VERSION`, `PACKAGE_NAME`, `PACKAGE_SIZE`, `UPDATE_SUBJECT`, `UPDATE_MESSAGE` → Lưu → cập nhật bản triển khai.
3. Chạy **guiThongBaoPhienBanMoi**: gửi qua luồng **Bulk** của Mailtrap, chỉ tới người đã tick nhận cập nhật, mỗi người 1 lần. Mailtrap tự thêm link hủy đăng ký. Vượt hạn mức thì hệ thống tự gửi tiếp mỗi giờ.
4. GitHub: sửa `VERSION` trong `config.js`.

> Tài liệu Mailtrap không nói rõ luồng Bulk có trong gói Free hay không (luồng Bulk dùng chung tên miền đã xác thực và chung token). Lần đầu nên gửi thông báo khi danh sách còn nhỏ; nếu cột Ghi chú báo lỗi 401/403 kèm chữ “Báo bản”, kiểm tra mục Bulk Stream trong tài khoản Mailtrap hoặc hỏi hỗ trợ Mailtrap về gói của anh.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Form báo “Không kết nối được máy chủ” | Sai URL trong `config.js`, hoặc khi triển khai chưa chọn “Bất kỳ ai” | URL phải kết thúc bằng `/exec`; triển khai lại với quyền Bất kỳ ai |
| Form báo thành công nhưng sheet không có dòng mới | `APPS_SCRIPT_URL` đang để trống (chế độ xem trước) | Điền URL ở Bước 4, commit lên GitHub |
| Sheet có dòng nhưng Trạng thái “Chờ gửi”, Ghi chú “Mailtrap 401” | Token sai hoặc hết hạn | Thay token (xem mục trên) |
| Ghi chú “Mailtrap 403” | Tên miền mất xác thực, ví dụ ai đó xóa bản ghi DNS ở PIA | Mailtrap → Sending Domains → Re-check DNS Records, thêm lại bản ghi thiếu |
| Ghi chú “Chưa có MAILTRAP_TOKEN” | Chưa lưu token | Làm Bước 3.5 |
| Thư vào Spam | DKIM/DMARC chưa PASS, hoặc tên miền mới gửi lần đầu | Kiểm tra “Hiển thị bản gốc”; giữ lượng gửi đều trong tuần đầu |
| Vercel báo “Invalid Configuration” | CNAME `pdf` sai giá trị, hoặc còn bản ghi A/CNAME cũ cùng tên | Chép lại đúng giá trị Vercel hiển thị, xóa bản ghi trùng tên |
| Email không có ảnh QR | Website chưa chạy ở `SITE_URL` lúc gửi | Kiểm tra mở được https://pdf.huynhanhthuan.com/assets/img/vietqr-any.png |
