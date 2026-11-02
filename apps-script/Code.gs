/**
 * =====================================================================
 *  pdf-translation-layout · Máy chủ đăng ký nhận gói kỹ năng
 *  Chạy trên Google Apps Script, gắn với 1 Google Sheet của anh.
 *
 *  Luồng: website (pdf.huynhanhthuan.com) → doPost() → ghi 1 dòng vào sheet "DangKy"
 *         → gửi email từ hello@huynhanhthuan.com qua Mailtrap Email API
 *         → Mailtrap từ chối / hết hạn mức thì xếp hàng, trigger mỗi giờ tự gửi tiếp.
 *
 *  Token Mailtrap KHÔNG nằm trong mã: lưu ở Cài đặt dự án → Thuộc tính tập lệnh
 *  (Script Properties) với tên MAILTRAP_TOKEN.
 *
 *  Các hàm anh tự bấm chạy (chọn tên hàm ở thanh trên rồi bấm ▶ Chạy):
 *    caiDat()                 — chạy 1 lần đầu: tạo sheet, cấp quyền, bật trigger
 *    guiThuChoToi()           — gửi 1 email mẫu qua Mailtrap tới chính anh, báo lỗi rõ ràng nếu có
 *    xemHanMuc()              — xem đã dùng bao nhiêu email hôm nay / tháng này
 *    guiThongBaoPhienBanMoi() — báo phiên bản mới cho người đã tick "nhận cập nhật"
 * =====================================================================
 */

/* ======================= CẤU HÌNH — CHỈ SỬA PHẦN NÀY ======================= */
const CONFIG = {
  // Link Google Drive của tệp zip, chia sẻ "Bất kỳ ai có đường liên kết" → Người xem
  DOWNLOAD_URL: 'DAN_LINK_GOOGLE_DRIVE_VAO_DAY',
  // Địa chỉ website (không có dấu / ở cuối)
  SITE_URL: 'https://pdf.huynhanhthuan.com',

  VERSION: '3.0.1',
  PACKAGE_NAME: 'pdf-translation-layout-v3.0.1.zip',
  PACKAGE_SIZE: '550 KB',

  // Người gửi: phải thuộc tên miền đã Verified trong Mailtrap
  SENDER_NAME: 'Huỳnh Anh Thuận',
  FROM_EMAIL: 'hello@huynhanhthuan.com',
  REPLY_TO: 'hello@huynhanhthuan.com',   // người nhận bấm Trả lời sẽ về hộp thư này (PIA)

  MAILTRAP: {
    SEND_URL: 'https://send.api.mailtrap.io/api/send',   // luồng Transactional: email đăng ký
    BULK_URL: 'https://bulk.api.mailtrap.io/api/send',   // luồng Bulk: thông báo phiên bản mới
    DAILY_LIMIT: 150,      // gói Free: 150 email/ngày
    MONTHLY_LIMIT: 4000,   // gói Free: 4.000 email/tháng. Nâng gói thì sửa 2 số này
    RESERVE: 5,            // chừa vài email cho việc gửi thử
  },
  // Nơi nhận cảnh báo khi Mailtrap lỗi (token hết hạn, tên miền mất xác thực…).
  // Để trống = Gmail đang chạy script. Cảnh báo tối đa 1 lần/ngày, gửi bằng Gmail.
  ALERT_EMAIL: '',

  BANK: {
    NAME: 'Vietcombank',
    OWNER: 'HUỲNH ANH THUẬN',
    ACCOUNT: '0161001623062',
    NOTE: 'UNG HO PDF LAYOUT',
  },

  // Nội dung thông báo phiên bản mới (dùng cho guiThongBaoPhienBanMoi)
  UPDATE_SUBJECT: 'pdf-translation-layout có phiên bản mới',
  UPDATE_MESSAGE: 'Phiên bản mới đã sẵn sàng với các cải tiến và sửa lỗi. Tải bản mới qua link bên dưới, giải nén đè lên thư mục cũ là xong.',

  // Kỹ thuật (thường không cần sửa)
  SHEET_NAME: 'DangKy',
  STATS_SHEET: 'ThongKe',
  RESEND_AFTER_HOURS: 24,       // cùng 1 email đăng ký lại sau 24 giờ mới gửi lại
  MAX_PER_MINUTE: 20,           // chặn bot spam làm cạn hạn mức
  MAX_ATTEMPTS: 3,              // gửi lỗi quá 3 lần thì ngừng thử
  TIMEZONE: 'Asia/Ho_Chi_Minh',
};
/* ========================== HẾT PHẦN CẤU HÌNH =============================== */

const HEADERS = ['Thời gian', 'Họ tên', 'Email', 'Nền tảng', 'Mục đích', 'Nhận cập nhật', 'Đồng ý dữ liệu',
  'Nguồn', 'Trạng thái', 'Lần gửi cuối', 'Số lần gửi', 'Đã báo bản', 'Ghi chú'];
