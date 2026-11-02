/* Kiểm thử Code.gs (bản gửi qua Mailtrap) bằng cách giả lập các dịch vụ Google Apps Script
   và Mailtrap Email API. Chạy: node apps-script/test/code.test.js  */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function makeEnv(opts) {
  opts = opts || {};
  const rows = [];
  const statRows = [];
  const cacheStore = {};
  const props = { MAILTRAP_TOKEN: opts.noToken ? undefined : 'tok_test' };
  if (opts.noToken) delete props.MAILTRAP_TOKEN;
  const triggers = [];
  const mailtrap = [];     // các request gửi tới Mailtrap
  const alerts = [];       // email cảnh báo gửi cho chủ qua MailApp
  let responder = opts.responder || (() => ({ code: 200, body: { success: true, message_ids: ['m1'] } }));
  let clock = Date.parse('2026-11-01T03:00:00Z');

  const range = (r, c, nr, nc, store) => {
    const rs = store || rows;
    return {
      getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = rs[r - 1 + i] || []; out.push(Array.from({ length: nc || 1 }, (_, j) => (row[c - 1 + j] === undefined ? '' : row[c - 1 + j]))); } return out; },
      setValues: (vals) => { vals.forEach((v, i) => { rs[r - 1 + i] = rs[r - 1 + i] || []; v.forEach((x, j) => { rs[r - 1 + i][c - 1 + j] = x; }); }); return range(r, c, nr, nc, store); },
      setValue: (v) => { rs[r - 1] = rs[r - 1] || []; rs[r - 1][c - 1] = v; return range(r, c, nr, nc, store); },
      setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; },
    };
  };
  const sheet = {
    getLastRow: () => rows.length,
    getRange: (a, b, c, d) => (typeof a === 'string' ? range(1, 1, 1, 1) : range(a, b, c, d)),
    appendRow: (v) => rows.push(v.slice()),
    setFrozenRows() {}, setColumnWidth() {}, clear() {},
  };
  const stats = Object.assign({}, sheet, { getRange: (a, b, c, d) => (typeof a === 'string' ? range(1, 1, 1, 1, statRows) : range(a, b, c, d, statRows)) });

  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }

  const ctx = {
    console: { log() {}, error() {} },
    Date: FakeDate, JSON, Math, Number, String, Object, Array, RegExp, isNaN,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => (n === 'DangKy' ? (rows.length ? sheet : null) : stats),
        insertSheet: (n) => { if (n === 'DangKy') rows.push([]); return n === 'DangKy' ? sheet : stats; },
      }),
      getUi: () => { throw new Error('no ui'); },
    },
    MailApp: { sendEmail: (to, subject, body) => alerts.push({ to, subject, body }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = v; }, remove: (k) => { delete cacheStore[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    UrlFetchApp: {
      fetch: (url, o) => {
        if (url.includes('mailtrap.io')) {
          const req = { url, headers: o.headers, body: JSON.parse(o.payload) };
          mailtrap.push(req);
          const r = responder(req, mailtrap.length);
          if (r.throw) throw new Error(r.throw);
          return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body) };
        }
        return { getResponseCode: () => 200, getContent: () => [137, 80, 78, 71] };   // ảnh QR
      },
    },
    Utilities: { base64Encode: (b) => Buffer.from(b).toString('base64') },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger() {}, newTrigger: (fn) => ({ timeBased: () => ({ everyHours: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@gmail.com' }) },
  };
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  vm.runInContext(code + '\n;this.__api = {doPost, doGet, caiDat, xuLyHangDoi, guiThongBaoPhienBanMoi, guiThuChoToi, xemHanMuc, readQuota_, CONFIG};', ctx);
  const api = ctx.__api;
  return {
    api, rows, mailtrap, alerts, props, triggers, cacheStore,
    setResponder: (f) => { responder = f; },
    advance: (ms) => { clock += ms; },
    post: (body) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text),
    clearRate: () => Object.keys(cacheStore).forEach((k) => { if (k.startsWith('em:') || k.startsWith('rl:')) delete cacheStore[k]; }),
  };
}

const base = { name: 'Nguyễn Văn An', email: 'An@Example.com', platform: 'Claude Code', purpose: 'Tài liệu công việc, báo cáo', updates: true, consent: true, website: '', source: 'facebook' };
const ok200 = () => ({ code: 200, body: { success: true, message_ids: ['m'] } });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }
const ST = (env, i) => env.rows[i][8];

test('caiDat tạo header và trigger hằng giờ', () => {
  const env = makeEnv(); env.api.caiDat();
  assert.strictEqual(env.rows[0][2], 'Email');
  assert.strictEqual(env.triggers.length, 1);
});

test('đăng ký hợp lệ: gọi Mailtrap transactional đúng định dạng, có QR inline, reply-to hello@', () => {
  const env = makeEnv(); env.api.caiDat();
  const r = env.post(base);
  assert.deepStrictEqual(r, { ok: true, sent: true });
  assert.strictEqual(ST(env, 1), 'Đã gửi');
  assert.strictEqual(env.mailtrap.length, 1);
  const req = env.mailtrap[0];
  assert.strictEqual(req.url, 'https://send.api.mailtrap.io/api/send');
  assert.strictEqual(req.headers.Authorization, 'Bearer tok_test');
  assert.deepStrictEqual(req.body.from, { email: 'hello@huynhanhthuan.com', name: 'Huỳnh Anh Thuận' });
  assert.deepStrictEqual(req.body.to, [{ email: 'an@example.com', name: 'Nguyễn Văn An' }]);
  assert.strictEqual(req.body.reply_to.email, 'hello@huynhanhthuan.com');
  assert.strictEqual(req.body.category, 'welcome');
  assert.ok(req.body.subject.includes('Claude Code'));
  assert.ok(req.body.html.includes('Chào An,') && req.body.html.includes('cid:vietqr') && req.body.html.includes('0161001623062'));
  assert.ok(req.body.text.includes('0161001623062'));
  assert.deepStrictEqual(Object.keys(req.body.attachments[0]).sort(), ['content', 'content_id', 'disposition', 'filename', 'type']);
  assert.strictEqual(req.body.attachments[0].disposition, 'inline');
  assert.strictEqual(req.body.attachments[0].content_id, 'vietqr');
  assert.ok(req.body.html.includes('pdf.huynhanhthuan.com'));
  assert.strictEqual(env.api.readQuota_().day, 1);
  assert.strictEqual(env.alerts.length, 0);
});

test('bot điền ô ẩn: trả ok nhưng không ghi, không gửi', () => {
  const env = makeEnv(); env.api.caiDat();
  assert.ok(env.post(Object.assign({}, base, { website: 'http://spam' })).ok);
  assert.strictEqual(env.rows.length, 1); assert.strictEqual(env.mailtrap.length, 0);
});

test('dữ liệu sai: báo lỗi tiếng Việt, không ghi', () => {
  const env = makeEnv(); env.api.caiDat();
  assert.strictEqual(env.post(Object.assign({}, base, { consent: false })).ok, false);
  assert.strictEqual(env.post(Object.assign({}, base, { email: 'abc@' })).ok, false);
  assert.strictEqual(env.post(Object.assign({}, base, { platform: 'Copilot' })).ok, false);
  assert.strictEqual(env.rows.length, 1);
});

test('đăng ký lại trong 24 giờ hoặc bấm 2 lần: không gửi trùng', () => {
  const env = makeEnv(); env.api.caiDat();
  env.post(base);
  assert.ok(env.post(base).duplicate);          // chặn bởi cache 60 giây
  env.clearRate();
  assert.ok(env.post(base).duplicate);          // chặn bởi "Lần gửi cuối" < 24h
  assert.strictEqual(env.mailtrap.length, 1);
  env.advance(25 * 3600 * 1000); env.clearRate();
  assert.ok(env.post(base).sent);               // sau 24h được gửi lại
});

test('token sai (401): xếp hàng, tạm dừng 1 giờ, cảnh báo chủ đúng 1 lần, không tính lượt thử', () => {
  const env = makeEnv({ responder: () => ({ code: 401, body: { success: false, errors: ['Unauthorized'] } }) });
  env.api.caiDat();
  const r = env.post(base);
  assert.deepStrictEqual(r, { ok: true, queued: true });
  assert.strictEqual(ST(env, 1), 'Chờ gửi');
  assert.strictEqual(env.rows[1][10], 0);
  assert.ok(String(env.rows[1][12]).includes('401'));
  assert.strictEqual(env.alerts.length, 1);
  assert.strictEqual(env.alerts[0].to, 'owner@gmail.com');
  env.clearRate();
  env.post(Object.assign({}, base, { email: 'b@x.com' }));     // đang tạm dừng: không gọi Mailtrap nữa
  assert.strictEqual(env.mailtrap.length, 1);
  assert.strictEqual(ST(env, 2), 'Chờ gửi');
  // anh sửa token, 1 giờ sau trigger gửi bù cả 2
  env.setResponder(ok200); env.advance(61 * 60 * 1000); env.api.xuLyHangDoi();
  assert.strictEqual(ST(env, 1), 'Đã gửi'); assert.strictEqual(ST(env, 2), 'Đã gửi');
  assert.strictEqual(env.alerts.length, 1);
});

test('chưa có MAILTRAP_TOKEN: vẫn ghi đăng ký vào hàng chờ', () => {
  const env = makeEnv({ noToken: true }); env.api.caiDat();
  assert.ok(env.post(base).queued);
  assert.strictEqual(env.mailtrap.length, 0);
  env.props.MAILTRAP_TOKEN = 'tok_new'; env.api.xuLyHangDoi();
  assert.strictEqual(ST(env, 1), 'Đã gửi');
});

test('tên miền chưa verified (403): xếp hàng + cảnh báo', () => {
  const env = makeEnv({ responder: () => ({ code: 403, body: { success: false, errors: ['Forbidden'] } }) });
  env.api.caiDat();
  assert.ok(env.post(base).queued);
  assert.strictEqual(env.alerts.length, 1);
});

test('đạt hạn mức tự đếm 145/150: email thứ 146 vào hàng chờ, không gọi Mailtrap', () => {
  const env = makeEnv(); env.api.caiDat();
  env.props.QUOTA = JSON.stringify({ dayKey: '2026-11-01', monthKey: '2026-11', day: 145, month: 145 });
  assert.ok(env.post(base).queued);
  assert.strictEqual(env.mailtrap.length, 0);
  env.advance(24 * 3600 * 1000); env.api.xuLyHangDoi();     // sang ngày UTC mới
  assert.strictEqual(ST(env, 1), 'Đã gửi');
});

test('hạn mức tháng 4.000: chặn khi chạm 3.995', () => {
  const env = makeEnv(); env.api.caiDat();
  env.props.QUOTA = JSON.stringify({ dayKey: '2026-11-01', monthKey: '2026-11', day: 3, month: 3995 });
  assert.ok(env.post(base).queued);
  assert.strictEqual(env.mailtrap.length, 0);
});

test('Mailtrap báo vượt hạn mức: đồng bộ bộ đếm ngày, cảnh báo, giữ hàng chờ', () => {
  const env = makeEnv({ responder: () => ({ code: 403, body: { success: false, errors: ['Daily sending limit exceeded'] } }) });
  env.api.caiDat();
  // 403 kèm thông điệp limit vẫn là lỗi cấu hình/quyền theo tài liệu; thử thêm trường hợp 400 + limit
  env.setResponder(() => ({ code: 400, body: { success: false, errors: ['Sending limit exceeded for your plan'] } }));
  assert.ok(env.post(base).queued);
  assert.strictEqual(ST(env, 1), 'Chờ gửi');
  assert.strictEqual(env.api.readQuota_().day, 150);
  assert.strictEqual(env.alerts.length, 1);
});

test('429 quá tải: nghỉ 1 phút rồi gửi lại', () => {
  let n = 0;
  const env = makeEnv({ responder: () => (++n === 1 ? { code: 429, body: { success: false, errors: ['Too Many Requests'] } } : ok200()) });
  env.api.caiDat();
  assert.ok(env.post(base).queued);
  env.api.xuLyHangDoi();
  assert.strictEqual(ST(env, 1), 'Chờ gửi', 'trong 1 phút nghỉ không gửi');
  env.advance(61 * 1000); env.api.xuLyHangDoi();
  assert.strictEqual(ST(env, 1), 'Đã gửi');
  assert.strictEqual(env.alerts.length, 0);
});

test('lỗi máy chủ 500 / mất mạng: thử lại, ngừng sau 3 lần', () => {
  const env = makeEnv({ responder: () => ({ throw: 'Address unavailable' }) });
  env.api.caiDat();
  assert.ok(env.post(base).queued);
  assert.strictEqual(ST(env, 1), 'Lỗi gửi');
  env.setResponder(() => ({ code: 500, body: { success: false, errors: ['Internal'] } }));
  env.api.xuLyHangDoi(); env.api.xuLyHangDoi();
  assert.strictEqual(ST(env, 1), 'Ngừng gửi');
  env.setResponder(ok200); env.api.xuLyHangDoi();
  assert.strictEqual(ST(env, 1), 'Ngừng gửi');
});

test('400 dữ liệu sai cho 1 người không chặn người khác', () => {
  const env = makeEnv({ responder: (req) => (req.body.to[0].email === 'bad@x.com' ? { code: 400, body: { success: false, errors: ["'to' address is invalid"] } } : ok200()) });
  env.api.caiDat();
  env.post(Object.assign({}, base, { email: 'bad@x.com' })); env.clearRate();
  assert.ok(env.post(base).sent);
  assert.strictEqual(ST(env, 1), 'Lỗi gửi');
  assert.strictEqual(env.alerts.length, 0);
});

test('chặn chèn công thức vào Sheets, escape HTML tên người', () => {
  const env = makeEnv(); env.api.caiDat();
  env.post(Object.assign({}, base, { name: '=HYPERLINK("http://x","y")', email: 'x@y.com' })); env.clearRate();
  env.post(Object.assign({}, base, { email: 'a@b.com', platform: 'ChatGPT', name: 'Lê <b>Hoa</b>' }));
  assert.ok(String(env.rows[1][1]).startsWith("'="));
  const html = env.mailtrap[1].body.html;
  assert.ok(html.includes('Hoa&lt;/b&gt;') && !html.includes('<b>Hoa</b>') && html.includes('gpts/editor'));
});

test('giới hạn 20 đăng ký/phút chống bot', () => {
  const env = makeEnv(); env.api.caiDat();
  let blocked = 0;
  for (let i = 0; i < 25; i++) if (!env.post(Object.assign({}, base, { email: 'u' + i + '@x.com' })).ok) blocked++;
  assert.strictEqual(blocked, 5);
});

test('doGet count', () => {
  const env = makeEnv(); env.api.caiDat();
  env.post(base); env.clearRate(); env.post(Object.assign({}, base, { email: 'z@z.com' }));
  assert.deepStrictEqual(JSON.parse(env.api.doGet({ parameter: { action: 'count' } }).text), { ok: true, count: 2 });
});

test('thông báo phiên bản mới: dùng luồng Bulk, chỉ người đồng ý, không gửi lại', () => {
  const env = makeEnv(); env.api.caiDat();
  env.post(base); env.clearRate();
  env.post(Object.assign({}, base, { email: 'no@x.com', updates: false }));
  const before = env.mailtrap.length;
  env.api.guiThongBaoPhienBanMoi();
  const sent = env.mailtrap.slice(before);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].url, 'https://bulk.api.mailtrap.io/api/send');
  assert.strictEqual(sent[0].body.category, 'release-update');
  assert.strictEqual(sent[0].body.to[0].email, 'an@example.com');
  assert.strictEqual(env.props.ANNOUNCE_VERSION, undefined);
  env.api.guiThongBaoPhienBanMoi();
  assert.strictEqual(env.mailtrap.length - before, 1);
});

