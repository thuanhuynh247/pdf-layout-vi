/* ================================================================
   CẤU HÌNH TRANG — đây là tệp duy nhất anh cần sửa trên website.
   Sau khi sửa, đẩy lên GitHub là Vercel tự cập nhật trong ~30 giây.
   ================================================================ */
window.SITE_CONFIG = {
  // Dán URL Web App của Google Apps Script (kết thúc bằng /exec).
  // Để trống "" = chế độ xem trước: form chạy thử, KHÔNG gửi email.
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxOZPeGValKjmm_12FGldg6DmmjPApAyJlDd6k1S4G21mwjtumo2HnSEmSy8V2e7xmk/exec",

  // Phiên bản hiển thị trên trang
  VERSION: "3.0.1",

  // Chỉ hiện dòng "Đã có N người nhận" khi N đạt ngưỡng này (0 = không bao giờ hiện)
  SHOW_COUNT_FROM: 30,
};
