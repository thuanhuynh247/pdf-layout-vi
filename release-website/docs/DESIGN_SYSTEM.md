# Design system “Proof Sheet” — trang phát hành pdf-translation-layout

Ngôn ngữ thiết kế lấy từ chính nghề dàn trang: một **bàn dàn trang** (pasteboard) xám lạnh, trên đó đặt các **trang PDF trắng** có **dấu cắt** ở góc, **chú thích kích thước bằng pt** và **khung chữ nét đứt** màu teal giống khung bounding box engine đặt chữ. Màu teal `#0a7a8c` và font Plus Jakarta Sans lấy đúng từ skill (màu đoạn dịch ở chế độ Xen đoạn, font nhúng trong PDF đầu ra), nên website và sản phẩm là một hệ nhận diện.

Nguồn chuẩn: `assets/css/tokens.css`. Mọi component trong `assets/css/site.css` chỉ dùng token, không dùng mã màu cứng (ngoại lệ có chủ đích: trang PDF luôn trắng ở cả hai chế độ sáng/tối).

## 1. Token

### Màu

| Token | Sáng | Tối | Dùng cho | Tương phản |
|---|---|---|---|---|
| `--board` | `#eef2f2` | `#0d1719` | Nền trang (bàn dàn trang) | — |
| `--paper` | `#ffffff` | `#152427` | Thẻ, ô nhập, bảng | — |
| `--ink` | `#13282b` | `#e4eef0` | Chữ chính | 13.6 / 15.4 : 1 |
| `--ink-2` | `#4a5f62` | `#9db2b5` | Chữ phụ, chú thích | 6.0 / 8.2 : 1 |
| `--rule` | `#cfdadb` | `#2a3e42` | Đường kẻ trang trí | không dùng làm viền điều khiển |
| `--teal` | `#0a7a8c` | `#3fb3c4` | Nút chính, dấu nhấn | chữ trên nút 5.0 / 6.3 : 1 |
| `--teal-ink` | `#075e6c` | `#78d3e0` | Link, nhãn teal | 6.6 / 10.6 : 1 |
| `--teal-wash` | `#e3f1f3` | `#12323a` | Nền chip đã chọn, khối ủng hộ trong email | — |
| `--field-border` | `#7f9598` | `#678589` | Viền ô nhập, chip, nút phụ | 3.2 / 4.0 : 1 (WCAG 1.4.11) |
| `--error` / `--error-wash` | `#b4232f` / `#fbeced` | `#ff8a92` / `#3a1a1e` | Lỗi form, minh họa ký tự tofu | 6.5 / 7.1 : 1 |
| `--pass` | `#1d7a4a` | `#6fd39b` | Nhãn PASS của QA | 5.3 / 8.7 : 1 |
| `--deep` / `--on-deep` | `#13282b` / `#eef2f2` | `#081215` / `#e4eef0` | Khối luôn tối (thẻ video) | 13.6 / 16.1 : 1 |

Quy tắc: teal chỉ là **màu nhấn** (một hành động chính mỗi vùng). Xanh lá `--pass` và đỏ `--error` là màu **ngữ nghĩa**, không dùng trang trí.

### Chữ

| Token | Giá trị | Vai trò |
|---|---|---|
| `--font-sans` | Plus Jakarta Sans (tự host, subset Latin + tiếng Việt, ~20 KB/weight) | Toàn bộ chữ có tiếng Việt |
| `--font-mono` | JetBrains Mono (Google Fonts) | **Chỉ chuỗi ASCII**: lệnh CLI, số pt, số tài khoản |
| `.label` | sans 13px/500 | Chú thích có tiếng Việt ở vị trí “đo đạc” (font mono dự phòng hay vỡ dấu) |

Thang tỉ lệ 1.25, thân bài 17px: `--fs-xs 13` · `--fs-sm 15` · `--fs-md 17` · `--fs-lg 21` · `--fs-xl 28` · `--fs-2xl 32→44` · `--fs-3xl 40→68` (co theo màn hình bằng `clamp`). Tiêu đề 700, `letter-spacing -0.02em → -0.035em` (H1), `text-wrap: balance`. Độ rộng dòng thân bài ≤ 64ch.

### Khoảng cách, hình khối, chuyển động

- Khoảng cách bội 4px: `--sp-1 4` … `--sp-9 96`. Giữa các section: 96px.
- Bo góc: `--radius-s 4px` cho nút/ô nhập (gần vuông như hộp chữ), `--radius-m 8px` cho khung lớn. Không bo tròn mọi thứ.
- Nét đứt `--dash: 1.5px dashed teal` = ký hiệu “khung chữ engine”. Chỉ dùng cho thứ thật sự là khung đo/đặt chữ.
- Chuyển động: `--dur-1 120ms` (hover), `--dur-2 220ms` (bật/tắt), `--ease cubic-bezier(.2,.7,.2,1)`. Tôn trọng `prefers-reduced-motion`.

## 2. Component

### Button

| Biến thể | Dùng khi |
|---|---|
| `.btn-primary` | Hành động chính duy nhất của vùng (Nhận gói kỹ năng, Gửi) |
| `.btn-ghost` | Hành động phụ (Xem chế độ xuất bản, Đăng ký email khác) |
| `.btn-sm` | Thanh trên cùng, thao tác trong thẻ |

