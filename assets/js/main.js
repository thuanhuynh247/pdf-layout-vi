/* main.js — tương tác trang phát hành. Không phụ thuộc thư viện ngoài. */
(function () {
  "use strict";
  var CFG = window.SITE_CONFIG || {};
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- Phiên bản & năm ---------- */
  if (CFG.VERSION) {
    $$("[data-version]").forEach(function (el) { el.textContent = "v" + CFG.VERSION; });
    $$("[data-version-plain]").forEach(function (el) { el.textContent = CFG.VERSION; });
  }
  var yearEl = $("#year"); if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Liên kết theo cấu hình: GPT, mã nguồn, tải thẳng ---------- */
  $$("[data-gpt]").forEach(function (el) {
    if (!CFG.GPT_URL) return;
    el.href = CFG.GPT_URL; el.hidden = false;
    if (el.getAttribute("data-gpt-label")) el.textContent = el.getAttribute("data-gpt-label");
  });
  $$("[data-gpt-off]").forEach(function (el) { el.hidden = !!CFG.GPT_URL; });
  $$("[data-github]").forEach(function (el) { if (CFG.GITHUB_URL) { el.href = CFG.GITHUB_URL; el.hidden = false; } });
  $$("[data-github-off]").forEach(function (el) { el.hidden = !!CFG.GITHUB_URL; });
  $$("[data-direct]").forEach(function (el) { el.hidden = CFG.CLAUDE_DIRECT_DOWNLOAD === false; });
  $$("[data-via-email]").forEach(function (el) { el.hidden = CFG.CLAUDE_DIRECT_DOWNLOAD !== false; });

  /* ---------- So sánh EN / VI ---------- */
  var compare = $("#compare");
  var range = $("#compare-range");
  function setPos(v) { if (compare) compare.style.setProperty("--pos", v + "%"); }
  if (compare && range) {
    range.addEventListener("input", function () { setPos(range.value); });
    setPos(range.value);
  }

  /* ---------- Khung chữ từ layout log ---------- */
  var boxesSvg = compare ? $("svg.boxes", compare) : null;
  var toggle = $("#toggle-boxes");
  var data = window.P13_BOXES;
  if (boxesSvg && data && data.lines) {
    var ns = "http://www.w3.org/2000/svg";
    data.lines.forEach(function (b) {
      var r = document.createElementNS(ns, "rect");
      r.setAttribute("x", b[0]); r.setAttribute("y", b[1]);
      r.setAttribute("width", Math.max(0, b[2] - b[0])); r.setAttribute("height", Math.max(0, b[3] - b[1]));
      boxesSvg.appendChild(r);
    });
    var note = $("#boxes-note");
    if (note) note.textContent = data.lines.length + " dòng · " + data.runs + " run · 0 tràn lề";
  }
  if (toggle && compare) {
    toggle.addEventListener("change", function () {
      compare.classList.toggle("show-boxes", toggle.checked);
      // Khi bật khung chữ, kéo thanh sang trái để thấy rõ bản dịch
      if (toggle.checked && range && Number(range.value) > 20) { range.value = 12; setPos(12); }
    });
  }

  /* ---------- Sao chép ---------- */
  function copyText(text, btn) {
    function ok() {
      var old = btn.textContent; btn.textContent = "Đã chép"; btn.classList.add("ok");
      setTimeout(function () { btn.textContent = old; btn.classList.remove("ok"); }, 1600);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { btn.textContent = "Hãy chép tay"; }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fallback);
    } else { fallback(); }
  }
  $$(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () { copyText(btn.getAttribute("data-copy"), btn); });
  });

  /* ---------- VietQR theo số tiền ---------- */
  var qr = $("#qr-img");
  $$('input[name="amount"]').forEach(function (r) {
    r.addEventListener("change", function () {
      if (!qr || !r.checked) return;
      qr.src = "assets/img/vietqr-" + r.value + ".png";
      var label = r.value === "any" ? "số tiền tùy tâm" : r.nextElementSibling.textContent;
      qr.alt = "Mã VietQR chuyển khoản Vietcombank tới Huỳnh Anh Thuận, " + label + ".";
    });
  });

  /* ---------- Video demo + nghe thử giọng đọc ---------- */
  var video = $("#demo-video");
  var voices = $$(".voice");
  var current = null; // { el, audio }

  function stopVoice(v) {
    if (!v) return;
    v.audio.pause();
    v.audio.currentTime = 0;
    v.el.classList.remove("is-playing");
    var btn = $(".voice-btn", v.el);
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", btn.getAttribute("aria-label").replace(/^Dừng/, "Phát"));
    $$(".voice-text span", v.el).forEach(function (s) { s.classList.remove("is-active"); });
    $(".voice-bar i", v.el).style.width = "0";
    if (current === v) current = null;
  }

  function syncVoice(v) {
    var t = v.audio.currentTime, d = v.audio.duration || 1;
    $(".voice-bar i", v.el).style.width = Math.min(100, (t / d) * 100) + "%";
    var spans = $$(".voice-text span", v.el), active = null;
    spans.forEach(function (s) { if (t >= Number(s.getAttribute("data-t"))) active = s; });
    spans.forEach(function (s) { s.classList.toggle("is-active", s === active); });
  }

  voices.forEach(function (el) {
    var btn = $(".voice-btn", el);
    var v = { el: el, audio: null };
    btn.addEventListener("click", function () {
      if (current === v && !v.audio.paused) { stopVoice(v); return; }
      if (current) stopVoice(current);
      if (video && !video.paused) video.pause();
      if (!v.audio) {
        v.audio = new Audio(el.getAttribute("data-src"));
        v.audio.preload = "auto";
        v.audio.addEventListener("timeupdate", function () { syncVoice(v); });
        v.audio.addEventListener("ended", function () { stopVoice(v); });
        v.audio.addEventListener("error", function () {
          stopVoice(v);
          var txt = $(".voice-head .mono", el);
          if (txt) txt.textContent = "Không tải được âm thanh";
        });
      }
      current = v;
      el.classList.add("is-playing");
      btn.setAttribute("aria-pressed", "true");
      btn.setAttribute("aria-label", btn.getAttribute("aria-label").replace(/^Phát/, "Dừng"));
      var p = v.audio.play();
      if (p && p.catch) p.catch(function () { stopVoice(v); });
    });
  });

  if (video) {
    video.addEventListener("play", function () { if (current) stopVoice(current); });
  }

  /* ---------- Bộ đếm người đăng ký (tùy chọn) ---------- */
  var threshold = Number(CFG.SHOW_COUNT_FROM || 0);
  if (CFG.APPS_SCRIPT_URL && threshold > 0 && window.fetch) {
    fetch(CFG.APPS_SCRIPT_URL + "?action=count", { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok && j.count >= threshold) {
          var meta = $(".meta-row");
          if (meta) {
            var s = document.createElement("span");
            s.className = "num";
            s.textContent = j.count.toLocaleString("vi-VN") + " người đã nhận";
            meta.appendChild(s);
          }
        }
      })
      .catch(function () { /* bộ đếm không quan trọng, bỏ qua lỗi */ });
  }

  /* ---------- Form đăng ký ---------- */
  var form = $("#signup");
  if (!form) return;
  // Chọn sẵn nền tảng khi đến từ link dạng ./?nen-tang=Claude.ai#dang-ky
  try {
    var want = new URLSearchParams(location.search).get("nen-tang");
    $$('input[name="platform"]', form).forEach(function (r) { if (want && r.value === want) r.checked = true; });
  } catch (e) { /* trình duyệt cũ: bỏ qua */ }
  var btn = $("#submit-btn");
  var status = $("#form-status");
  var done = $("#done");
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function setErr(id, msg, target) {
    var el = $("#" + id);
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
    if (target) target.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function readForm() {
    var platform = $('input[name="platform"]:checked', form);
    return {
      name: $("#f-name").value.trim(),
      email: $("#f-email").value.trim().toLowerCase(),
      platform: platform ? platform.value : "",
      purpose: $("#f-purpose").value,
      updates: $("#f-updates").checked,
      consent: $("#f-consent").checked,
      website: $("#f-website").value, // bẫy bot, người thật để trống
    };
  }

  function validate(d) {
    var first = null;
    var nameEl = $("#f-name"), emailEl = $("#f-email"), platEl = $("#f-platform"), consEl = $("#f-consent");
    if (!d.name) { setErr("e-name", "Nhập họ tên để email chào đúng tên bạn.", nameEl); first = first || nameEl; } else setErr("e-name", "", nameEl);
    if (!EMAIL_RE.test(d.email)) { setErr("e-email", "Email chưa đúng dạng, ví dụ ten@gmail.com.", emailEl); first = first || emailEl; } else setErr("e-email", "", emailEl);
    if (!d.platform) { setErr("e-platform", "Chọn một nền tảng để nhận đúng hướng dẫn cài.", platEl); first = first || $('input[name="platform"]', form); } else setErr("e-platform", "", platEl);
    if (!d.consent) { setErr("e-consent", "Cần bạn đồng ý để có thể gửi email cho bạn.", consEl); first = first || consEl; } else setErr("e-consent", "", consEl);
    return first;
  }

  // Xóa lỗi ngay khi người dùng sửa
  ["f-name", "f-email"].forEach(function (id) {
    var el = $("#" + id);
    el.addEventListener("input", function () { if (el.getAttribute("aria-invalid") === "true") setErr("e-" + id.slice(2), "", el); });
  });
  $$('input[name="platform"]', form).forEach(function (r) { r.addEventListener("change", function () { setErr("e-platform", "", $("#f-platform")); }); });
  $("#f-consent").addEventListener("change", function (e) { if (e.target.checked) setErr("e-consent", "", e.target); });

  function source() {
    try {
      var p = new URLSearchParams(location.search);
      var utm = p.get("utm_source") || p.get("ref") || "";
      var ref = document.referrer ? new URL(document.referrer).hostname : "";
      if (ref === location.hostname) ref = "";
      return [utm, ref].filter(Boolean).join(" · ").slice(0, 120);
    } catch (e) { return ""; }
  }

  function busy(on) {
    btn.disabled = on;
    btn.setAttribute("aria-busy", on ? "true" : "false");
    btn.innerHTML = on ? '<span class="spinner" aria-hidden="true"></span>Đang gửi…' : "Gửi gói kỹ năng cho tôi";
  }

  function showDone(d, result, demo) {
    form.hidden = true;
    done.hidden = false;
    var title = $("#done-title"), text = $("#done-text");
    if (result && result.queued) {
      title.textContent = "Đã nhận, email sẽ đến trong 24 giờ";
      text.textContent = "Hệ thống đã ghi nhận đăng ký và sẽ tự gửi hướng dẫn tới " + d.email + " trong vòng 24 giờ, từ địa chỉ hello@huynhanhthuan.com.";
    } else if (result && result.duplicate) {
      title.textContent = "Email này đã đăng ký rồi";
      text.textContent = "Hướng dẫn đã được gửi tới " + d.email + " trước đó. Hãy tìm thư từ hello@huynhanhthuan.com, kể cả trong mục Spam.";
    } else {
      title.textContent = "Đã gửi, kiểm tra hộp thư nhé";
      text.textContent = "File và hướng dẫn cho " + d.platform + " đang tới " + d.email + " từ hello@huynhanhthuan.com. Thường mất 1–2 phút.";
    }
    $("#demo-note").hidden = !demo;
    done.focus();
  }

  $("#again-btn").addEventListener("click", function () {
    form.reset(); form.hidden = false; done.hidden = true; status.textContent = ""; status.className = "form-status";
    $("#f-name").focus();
  });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    status.textContent = ""; status.className = "form-status";
    var d = readForm();
    var firstInvalid = validate(d);
    if (firstInvalid) { firstInvalid.focus(); status.textContent = "Còn vài ô cần điền."; status.className = "form-status is-error"; return; }

    // Chế độ xem trước khi chưa cấu hình máy chủ
    if (!CFG.APPS_SCRIPT_URL) {
      busy(true);
      setTimeout(function () { busy(false); showDone(d, { ok: true }, true); }, 700);
      return;
    }

    var payload = {
      name: d.name, email: d.email, platform: d.platform, purpose: d.purpose,
      updates: d.updates, consent: d.consent, website: d.website,
      source: source(), page: location.href.split("#")[0].slice(0, 200),
    };
    busy(true);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);

    // Gửi dạng text/plain để trình duyệt không cần preflight CORS với Apps Script
    fetch(CFG.APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(payload), signal: ctrl ? ctrl.signal : undefined, redirect: "follow" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        clearTimeout(timer); busy(false);
        if (res && res.ok) { showDone(d, res, false); return; }
        var msg = (res && res.error) || "Máy chủ chưa nhận được đăng ký. Thử lại sau ít phút.";
        status.textContent = msg; status.className = "form-status is-error";
      })
      .catch(function (err) {
        clearTimeout(timer); busy(false);
        status.textContent = err && err.name === "AbortError"
          ? "Máy chủ phản hồi quá lâu. Kiểm tra mạng rồi bấm gửi lại."
          : "Không kết nối được máy chủ. Kiểm tra mạng rồi bấm gửi lại.";
        status.className = "form-status is-error";
      });
  });
})();
