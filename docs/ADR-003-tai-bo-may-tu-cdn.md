# ADR-003: Trang /dich tải bộ máy từ jsDelivr và PyPI, website chỉ giữ bản dự phòng

**Trạng thái:** Chấp nhận
**Ngày:** 03/11/2026
**Người quyết định:** Huỳnh Anh Thuận ("dùng cách làm giảm rủi ro")
**Bổ sung cho:** [ADR-001](ADR-001-kien-truc-phat-hanh.md) (trang tĩnh trên Vercel Hobby). Không thay phần nào.

## Bối cảnh

Trang `/dich` chạy Pyodide và PyMuPDF ngay trong trình duyệt. Mỗi người dùng mới phải tải khoảng 34 MB: lõi Pyodide 12,3 MB, PyMuPDF 18,4 MB, phông chữ 3,4 MB. Nếu Vercel phát hết số này thì:

- Gói Hobby có 100 GB Fast Data Transfer và 1 triệu Edge Request mỗi tháng (trang Limits và Fair Use của Vercel, đọc tháng 11/2026). 100 GB chia 34 MB được khoảng 3.000 người dùng mới mỗi tháng.
- Vượt hạn mức thì Vercel tạm dừng cả dự án tới 30 ngày. Trang chủ, form đăng ký và trang tải về dừng theo, không riêng `/dich`.

Hai file lớn nhất là gói mã nguồn mở đã có sẵn trên CDN công khai, miễn phí:

- Pyodide 0.29.5 là gói npm `pyodide@0.29.5`; jsDelivr phát lại nguyên văn file của npm (`cdn.jsdelivr.net`, bản dự phòng `fastly.jsdelivr.net`).
- PyMuPDF 1.28.2 bản WebAssembly là wheel chính thức trên PyPI (`files.pythonhosted.org`, có header CORS `*`). Đây cũng là nơi `micropip` của Pyodide tải gói theo mặc định.

## Quyết định

1. Thêm công tắc `ENGINE_SOURCE` trong `config.js`. Giá trị mặc định là `"cdn"`.
2. Ở chế độ `"cdn"`, thứ tự nguồn là:
   - Lõi Pyodide: jsDelivr → jsDelivr (Fastly) → website.
   - PyMuPDF: PyPI → website.
3. Mọi file lấy từ CDN đều được kiểm mã SHA-256 trước khi chạy:
   - Có 5 file lõi và 1 wheel; mã của chúng ghi cố định trong `dich-worker.js`.
   - Trình duyệt chạy đúng các byte vừa kiểm: script nạp qua `blob:`, wasm và thư viện chuẩn nạp từ bộ nhớ, wheel cài bằng `unpackArchive`.
   - CDN không thể chạy mã nào khác. CSP `script-src` không cho phép tên miền CDN, chỉ `'self'` và `blob:`.
4. Một nguồn bị bỏ qua để chuyển sang nguồn kế tiếp khi gặp một trong các lỗi sau:
   - Không có byte đầu trong 6 giây (`pyodide.js`) hoặc 12 giây (các file khác).
   - Ngừng tải giữa chừng 20 giây.
   - Trả mã HTTP lỗi.
   - Một file sai mã SHA-256.
5. Phông chữ, `dich_pdf.py` và `web_api.py` vẫn lấy từ website. Đây là mã của mình, nhỏ, và cần cập nhật theo phiên bản.
6. `ENGINE_SOURCE: "self"` quay về cách cũ: lấy mọi thứ từ `engine/`.
7. `tools/dung_web.py` dừng và báo nếu mã SHA-256 trong `dich-worker.js` không khớp gói npm và wheel PyPI vừa tải. Nhờ vậy, khi nâng phiên bản sẽ không quên sửa mã kiểm.

## Hệ quả

Đo trên Chromium với máy chủ giả lập Vercel (đúng header CSP), jsDelivr và PyPI giả lập bằng file thật của npm và PyPI:

| | Trước | Sau |
|---|---|---|
| Byte website phát cho một người dùng mới (tài liệu 6 trang, 2 họ phông) | 34,1 MB | 3,4 MB chưa nén, 1,5 MB nếu nén brotli |
| Request tới website | 28 | 22 |
| Sức chứa gói Hobby, ước tính | ~3.000 người dùng mới/tháng | ~30.000–45.000 người dùng mới/tháng |

Giới hạn kế tiếp là 1 triệu Edge Request: khoảng 22 request cho mỗi lần đầu vào `/dich`, cộng lượt xem các trang khác.

| Tình huống thử | Kết quả |
|---|---|
| CDN bình thường | jsDelivr + PyPI, 5 + 1 request tới CDN, không tải lặp |
| `cdn.jsdelivr.net` hỏng | chuyển sang `fastly.jsdelivr.net` |
| jsDelivr trả `pyodide.asm.js` bị sửa | bị chặn vì sai mã, chuyển sang Fastly |
| Cả hai CDN trả lõi bị sửa | lõi lấy từ website, wheel vẫn từ PyPI |
| PyPI trả wheel sai | wheel lấy từ website |
| Mọi CDN hỏng | lấy hết từ website (34 MB như cũ) |
| Mọi CDN treo, không trả lời | lấy hết từ website sau khoảng 36 giây |

Phiếu kiểm định ĐẠT ở mọi tình huống, không có lỗi JavaScript.

Rủi ro chấp nhận:

- **Phụ thuộc hai bên thứ ba.** Khi họ lỗi, trang vẫn chạy nhưng tốn băng thông Vercel như cũ. Nếu CDN treo hẳn, người dùng chờ thêm khoảng 30 giây.
- **Quyền riêng tư.** jsDelivr và PyPI thấy địa chỉ IP và trình duyệt của người dùng khi tải thư viện. Họ không thấy tài liệu. Điều này đã ghi trong `dich.html` và `privacy.html`.
- **Bộ nhớ.** Lúc khởi động, trình duyệt giữ thêm khoảng 30 MB byte đã kiểm, rồi trả lại ngay sau khi nạp xong.
- **Chưa thử với jsDelivr thật,** vì máy kiểm thử bị chặn mạng tới jsDelivr. Đã đối chiếu: gói npm `pyodide@0.29.5` tải bằng `npm pack` khớp từng byte với `engine/pyodide`. Sau khi đưa lên, mở `/dich` và đọc dòng trạng thái: phải ghi "bộ máy tải từ jsDelivr và PyPI". Nếu ghi "website" thì xem Console (F12).

## Khi nào xem lại

- Nâng Pyodide hoặc PyMuPDF: sửa `PYODIDE_VER`, `CORE_SHA256`, `CORE_BYTES`, `WHEEL`, `WHEEL_SHA256` và đường dẫn PyPI trong `dich-worker.js`, rồi chạy `tools/dung_web.py`.
- Vercel Usage cho thấy phần lớn người dùng vẫn lấy từ website: tức là CDN bị chặn ở mạng của họ. Khi đó cân nhắc chuyển bản dự phòng sang Cloudflare R2 hoặc Pages (không tính phí băng thông).
- Vượt khoảng 30.000 người dùng mới mỗi tháng: tính lại theo giới hạn Edge Request, hoặc chuyển lên gói Pro.