test('thông báo bị gián đoạn do hạn mức thì gửi tiếp ở lần chạy sau', () => {
  const env = makeEnv(); env.api.caiDat();
  for (let i = 0; i < 3; i++) { env.post(Object.assign({}, base, { email: 'p' + i + '@x.com' })); env.clearRate(); }
  env.props.QUOTA = JSON.stringify({ dayKey: '2026-11-01', monthKey: '2026-11', day: 144, month: 144 });
  env.api.guiThongBaoPhienBanMoi();
  assert.strictEqual(env.props.ANNOUNCE_VERSION, '3.0.1');
  env.advance(24 * 3600 * 1000); env.api.xuLyHangDoi();
  assert.strictEqual(env.props.ANNOUNCE_VERSION, undefined);
  assert.strictEqual(env.mailtrap.filter((m) => m.url.includes('bulk')).length, 3);
});

test('guiThuChoToi gửi qua Mailtrap tới Gmail chủ', () => {
  const env = makeEnv(); env.api.caiDat();
  env.api.guiThuChoToi();
  assert.strictEqual(env.mailtrap[0].body.to[0].email, 'owner@gmail.com');
  assert.strictEqual(env.mailtrap[0].body.category, 'test');
});

console.log('\n' + passed + ' kiểm thử đạt.');
const env = makeEnv(); env.api.caiDat(); env.post(base);
fs.writeFileSync(path.join(__dirname, 'email-preview.html'), env.mailtrap[0].body.html.replace('cid:vietqr', '../../assets/img/vietqr-any.png'));