const C = {}; HEADERS.forEach(function (h, i) { C[h] = i + 1; });

const STATUS = { SENT: 'Đã gửi', QUEUED: 'Chờ gửi', ERROR: 'Lỗi gửi', STOPPED: 'Ngừng gửi' };
const PLATFORMS = ['Antigravity', 'Claude Code', 'ChatGPT', 'Chưa dùng'];
const PURPOSES = ['', 'Dịch sách, tài liệu học tập', 'Tài liệu công việc, báo cáo', 'Học tiếng Anh qua bản song ngữ',
  'Làm video đọc sách', 'Nghiên cứu, tìm hiểu kỹ thuật', 'Mục đích khác'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ============================== WEB APP ============================== */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'count') {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('count');
    let count;
    if (cached === null || cached === undefined) {
      count = Math.max(0, getSheet_().getLastRow() - 1);
      cache.put('count', String(count), 600);
    } else {
      count = Number(cached) || 0;
    }
    return json_({ ok: true, count: count });
  }
  return json_({ ok: true, service: 'pdf-translation-layout signup', version: CONFIG.VERSION });
}

function doPost(e) {
  let data;
  try {
    data = parseBody_(e);
  } catch (err) {
    return json_({ ok: false, error: 'Dữ liệu gửi lên không đọc được. Tải lại trang rồi thử lại.' });
  }

  // 1) Bẫy bot: ô ẩn "website" có chữ = bot → trả lời như thành công nhưng không làm gì
  if (data.website) return json_({ ok: true, sent: true });

  // 2) Kiểm tra dữ liệu
  const v = validate_(data);
  if (v.error) return json_({ ok: false, error: v.error });
  const d = v.clean;

  // 3) Chống spam: giới hạn số đăng ký mỗi phút và bấm gửi liên tục
  const cache = CacheService.getScriptCache();
  const minuteKey = 'rl:' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(minuteKey) || 0) + 1;
  cache.put(minuteKey, String(n), 120);
  if (n > CONFIG.MAX_PER_MINUTE) return json_({ ok: false, error: 'Hệ thống đang nhận nhiều đăng ký. Vui lòng thử lại sau 1 phút.' });
  const emailKey = 'em:' + d.email;
  if (cache.get(emailKey)) return json_({ ok: true, duplicate: true });
  cache.put(emailKey, '1', 60);

  // 4) Ghi sheet + gửi email (khóa để không ghi trùng khi nhiều người gửi cùng lúc)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'Máy chủ đang bận. Vui lòng bấm gửi lại.' });
  try {
    const sh = getSheet_();
    const now = new Date();
    const rowIdx = findRowByEmail_(sh, d.email);

    if (rowIdx) {
      const row = sh.getRange(rowIdx, 1, 1, HEADERS.length).getValues()[0];
      const lastSent = row[C['Lần gửi cuối'] - 1];
      const status = row[C['Trạng thái'] - 1];
      // Cập nhật lựa chọn mới nhất của người dùng
      sh.getRange(rowIdx, C['Họ tên']).setValue(safe_(d.name));
      sh.getRange(rowIdx, C['Nền tảng']).setValue(d.platform);
      if (d.purpose) sh.getRange(rowIdx, C['Mục đích']).setValue(d.purpose);
      if (d.updates) sh.getRange(rowIdx, C['Nhận cập nhật']).setValue('Có');
      const recent = lastSent instanceof Date && (now - lastSent) < CONFIG.RESEND_AFTER_HOURS * 3600 * 1000;
      if (status === STATUS.SENT && recent) return json_({ ok: true, duplicate: true });
      if (status === STATUS.QUEUED) return json_({ ok: true, queued: true });
      const r = trySend_(sh, rowIdx);
      return json_(r);
    }

    sh.appendRow([now, safe_(d.name), d.email, d.platform, d.purpose, d.updates ? 'Có' : 'Không', 'Có',
      safe_(d.source), STATUS.QUEUED, '', 0, '', '']);
    const newRow = sh.getLastRow();
    cache.remove('count');
    const r = trySend_(sh, newRow);
    return json_(r);
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Có lỗi phía máy chủ. Vui lòng thử lại sau ít phút.' });
  } finally {
    lock.releaseLock();
  }
}

/* ============================ GỬI EMAIL ============================ */

