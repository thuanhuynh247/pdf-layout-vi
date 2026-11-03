/* ================================================================
   CẤU HÌNH TRANG — đây là tệp duy nhất anh cần sửa trên website.
   Sau khi sửa, đẩy lên GitHub là Vercel tự cập nhật trong ~30 giây.
   ================================================================ */
window.SITE_CONFIG = {
  // Dán URL Web App của Google Apps Script (kết thúc bằng /exec).
  // Để trống "" = chế độ xem trước: form chạy thử, KHÔNG gửi email.
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxOZPeGValKjmm_12FGldg6DmmjPApAyJlDd6k1S4G21mwjtumo2HnSEmSy8V2e7xmk/exec",

  // Phiên bản hiển thị trên trang
  VERSION: "3.1.0",

  // Trang "Dùng với Claude": true = hiện nút tải thẳng file zip (không cần email);
  // false = nút dẫn tới form đăng ký, file gửi qua email.
  CLAUDE_DIRECT_DOWNLOAD: true,

  // Trang dịch trên web: tải bộ máy (~30 MB) từ đâu.
  // "cdn"  = Pyodide từ jsDelivr, PyMuPDF từ PyPI, kiểm mã SHA-256 từng file (miễn phí, website chỉ phát ~1,5-3,4 MB
  //          phông chữ và mã dịch mỗi người dùng mới); CDN lỗi, treo hay trả file sai thì tự lấy từ website.
  // "self" = chỉ lấy từ thư mục engine/ của website (mỗi người dùng mới tốn ~34 MB băng thông Vercel).
  ENGINE_SOURCE: "cdn",

  // Link GPT dựng sẵn (dạng https://chatgpt.com/g/...). Để trống = trang ghi "đang thử nghiệm".
  GPT_URL: "",

  // Link kho mã nguồn công khai (dạng https://github.com/<tên>/pdf-translation-layout). Để trống = ẩn link.
  GITHUB_URL: "https://github.com/thuanhuynh247/pdf-translation-layout",

  // Chỉ hiện dòng "Đã có N người nhận" khi N đạt ngưỡng này (0 = không bao giờ hiện)
  SHOW_COUNT_FROM: 30,
};