| Trạng thái | Hình | Hành vi |
|---|---|---|
| Mặc định | Nền teal, chữ trắng, cao 48px | — |
| Hover | Nhấc 1px, bóng đáy 3px đậm hơn | — |
| Focus | Viền 2px `--focus`, cách 3px | Bàn phím |
| Loading | `aria-busy="true"`, vòng xoay + “Đang gửi…” | Khóa bấm lại |
| Disabled | Mờ 70% | Không tương tác |

### Proof viewer (so sánh EN/VI) — component đặc trưng

Trang PDF thật đặt trong khung có dấu cắt 4 góc và thước `612 pt` / `792 pt`. Lớp EN cắt bằng `clip-path` theo biến `--pos`; một `<input type="range">` trong suốt phủ toàn khung để kéo bằng chuột, chạm và **phím mũi tên**. Công tắc “Hiện khung chữ” vẽ SVG các dòng chữ lấy từ **layout log thật** của engine (`assets/js/p13-boxes.js`).

- Role: range input có `aria-label` mô tả hướng kéo; ảnh có `alt` mô tả nội dung từng bản.
- Không làm: tự động trượt (gây chóng mặt), che nhãn EN/VI.

### Video demo

Thẻ nền tối (`--deep`) chứa `<video>` gốc của trình duyệt: `controls`, `preload="none"` (không tốn băng thông tới khi người xem bấm phát), `playsinline`, ảnh poster WebP 52 KB, kích thước khai báo sẵn 1920×1080 để trang không bị nhảy khi tải. Tệp MP4 H.264 1080p, 10 fps (nội dung là trang tĩnh nên giảm khung hình không mất chất lượng), AAC 64 kbps mono, `+faststart` để phát ngay khi đang tải. Phụ đề đã in sẵn trong hình.

### Nghe thử giọng (voice sample)

| Phần | Mô tả |
|---|---|
| Nút tròn 48px | Phát/dừng. `aria-pressed` và `aria-label` đổi theo trạng thái (“Phát…” ↔ “Dừng…”) |
| Lời thoại | Mỗi câu là một `<span data-t="giây bắt đầu">`. Câu đang đọc được viền teal giống khung chữ trong video |
| Thanh tiến độ | 3px, chỉ để nhìn (`aria-hidden`) |

Hành vi: chỉ một nguồn âm thanh phát tại một thời điểm. Bấm giọng khác thì giọng đang phát dừng; bấm phát video thì giọng đang phát dừng và ngược lại. Âm thanh chỉ tải khi bấm lần đầu. Tải lỗi thì nhãn đổi thành “Không tải được âm thanh”.

### Input / Select / Chip / Checkbox

- Cao tối thiểu 48px (ô nhập), 40px (chip): đủ vùng chạm.
- Lỗi: viền `--error`, thông báo dưới ô nối bằng `aria-describedby`, `aria-invalid="true"`; con trỏ nhảy về ô lỗi đầu tiên. Lời nhắn nói rõ cách sửa (“Email chưa đúng dạng, ví dụ ten@gmail.com.”).
- Chip là radio thật (bàn phím và trình đọc màn hình hoạt động bình thường), trạng thái chọn = viền teal + nền `--teal-wash`.
- Checkbox đồng ý dữ liệu **bắt buộc và không tick sẵn**; checkbox nhận cập nhật **không tick sẵn**.

### Bảng báo cáo (QA, ma trận nền tảng)

Nền `--paper`, viền `--rule`, cuộn ngang trong khung riêng khi màn hình hẹp (trang không bao giờ cuộn ngang). Nhãn trạng thái `.pass` = chấm + chữ, không dựa vào màu đơn thuần.

### Khối ủng hộ

Ảnh VietQR tạo sẵn cho 4 mức (tùy tâm, 30k, 50k, 100k), chip chọn mức đổi ảnh. Số tài khoản và nội dung có nút **Sao chép** (có phương án dự phòng khi trình duyệt chặn clipboard).

## 3. Mẫu (pattern)

- **Form đăng ký:** 4 trạng thái sau khi gửi: đã gửi / xếp hàng 24 giờ / email đã đăng ký / lỗi (giữ nguyên dữ liệu đã nhập để gửi lại). Chế độ xem trước khi chưa cấu hình máy chủ hiện cảnh báo rõ “chưa có email nào được gửi”.
- **Email:** bảng HTML 600px, style nội tuyến, cùng token màu, có bản text thuần, ảnh QR đính kèm nội tuyến (`cid:vietqr`).

## 4. Nên / không nên

| Nên | Không nên |
|---|---|
| Dùng nét đứt teal cho thứ thật sự là khung chữ/đo đạc | Dùng nét đứt làm viền trang trí cho thẻ |
| Đưa số liệu thật (163 trang, 0 tofu, 791 run) | Bịa số cho đẹp |
| Dùng mono cho lệnh và con số ASCII | Viết tiếng Việt bằng font mono |
| Một nút chính mỗi vùng | Hai nút teal cạnh nhau |