/** Gửi email chào mừng cho 1 dòng. Trả về {ok, sent|queued}. */
function trySend_(sh, rowIdx) {
  const gate = canSend_();
  if (!gate.ok) {
    sh.getRange(rowIdx, C['Trạng thái']).setValue(STATUS.QUEUED);
    return { ok: true, queued: true };
  }
  const row = sh.getRange(rowIdx, 1, 1, HEADERS.length).getValues()[0];
  const attempts = Number(row[C['Số lần gửi'] - 1] || 0);
  const mail = buildWelcomeEmail_(row[C['Họ tên'] - 1], row[C['Nền tảng'] - 1]);
  const res = mailtrapSend_(row[C['Email'] - 1], row[C['Họ tên'] - 1], mail, { category: 'welcome' });

  if (res.ok) {
    sh.getRange(rowIdx, C['Trạng thái'], 1, 3).setValues([[STATUS.SENT, new Date(), attempts + 1]]);
    sh.getRange(rowIdx, C['Ghi chú']).setValue('');
    return { ok: true, sent: true };
  }
  handleFailure_(res);
  if (res.kind === 'bad' || res.kind === 'server') {
    // Lỗi riêng của dòng này (địa chỉ hỏng, máy chủ trục trặc): thử lại tối đa MAX_ATTEMPTS lần
    const stop = attempts + 1 >= CONFIG.MAX_ATTEMPTS;
    sh.getRange(rowIdx, C['Trạng thái']).setValue(stop ? STATUS.STOPPED : STATUS.ERROR);
    sh.getRange(rowIdx, C['Số lần gửi']).setValue(attempts + 1);
  } else {
    // Lỗi chung (token, tên miền, hạn mức, quá tải): giữ trong hàng chờ, không tính là 1 lần thử
    sh.getRange(rowIdx, C['Trạng thái']).setValue(STATUS.QUEUED);
  }
  sh.getRange(rowIdx, C['Ghi chú']).setValue(res.note.slice(0, 300));
  return { ok: true, queued: true };
}

/**
 * Gọi Mailtrap Email API. Trả về {ok:true} hoặc {ok:false, kind, status, note}
 * kind: 'config' (401/403: token hoặc tên miền), 'limit' (hết hạn mức gói), 'rate' (429),
 *       'bad' (400: dữ liệu/địa chỉ không hợp lệ), 'server' (5xx, mạng)
 */
function mailtrapSend_(toEmail, toName, mail, opts) {
  opts = opts || {};
  const token = PropertiesService.getScriptProperties().getProperty('MAILTRAP_TOKEN');
  if (!token) return { ok: false, kind: 'config', status: 0, note: 'Chưa có MAILTRAP_TOKEN trong Thuộc tính tập lệnh (Script Properties).' };

  const body = {
    from: { email: CONFIG.FROM_EMAIL, name: CONFIG.SENDER_NAME },
    to: [{ email: String(toEmail), name: String(toName || '').slice(0, 80) }],
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    category: opts.category || 'welcome',
  };
  if (CONFIG.REPLY_TO) body.reply_to = { email: CONFIG.REPLY_TO, name: CONFIG.SENDER_NAME };
  const qr = qrBase64_();
  if (qr && mail.html.indexOf('cid:vietqr') > -1) {
    body.attachments = [{ content: qr, filename: 'vietqr.png', type: 'image/png', disposition: 'inline', content_id: 'vietqr' }];
  }

  let code = 0, text = '';
  try {
    const resp = UrlFetchApp.fetch(opts.bulk ? CONFIG.MAILTRAP.BULK_URL : CONFIG.MAILTRAP.SEND_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    code = resp.getResponseCode();
    text = resp.getContentText() || '';
  } catch (err) {
    return { ok: false, kind: 'server', status: 0, note: 'Không kết nối được Mailtrap: ' + String(err && err.message || err) };
  }

  let j = {};
  try { j = JSON.parse(text); } catch (e) { /* phản hồi không phải JSON */ }
  if (code === 200 && j.success !== false) {
    bumpQuota_();
    return { ok: true, status: 200 };
  }
  const errs = (j.errors && j.errors.join('; ')) || text.slice(0, 200) || ('HTTP ' + code);
  const note = 'Mailtrap ' + code + ': ' + errs;
  if (code === 401 || code === 403) return { ok: false, kind: 'config', status: code, note: note };
  if (/limit|quota|exceed/i.test(errs)) return { ok: false, kind: 'limit', status: code, note: note };
  if (code === 429) return { ok: false, kind: 'rate', status: code, note: note };
  if (code >= 400 && code < 500) return { ok: false, kind: 'bad', status: code, note: note };
  return { ok: false, kind: 'server', status: code, note: note };
}

/** Phản ứng với lỗi chung: tạm dừng gửi một thời gian và cảnh báo chủ trang khi cần. */
function handleFailure_(res) {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  if (res.kind === 'config') {
    props.setProperty('PAUSE_UNTIL', String(now + 60 * 60 * 1000));      // thử lại sau 1 giờ
    alertOwner_('Mailtrap từ chối gửi: kiểm tra token hoặc tên miền', res.note +
      '\n\nCách xử lý:\n- 401: token sai hoặc đã hết hạn → Mailtrap > Settings > API Tokens > tạo token mới (quyền Admin cho huynhanhthuan.com) → dán vào Script Properties, tên MAILTRAP_TOKEN.' +
      '\n- 403: tên miền chưa Verified hoặc token thiếu quyền → Mailtrap > Sending Domains, bấm Re-check DNS Records.' +
      '\n\nCác đăng ký mới vẫn được ghi vào sheet với trạng thái "Chờ gửi" và sẽ tự gửi lại mỗi giờ sau khi anh sửa xong.');
  } else if (res.kind === 'limit') {
    const q = readQuota_();
    q.day = Math.max(q.day, CONFIG.MAILTRAP.DAILY_LIMIT);                 // đồng bộ: coi như hết hạn mức hôm nay
    writeQuota_(q);
    alertOwner_('Mailtrap báo hết hạn mức gửi', res.note + '\n\nĐăng ký mới vẫn được ghi và xếp hàng, hệ thống tự gửi khi hạn mức hồi lại. Nếu tình trạng lặp lại, cân nhắc nâng gói Mailtrap rồi sửa MAILTRAP.DAILY_LIMIT / MONTHLY_LIMIT trong CONFIG.');
  } else if (res.kind === 'rate') {
    props.setProperty('PAUSE_UNTIL', String(now + 60 * 1000));            // nghỉ 1 phút
  }
  console.error(res.note);
}

/** Có được phép gửi lúc này không (token, tạm dừng, hạn mức ngày/tháng). */
function canSend_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('MAILTRAP_TOKEN')) return { ok: false, reason: 'Chưa có MAILTRAP_TOKEN' };
  const pause = Number(props.getProperty('PAUSE_UNTIL') || 0);
  if (pause && Date.now() < pause) return { ok: false, reason: 'Đang tạm dừng đến ' + new Date(pause).toISOString() };
  const q = readQuota_();
  const m = CONFIG.MAILTRAP;
  if (q.day >= m.DAILY_LIMIT - m.RESERVE) return { ok: false, reason: 'Hết hạn mức ngày (' + q.day + '/' + m.DAILY_LIMIT + ')' };
  if (q.month >= m.MONTHLY_LIMIT - m.RESERVE) return { ok: false, reason: 'Hết hạn mức tháng (' + q.month + '/' + m.MONTHLY_LIMIT + ')' };
  return { ok: true };
}

/** Bộ đếm hạn mức theo ngày/tháng UTC (Mailtrap không công bố múi giờ reset, UTC là giả định an toàn). */
function readQuota_() {
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10), monthKey = dayKey.slice(0, 7);
  let q = {};
  try { q = JSON.parse(PropertiesService.getScriptProperties().getProperty('QUOTA') || '{}'); } catch (e) { q = {}; }
  return {
    dayKey: dayKey, monthKey: monthKey,
    day: q.dayKey === dayKey ? Number(q.day || 0) : 0,
    month: q.monthKey === monthKey ? Number(q.month || 0) : 0,
  };
}
function writeQuota_(q) {
  PropertiesService.getScriptProperties().setProperty('QUOTA', JSON.stringify(q));
}
function bumpQuota_() {
  const q = readQuota_(); q.day++; q.month++; writeQuota_(q);
}

/** Gửi cảnh báo cho chủ trang bằng Gmail, tối đa 1 lần mỗi 24 giờ. Người đăng ký không bao giờ nhận email Gmail. */
function alertOwner_(subject, body) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_ALERT') || 0);
  if (Date.now() - last < 24 * 3600 * 1000) return;
  props.setProperty('LAST_ALERT', String(Date.now()));
  try {
    const to = CONFIG.ALERT_EMAIL || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail(to, '[pdf-translation-layout] ' + subject, body);
  } catch (e) { console.error('Không gửi được cảnh báo: ' + e); }
}

/** Trigger mỗi giờ: gửi email đang chờ, rồi tiếp tục đợt thông báo phiên bản mới (nếu có). */
function xuLyHangDoi() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const sh = getSheet_();
    const last = sh.getLastRow();
    if (last < 2) return;
    const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();

    // Ưu tiên 1: email chào mừng đang chờ hoặc lỗi
    for (let i = 0; i < rows.length; i++) {
      const st = rows[i][C['Trạng thái'] - 1];
      if (st !== STATUS.QUEUED && st !== STATUS.ERROR) continue;
      if (!canSend_().ok) return;
      trySend_(sh, i + 2);
    }

    // Ưu tiên 2: thông báo phiên bản mới qua luồng Bulk
    const props = PropertiesService.getScriptProperties();
    const ver = props.getProperty('ANNOUNCE_VERSION');
    if (!ver) return;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r[C['Nhận cập nhật'] - 1] !== 'Có' || String(r[C['Đã báo bản'] - 1]).replace(/^'/, '') === ver) continue;
      if (!canSend_().ok) return;                       // còn người chưa báo: để lần chạy sau
      const res = mailtrapSend_(r[C['Email'] - 1], r[C['Họ tên'] - 1], buildUpdateEmail_(r[C['Họ tên'] - 1]), { bulk: true, category: 'release-update' });
      if (res.ok) {
        sh.getRange(i + 2, C['Đã báo bản']).setValue("'" + ver);
      } else {
        sh.getRange(i + 2, C['Ghi chú']).setValue(('Báo bản ' + ver + ' lỗi: ' + res.note).slice(0, 300));
        handleFailure_(res);
        if (res.kind !== 'bad') return;                 // lỗi chung: dừng đợt này
      }
    }
    props.deleteProperty('ANNOUNCE_VERSION');            // đã báo xong cho mọi người
  } finally {
    lock.releaseLock();
  }
}

/* ======================== HÀM ANH TỰ BẤM CHẠY ======================== */

/** Chạy 1 lần: tạo sheet, định dạng, sheet thống kê, trigger hằng giờ và xin quyền. */
function caiDat() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_NAME, 0);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#e3f1f3');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm');
  sh.getRange('J:J').setNumberFormat('dd/mm/yyyy hh:mm');
  sh.setColumnWidth(C['Họ tên'], 180); sh.setColumnWidth(C['Email'], 240); sh.setColumnWidth(C['Ghi chú'], 260);

  let st = ss.getSheetByName(CONFIG.STATS_SHEET);
  if (!st) st = ss.insertSheet(CONFIG.STATS_SHEET);
  st.clear();
  const S = "'" + CONFIG.SHEET_NAME + "'!";
  const stats = [
    ['Chỉ số', 'Giá trị'],
    ['Tổng đăng ký', '=COUNTA(' + S + 'C2:C)'],
    ['Đã gửi email', '=COUNTIF(' + S + 'I2:I,"' + STATUS.SENT + '")'],
    ['Đang chờ gửi', '=COUNTIF(' + S + 'I2:I,"' + STATUS.QUEUED + '")'],
    ['Lỗi / ngừng gửi', '=COUNTIF(' + S + 'I2:I,"' + STATUS.ERROR + '")+COUNTIF(' + S + 'I2:I,"' + STATUS.STOPPED + '")'],
    ['Đồng ý nhận cập nhật', '=COUNTIF(' + S + 'F2:F,"Có")'],
    ['', ''],
    ['Theo nền tảng', ''],
  ];
  PLATFORMS.forEach(function (p) { stats.push([p, '=COUNTIF(' + S + 'D2:D,"' + p + '")']); });
  stats.push(['', ''], ['Theo mục đích', '']);
  PURPOSES.filter(String).forEach(function (p) { stats.push([p, '=COUNTIF(' + S + 'E2:E,"' + p + '")']); });
  stats.push(['', ''], ['Đăng ký 7 ngày qua', '=COUNTIF(' + S + 'A2:A,">="&(TODAY()-7))']);
  st.getRange(1, 1, stats.length, 2).setValues(stats);
  st.getRange('A1:B1').setFontWeight('bold').setBackground('#e3f1f3');
  st.setColumnWidth(1, 260);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'xuLyHangDoi') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('xuLyHangDoi').timeBased().everyHours(1).create();

  const token = PropertiesService.getScriptProperties().getProperty('MAILTRAP_TOKEN');
  const msg = 'Cài đặt xong.' +
    (token ? '' : '\n⚠ Chưa có MAILTRAP_TOKEN: Cài đặt dự án (bánh răng) → Thuộc tính tập lệnh → Thêm thuộc tính.') +
    (CONFIG.DOWNLOAD_URL.indexOf('http') !== 0 ? '\n⚠ Chưa điền DOWNLOAD_URL trong CONFIG.' : '') +
    '\nBước tiếp theo: chạy guiThuChoToi() để gửi thử qua Mailtrap.';
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* chạy từ trình soạn thảo thì không có UI */ }
}

/** Gửi 1 email mẫu (nền tảng Claude Code) qua Mailtrap tới Gmail đang chạy script, in kết quả dễ hiểu. */
function guiThuChoToi() {
  const me = Session.getEffectiveUser().getEmail();
  const res = mailtrapSend_(me, 'Huỳnh Anh Thuận', buildWelcomeEmail_('Huỳnh Anh Thuận', 'Claude Code'), { category: 'test' });
  if (res.ok) {
    console.log('✓ Mailtrap đã nhận email thử gửi tới ' + me + '. Mở Gmail, nếu thư vào Spam hãy bấm "Không phải thư rác". ' +
      'Kiểm tra xác thực: mở thư → ⋮ → Hiển thị bản gốc → SPF, DKIM, DMARC đều phải là PASS.');
    return;
  }
  const hint = {
    config: res.status === 401 ? 'Token sai hoặc hết hạn: tạo token mới (quyền Admin cho tên miền) rồi dán lại vào Script Properties.'
      : res.status === 403 ? 'Tên miền chưa Verified hoặc token thiếu quyền Admin cho huynhanhthuan.com.'
      : 'Chưa có MAILTRAP_TOKEN trong Script Properties.',
    limit: 'Đã hết hạn mức của gói Mailtrap.',
    rate: 'Gửi quá nhanh, thử lại sau 1 phút.',
    bad: 'Mailtrap báo dữ liệu không hợp lệ. Kiểm tra FROM_EMAIL có đúng tên miền đã Verified không.',
    server: 'Mailtrap hoặc mạng trục trặc, thử lại sau.',
  }[res.kind];
  console.error('✗ ' + res.note + '\n→ ' + hint);
}

/** Xem nhanh đã dùng bao nhiêu email Mailtrap. */
function xemHanMuc() {
  const q = readQuota_(), m = CONFIG.MAILTRAP, gate = canSend_();
  console.log('Hôm nay (UTC ' + q.dayKey + '): ' + q.day + '/' + m.DAILY_LIMIT +
    ' · Tháng ' + q.monthKey + ': ' + q.month + '/' + m.MONTHLY_LIMIT +
    ' · ' + (gate.ok ? 'Đang gửi bình thường' : 'Tạm ngừng: ' + gate.reason));
}

/** Bắt đầu báo phiên bản mới cho người đã đồng ý. Sửa CONFIG.VERSION, DOWNLOAD_URL, UPDATE_* trước khi chạy. */
function guiThongBaoPhienBanMoi() {
  PropertiesService.getScriptProperties().setProperty('ANNOUNCE_VERSION', CONFIG.VERSION);
  xuLyHangDoi();
  console.log('Đã bắt đầu gửi thông báo v' + CONFIG.VERSION + ' qua luồng Bulk. Phần còn lại (nếu hết hạn mức) sẽ tự gửi mỗi giờ.');
}

/* ============================ MẪU EMAIL ============================ */

const GUIDES = {
  'Antigravity': {
    file: 'GUIDE_ANTIGRAVITY.md',
    steps: [
      'Giải nén tệp zip, bạn có thư mục <b>pdf-translation-layout</b>.',
      'Chép thư mục đó vào <code>%USERPROFILE%\\.gemini\\config\\skills\\</code> (macOS/Linux: <code>~/.gemini/config/skills/</code>), rồi khởi động lại Antigravity.',
      'Mở terminal trong thư mục skill, chạy <code>pip install -r requirements.txt</code> (cần Python 3.10 trở lên).',
      'Trong khung chat, gõ <code>/pdf-translation-layout</code> hoặc nói: “Dịch file D:\\Tai-lieu\\bao-cao.pdf sang tiếng Việt, giữ nguyên layout”.',
    ],
  },
  'Claude Code': {
    file: 'GUIDE_CLAUDE.md',
    steps: [
      'Giải nén tệp zip, bạn có thư mục <b>pdf-translation-layout</b>.',
      'Mở terminal trong thư mục đó, chạy <code>pip install -r requirements.txt</code> (cần Python 3.10 trở lên).',
      'Gõ <code>claude</code> ngay trong thư mục: Claude Code tự đọc tệp CLAUDE.md. Muốn dùng ở mọi nơi, chép thư mục vào <code>~/.claude/skills/</code>.',
      'Ra lệnh: “Dịch ./bao-cao.pdf sang tiếng Việt, giữ nguyên layout, rồi chạy QA.”',
    ],
  },
  'ChatGPT': {
    file: 'GUIDE_CHATGPT.md',
    steps: [
      'Giải nén tệp zip. Tạo Custom GPT cần gói ChatGPT Plus, Team hoặc Enterprise.',
      'Mở chatgpt.com/gpts/editor → Configure, dán phần Instructions trong <code>chatgpt-system-instructions.md</code>.',
      'Bật <b>Code Interpreter &amp; Data Analysis</b>, tải 3 tệp trong thư mục <code>references/</code> lên mục Knowledge.',
      'Đính kèm PDF rồi ra lệnh. Tài liệu dài nên chia 10–20 trang mỗi lượt. ChatGPT không xuất được video đọc sách.',
    ],
  },
  'Chưa dùng': {
    file: 'BAT_DAU_TAI_DAY.md',
    steps: [
      'Nếu mới bắt đầu, mình gợi ý Claude Code hoặc Antigravity vì chạy đủ tính năng ngay trên máy bạn.',
      'Giải nén tệp zip, mở tệp <code>BAT_DAU_TAI_DAY.md</code>: có bảng cài cho từng nền tảng.',
      'Cài Python 3.10 trở lên (python.org), rồi chạy <code>pip install -r requirements.txt</code> trong thư mục.',
      'Chạy thử: <code>python scripts/cli.py inspect --source tai-lieu.pdf</code>. Thấy dòng “Kiểm kê hoàn tất” là xong.',
    ],
  },
};

function buildWelcomeEmail_(name, platform) {
  const g = GUIDES[platform] || GUIDES['Chưa dùng'];
  const first = firstName_(name);
  const subject = 'pdf-translation-layout v' + CONFIG.VERSION + ': link tải và hướng dẫn cài cho ' + (platform === 'Chưa dùng' ? 'người mới' : platform);
  const steps = g.steps.map(function (s, i) {
    return '<tr><td valign="top" style="width:28px;padding:0 0 12px;font:600 13px/1.6 Menlo,Consolas,monospace;color:#0a7a8c">0' + (i + 1) + '</td>' +
      '<td style="padding:0 0 12px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#13282b">' + s + '</td></tr>';
  }).join('');

  const html = shell_(
    '<p style="margin:0 0 16px">Chào ' + esc_(first) + ',</p>' +
    '<p style="margin:0 0 20px">Cảm ơn bạn đã đăng ký. Đây là gói kỹ năng <b>pdf-translation-layout v' + CONFIG.VERSION + '</b>: dịch PDF sang tiếng Việt mà vẫn giữ nguyên bố cục, chữ vector thật, xuất bản song ngữ và video đọc sách.</p>' +
    button_(CONFIG.DOWNLOAD_URL, 'Tải ' + CONFIG.PACKAGE_NAME + ' (' + CONFIG.PACKAGE_SIZE + ')') +
    '<h2 style="margin:28px 0 12px;font:700 18px/1.3 Arial,Helvetica,sans-serif;color:#13282b">Cài cho ' + esc_(platform === 'Chưa dùng' ? 'người mới bắt đầu' : platform) + ' trong 5 phút</h2>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">' + steps + '</table>' +
    '<p style="margin:4px 0 0;color:#4a5f62;font-size:14px">Hướng dẫn chi tiết nằm trong tệp <code>' + g.file + '</code> của gói.</p>' +
    coffee_() +
    '<p style="margin:24px 0 0">Gặp lỗi hay có góp ý, bạn cứ trả lời thẳng email này.<br>Chúc bạn dịch suôn sẻ,<br><b>' + esc_(CONFIG.SENDER_NAME) + '</b></p>',
    'Bạn nhận email này vì đã đăng ký tại ' + CONFIG.SITE_URL.replace(/^https?:\/\//, '') + '. Muốn ngừng nhận thông báo phiên bản mới, trả lời email này với chữ “Hủy”.'
  );

  const text = [
    'Chào ' + first + ',', '',
    'Cảm ơn bạn đã đăng ký pdf-translation-layout v' + CONFIG.VERSION + '.',
    'Tải gói kỹ năng: ' + CONFIG.DOWNLOAD_URL, '',
    'Cài cho ' + platform + ':',
  ].concat(g.steps.map(function (s, i) { return (i + 1) + '. ' + stripTags_(s); }))
    .concat(['', 'Hướng dẫn chi tiết: tệp ' + g.file + ' trong gói.', '',
      'Ủng hộ một ly cà phê (tùy tâm): ' + CONFIG.BANK.NAME + ' · ' + CONFIG.BANK.ACCOUNT + ' · ' + CONFIG.BANK.OWNER + ' · nội dung: ' + CONFIG.BANK.NOTE, '',
      CONFIG.SENDER_NAME]).join('\n');

  return { subject: subject, html: html, text: text };
}

function buildUpdateEmail_(name) {
  const first = firstName_(name);
  const subject = CONFIG.UPDATE_SUBJECT + ' (v' + CONFIG.VERSION + ')';
  const html = shell_(
    '<p style="margin:0 0 16px">Chào ' + esc_(first) + ',</p>' +
    '<p style="margin:0 0 20px">' + esc_(CONFIG.UPDATE_MESSAGE) + '</p>' +
    button_(CONFIG.DOWNLOAD_URL, 'Tải ' + CONFIG.PACKAGE_NAME) +
    coffee_() +
    '<p style="margin:24px 0 0">' + esc_(CONFIG.SENDER_NAME) + '</p>',
    'Bạn nhận email này vì đã chọn nhận thông báo phiên bản mới. Trả lời “Hủy” để ngừng nhận.'
  );
  const text = 'Chào ' + first + ',\n\n' + CONFIG.UPDATE_MESSAGE + '\n\nTải bản mới: ' + CONFIG.DOWNLOAD_URL + '\n\n' + CONFIG.SENDER_NAME;
  return { subject: subject, html: html, text: text };
}

function shell_(inner, footer) {
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#eef2f2">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f2"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #cfdadb;border-radius:8px">' +
    '<tr><td style="padding:20px 28px;border-bottom:1px solid #cfdadb;font:700 15px/1.4 Arial,Helvetica,sans-serif;color:#13282b">' +
    '<span style="display:inline-block;width:10px;height:10px;background:#0a7a8c;border-radius:2px;margin-right:8px"></span>pdf-translation-layout ' +
    '<span style="font:400 12px Menlo,Consolas,monospace;color:#4a5f62">v' + CONFIG.VERSION + '</span></td></tr>' +
    '<tr><td style="padding:28px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#13282b">' + inner + '</td></tr>' +
    '</table>' +
    '<p style="max-width:600px;margin:16px auto 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#4a5f62">' + esc_(footer) + '</p>' +
    '</td></tr></table></body></html>';
}

function button_(url, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#0a7a8c;border-radius:4px">' +
    '<a href="' + esc_(url) + '" style="display:inline-block;padding:14px 22px;font:700 15px/1.2 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">' +
    esc_(label) + '</a></td></tr></table>';
}

function coffee_() {
  const b = CONFIG.BANK;
  const qrSrc = qrBase64_() ? 'cid:vietqr' : (CONFIG.SITE_URL + '/assets/img/vietqr-any.png');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;background:#e3f1f3;border-radius:8px"><tr>' +
    '<td style="padding:20px 20px 20px 24px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#13282b;vertical-align:top">' +
    '<b style="font-size:16px">Mời mình một ly cà phê</b><br>' +
    'Gói kỹ năng miễn phí. Nếu nó giúp bạn tiết kiệm thời gian, bạn có thể ủng hộ tùy tâm để mình duy trì các phiên bản tiếp theo.<br><br>' +
    '<span style="color:#4a5f62">Ngân hàng:</span> <b>' + esc_(b.NAME) + '</b><br>' +
    '<span style="color:#4a5f62">Chủ tài khoản:</span> <b>' + esc_(b.OWNER) + '</b><br>' +
    '<span style="color:#4a5f62">Số tài khoản:</span> <b style="font-family:Menlo,Consolas,monospace">' + esc_(b.ACCOUNT) + '</b><br>' +
    '<span style="color:#4a5f62">Nội dung:</span> <b style="font-family:Menlo,Consolas,monospace">' + esc_(b.NOTE) + '</b></td>' +
    '<td width="150" style="padding:20px 24px 20px 0;vertical-align:top;text-align:center">' +
    '<img src="' + qrSrc + '" width="140" height="140" alt="Mã VietQR ' + esc_(b.NAME) + ' ' + esc_(b.ACCOUNT) + '" style="display:block;border:0;background:#fff;padding:4px;border-radius:4px">' +
    '<span style="font:11px Arial,Helvetica,sans-serif;color:#4a5f62">Quét bằng app ngân hàng</span></td>' +
    '</tr></table>';
}

/* ============================ TIỆN ÍCH ============================ */

function qrBase64_() {
  if (qrBase64_.cached !== undefined) return qrBase64_.cached;
  const cache = CacheService.getScriptCache();
  let b64 = cache.get('qr_png');
  if (!b64) {
    try {
      const res = UrlFetchApp.fetch(CONFIG.SITE_URL + '/assets/img/vietqr-any.png', { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        b64 = Utilities.base64Encode(res.getContent());
        cache.put('qr_png', b64, 21600);
      }
    } catch (e) { /* website chưa lên: email dùng link ảnh thay thế */ }
  }
  qrBase64_.cached = b64 || null;
  return qrBase64_.cached;
}

function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    try { return JSON.parse(e.postData.contents); } catch (err) { /* thử dạng form */ }
  }
  if (e && e.parameter && Object.keys(e.parameter).length) return e.parameter;
  throw new Error('empty body');
}

function validate_(raw) {
  const s = function (x, max) { return String(x == null ? '' : x).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max); };
  const d = {
    name: s(raw.name, 80),
    email: s(raw.email, 120).toLowerCase(),
    platform: s(raw.platform, 40),
    purpose: s(raw.purpose, 80),
    updates: raw.updates === true || raw.updates === 'true' || raw.updates === 'on',
    consent: raw.consent === true || raw.consent === 'true' || raw.consent === 'on',
    source: s(raw.source, 120),
  };
  if (!d.name) return { error: 'Vui lòng nhập họ tên.' };
  if (!EMAIL_RE.test(d.email)) return { error: 'Email chưa đúng dạng.' };
  if (PLATFORMS.indexOf(d.platform) < 0) return { error: 'Vui lòng chọn nền tảng AI đang dùng.' };
  if (PURPOSES.indexOf(d.purpose) < 0) d.purpose = 'Mục đích khác';
  if (!d.consent) return { error: 'Cần bạn đồng ý với chính sách dữ liệu để nhận email.' };
  return { clean: d };
}

/** Chặn chèn công thức vào Google Sheets (ô bắt đầu bằng = + - @). */
function safe_(v) {
  const str = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error('Chưa có sheet "' + CONFIG.SHEET_NAME + '". Hãy chạy hàm caiDat() trước.');
  return sh;
}

function findRowByEmail_(sh, email) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const col = sh.getRange(2, C['Email'], last - 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]).toLowerCase() === email) return i + 2;
  }
  return 0;
}

function firstName_(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : 'bạn';
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripTags_(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
