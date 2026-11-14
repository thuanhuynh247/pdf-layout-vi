/* desktop/app/app.js — PDF Layout VI Studio (Windows Desktop Application) */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var STATE = {
    engines: [],
    config: { activeEngine: "codex", chunkChars: 7000, outputDir: "", models: {}, apiKeys: {} },
    inspectedId: "codex",
    activeJobId: null,
    jobTimer: null,
    pdfBytes: null,
    pdfName: "",
    docInfo: null,
    segments: [],      // [{ id, src, dst, warn }]
    segMap: {},        // id -> index
    warnIds: [],
    running: false,
    stop: false,
    qaSrcFile: null,
    qaDstFile: null,
  };

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtSize(n) {
    return n < 1e6 ? Math.max(1, Math.round(n / 1e3)) + " KB" : (n / 1e6).toFixed(1) + " MB";
  }

  function logLine(msg) {
    var pre = $("#logs-pre");
    if (!pre) return;
    var ts = new Date().toLocaleTimeString("vi-VN", { hour12: false });
    pre.textContent += "[" + ts + "] " + msg + "\n";
    pre.scrollTop = pre.scrollHeight;
  }

  function api(path, body) {
    var opts = body !== undefined
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : { method: "GET" };
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.ok === false) throw new Error(d.error || ("HTTP " + r.status));
        return d;
      });
    });
  }

  /* ---------------- Pyodide Worker ---------------- */
  var worker = null, seq = 0, waiting = {};
  function ensureWorker() {
    if (worker) return;
    worker = new Worker("worker.js");
    worker.onmessage = function (e) {
      var d = e.data;
      if (d.type === "status") {
        $("#top-engine-label").textContent = d.text;
        $("#top-engine-dot").className = "dot " + (d.frac >= 1 ? "is-ok" : "is-busy");
        if (d.frac >= 1) logLine("Pyodide engine: " + d.text);
        return;
      }
      var w = waiting[d.id];
      if (!w) return;
      delete waiting[d.id];
      if (d.ok) w.resolve(d.result); else w.reject(new Error(d.error));
    };
    worker.onerror = function (e) {
      logLine("Worker error: " + e.message);
    };
  }
  function callWorker(cmd) {
    var args = Array.prototype.slice.call(arguments, 1), transfer = [];
    args.forEach(function (a) { if (a instanceof ArrayBuffer) transfer.push(a); });
    ensureWorker();
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      waiting[id] = { resolve: resolve, reject: reject };
      worker.postMessage({ id: id, cmd: cmd, args: args }, transfer);
    });
  }

  /* ---------------- Navigation ---------------- */
  function switchView(name) {
    $$(".nav-btn").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-view") === name); });
    $$(".view").forEach(function (v) { v.classList.toggle("is-active", v.id === "view-" + name); });
  }
  function switchMonTab(tab) {
    $$(".tab-btn").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-mon-tab") === tab); });
    $$(".mon-panel").forEach(function (p) { p.classList.toggle("is-active", p.id === "mon-tab-" + tab); });
  }

  /* ---------------- Connectors & Inspector ---------------- */
  function findEngine(id) {
    return STATE.engines.filter(function (e) { return e.id === id; })[0] || null;
  }

  function updateHeaderAndConfigUI() {
    var active = findEngine(STATE.config.activeEngine) || STATE.engines[0];
    if (active) {
      var ready = active.installed && active.loggedIn;
      $("#top-connector-dot").className = "dot " + (ready ? "is-ok" : "is-warn");
      var mdl = (STATE.config.models && STATE.config.models[active.id]) || active.defaultModel || "mặc định";
      $("#top-connector-label").textContent = active.name + " · " + mdl;
    }
    var outDir = STATE.config.outputDir || "";
    $("#rail-output-dir").textContent = outDir;
    $("#rail-output-dir").title = outDir;
    if (STATE.config.chunkChars) $("#ws-chunk").value = String(STATE.config.chunkChars);
  }

  function renderRailConnectors() {
    var readyCount = STATE.engines.filter(function (e) { return e.installed && e.loggedIn; }).length;
    $("#badge-ready").textContent = readyCount + "/" + STATE.engines.length;

    $("#rail-connectors").innerHTML = STATE.engines.map(function (e) {
      var dotCls = (e.installed && e.loggedIn) ? "is-ok" : (e.installed ? "is-warn" : "");
      var isActive = STATE.config.activeEngine === e.id;
      var tag = isActive ? "CHÍNH" : ((e.installed && e.loggedIn) ? "Sẵn sàng" : (e.installed ? "Login" : "Cài"));
      return "<button class='rail-conn-item" + (isActive ? " is-selected" : "") + "' data-rail-eng='" + esc(e.id) + "' type='button'>" +
        "<span class='dot " + dotCls + "'></span>" +
        "<span style='overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(e.name) + "</span>" +
        "<span class='rail-conn-tag'>" + tag + "</span></button>";
    }).join("");

    $$("[data-rail-eng]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-rail-eng");
        var eng = findEngine(id);
        STATE.inspectedId = id;
        if (eng && eng.installed && eng.loggedIn) {
          setActiveEngine(id);
        } else {
          switchView("connectors");
        }
        renderConnectorsGrid();
        renderInspector();
      });
    });

    // Sync workspace engine dropdown
    var sel = $("#ws-engine-select");
    if (sel) {
      sel.innerHTML = STATE.engines.map(function (e) {
        var tag = (e.installed && e.loggedIn) ? "✓" : (e.installed ? "!" : "○");
        return "<option value='" + esc(e.id) + "'>" + tag + " " + esc(e.name) + "</option>";
      }).join("");
      sel.value = STATE.config.activeEngine || (STATE.engines[0] && STATE.engines[0].id) || "";
      syncWorkspaceModel();
    }
  }

  function syncWorkspaceModel() {
    var id = $("#ws-engine-select").value;
    var eng = findEngine(id);
    var saved = (STATE.config.models && STATE.config.models[id]) || "";
    $("#ws-model-input").value = saved;
    $("#ws-model-input").placeholder = (eng && eng.defaultModel) || "Mặc định của CLI";
  }

  function renderConnectorsGrid() {
    $("#connectors-grid").innerHTML = STATE.engines.map(function (e) {
      var ready = e.installed && e.loggedIn;
      var chipCls = ready ? "ok" : (e.installed ? "warn" : "off");
      var chipTxt = ready ? "Sẵn sàng" : (e.installed ? "Cần đăng nhập" : "Chưa cài");
      var isActive = STATE.config.activeEngine === e.id;
      var isInsp = STATE.inspectedId === e.id;
      return "<div class='conn-card" + (isInsp ? " is-inspected" : "") + (isActive ? " is-active-engine" : "") + "' data-card-eng='" + esc(e.id) + "'>" +
        "<div class='conn-card-top'><div><div class='conn-name'>" + esc(e.name) + "</div><div class='conn-vendor'>" + esc(e.vendor) + "</div></div>" +
        "<span class='status-chip " + chipCls + "'>" + chipTxt + "</span></div>" +
        "<div class='conn-detail'>" + esc(e.detail) + "</div>" +
        "<div class='conn-foot'><span class='active-pill'>" + (isActive ? "● Đang chọn dịch chính" : "") + "</span>" +
        "<span class='rail-conn-tag'>" + esc((STATE.config.models && STATE.config.models[e.id]) || e.defaultModel || "mặc định") + "</span></div>" +
        "</div>";
    }).join("");

    $$("[data-card-eng]").forEach(function (card) {
      card.addEventListener("click", function () {
        STATE.inspectedId = card.getAttribute("data-card-eng");
        renderConnectorsGrid();
        renderInspector();
      });
    });
  }

  function renderInspector() {
    var eng = findEngine(STATE.inspectedId);
    if (!eng) { $("#insp-empty").hidden = false; $("#insp-body").hidden = true; return; }
    $("#insp-empty").hidden = true;
    $("#insp-body").hidden = false;

    var ready = eng.installed && eng.loggedIn;
    $("#insp-vendor").textContent = eng.vendor;
    $("#insp-name").textContent = eng.name;
    $("#insp-chip").className = "status-chip " + (ready ? "ok" : eng.installed ? "warn" : "off");
    $("#insp-chip").textContent = ready ? "Sẵn sàng" : (eng.installed ? "Cần đăng nhập" : "Chưa cài");

    var metaHtml = "<div><strong>Trạng thái:</strong> " + esc(eng.detail) + "</div>";
    if (eng.bin) metaHtml += "<div><strong>Đường dẫn:</strong> <span class='mono'>" + esc(eng.bin) + "</span></div>";
    if (eng.account) metaHtml += "<div><strong>Tài khoản:</strong> " + esc(eng.account) + "</div>";
    $("#insp-meta").innerHTML = metaHtml;

    $("#insp-model").value = (STATE.config.models && STATE.config.models[eng.id]) || "";
    $("#insp-model").placeholder = eng.defaultModel || "Để trống = dùng mặc định của CLI";
    $("#insp-model-list").innerHTML = (eng.models || []).map(function (m) { return "<option value='" + esc(m) + "'>"; }).join("");

    if (eng.envKeyName) {
      $("#insp-key-wrap").hidden = false;
      $("#insp-key-label").textContent = eng.envKeyLabel || eng.envKeyName;
      var kInfo = STATE.config.apiKeys && STATE.config.apiKeys[eng.envKeyName];
      $("#insp-api-key").value = "";
      $("#insp-api-key").placeholder = kInfo ? ("Đã lưu: " + kInfo.preview + " (nhập mới để thay)") : "Dán khóa API (tùy chọn)…";
      $("#insp-key-hint").textContent = kInfo ? "Khóa đang được lưu cục bộ trong AppData\\pdf-layout-vi." : "Hoặc đăng nhập bằng tài khoản OAuth ở nút bên dưới.";
    } else {
      $("#insp-key-wrap").hidden = true;
    }

    $("#insp-activate").textContent = STATE.config.activeEngine === eng.id ? "✓ Đang là nền tảng chính" : "Đặt làm nền tảng dịch chính";
    $("#insp-activate").disabled = STATE.config.activeEngine === eng.id;
    $("#insp-login").hidden = !eng.loginCmd;
    $("#insp-login-term").hidden = !eng.loginCmd;
    $("#insp-install").hidden = !eng.installCmd || eng.installed;
    $("#insp-ping-box").hidden = true;
  }

  function setActiveEngine(id) {
    STATE.config.activeEngine = id;
    api("/api/config", { activeEngine: id }).then(function (r) {
      STATE.config = r.config;
      updateHeaderAndConfigUI();
      renderRailConnectors();
      renderConnectorsGrid();
      renderInspector();
      logLine("Chuyển nền tảng dịch chính -> " + id);
    }).catch(function (e) { logLine("Lỗi lưu config: " + e.message); });
  }

  function loadEngines() {
    return api("/api/cli/engines").then(function (d) {
      STATE.engines = d.engines || [];
      if (d.config) STATE.config = d.config;
      if (!findEngine(STATE.config.activeEngine)) {
        var firstReady = STATE.engines.filter(function (e) { return e.installed && e.loggedIn; })[0];
        STATE.config.activeEngine = (firstReady && firstReady.id) || (STATE.engines[0] && STATE.engines[0].id) || "codex";
      }
      if (!findEngine(STATE.inspectedId)) STATE.inspectedId = STATE.config.activeEngine;
      updateHeaderAndConfigUI();
      renderRailConnectors();
      renderConnectorsGrid();
      renderInspector();
    }).catch(function (e) {
      logLine("Lỗi quét nền tảng AI: " + e.message);
    });
  }

  /* ---------------- In-app Streaming Job Console ---------------- */
  function startConsolePoll(jobId, title) {
    if (STATE.jobTimer) clearInterval(STATE.jobTimer);
    STATE.activeJobId = jobId;
    $("#insp-console").hidden = false;
    $("#cli-console-title").textContent = title;
    $("#cli-console-log").textContent = "Đang khởi chạy…\n";
    $("#cli-console-urls").innerHTML = "";
    $("#cli-console-input").hidden = true;

    STATE.jobTimer = setInterval(function () {
      api("/api/cli/job?id=" + encodeURIComponent(jobId)).then(function (d) {
        var j = d.job;
        $("#cli-console-log").textContent = j.output || "(đang chờ phản hồi…)";
        $("#cli-console-log").scrollTop = $("#cli-console-log").scrollHeight;
        $("#cli-console-urls").innerHTML = (j.urls || []).map(function (u) {
          return "<button class='btn-xs' data-open-url='" + esc(u) + "' type='button'>Mở link OAuth trên trình duyệt ↗</button>";
        }).join("");
        $$("[data-open-url]").forEach(function (b) {
          b.addEventListener("click", function () {
            if (window.PDF_DESKTOP && window.PDF_DESKTOP.openExternal) window.PDF_DESKTOP.openExternal(b.getAttribute("data-open-url"));
          });
        });
        $("#cli-console-input").hidden = !j.needsInput;
        if (j.status !== "running") {
          clearInterval(STATE.jobTimer);
          STATE.jobTimer = null;
          $("#cli-console-title").textContent = title + " (" + (j.status === "done" ? "Hoàn tất" : "Kết thúc: " + j.status) + ")";
          $("#cli-console-input").hidden = true;
          loadEngines();
        }
      }).catch(function () {
        clearInterval(STATE.jobTimer);
        STATE.jobTimer = null;
      });
    }, 600);
  }

  /* ---------------- PDF Workspace ---------------- */
  function loadPdfBuffer(arrayBuffer, fileName) {
    STATE.pdfBytes = arrayBuffer;
    STATE.pdfName = fileName;
    STATE.segments = [];
    STATE.segMap = {};
    $("#ws-file-name").textContent = fileName;
    $("#ws-file-sub").textContent = fmtSize(arrayBuffer.byteLength) + " · Đang phân tích cấu trúc…";
    $("#mon-status-title").textContent = "Đang khởi động bộ máy PDF & phân tích trang…";
    $("#seg-tbody").innerHTML = "<tr><td colspan='4' class='empty-cell'>Đang bóc tách khung chữ từ PDF…</td></tr>";
    $("#res-empty").hidden = false;
    $("#res-content").hidden = true;
    switchMonTab("segments");
    preparePdf();
  }

  function preparePdf() {
    if (!STATE.pdfBytes) return;
    var huongEl = $('input[name="ws-dir"]:checked');
    var huong = huongEl ? huongEl.value : "tu-dong";
    var pages = $("#ws-pages").value.trim();
    var copy = STATE.pdfBytes.slice(0);
    logLine("Phân tích PDF: " + STATE.pdfName + (pages ? " (trang " + pages + ")" : ""));
    callWorker("prepare", copy, STATE.pdfName, 15, pages, huong).then(function (r) {
      if (!r.ok) throw new Error(r.error || "Không đọc được file PDF.");
      STATE.docInfo = r;
      $("#ws-file-sub").textContent = fmtSize(STATE.pdfBytes.byteLength) + " · Sẵn sàng dịch";
      $("#ws-doc-meta").hidden = false;
      $("#meta-pages").textContent = String(r.pages) + (r.subset_pages ? " (chọn " + r.subset_pages + ")" : "");
      $("#meta-items").textContent = r.items.toLocaleString("vi-VN") + " đoạn";
      $("#meta-links").textContent = String(r.links || 0);
      $("#meta-dir").textContent = r.huong === "vi-en" ? "Việt → Anh" : "Anh → Việt";
      if (r.huong === "vi-en") $('input[name="ws-dir"][value="vi-en"]').checked = true;
      else $('input[name="ws-dir"][value="en-vi"]').checked = true;

      if (r.scanned_pages && r.scanned_pages.length) {
        $("#ws-scan-warn").hidden = false;
        $("#ws-scan-warn").textContent = "Cảnh báo: phát hiện " + r.scanned_pages.length + " trang dạng ảnh scan (không có lớp chữ vector).";
      } else {
        $("#ws-scan-warn").hidden = true;
      }

      $("#ws-run-btn").disabled = false;
      $("#ws-build-only-btn").disabled = false;
      updateProgressUI({ done: 0, total: r.items, batches_done: 0, batches_total: r.batches });
      $("#mon-status-title").textContent = "Đã sẵn sàng · bấm \"Bắt đầu dịch & dựng PDF\"";
      $("#seg-tbody").innerHTML = "<tr><td colspan='4' class='empty-cell'>Đã bóc tách " + r.items.toLocaleString("vi-VN") + " đoạn văn bản. Bấm Bắt đầu để AI dịch từng lô.</td></tr>";
      logLine("Phân tích xong: " + r.pages + " trang, " + r.items + " đoạn.");
    }).catch(function (e) {
      $("#mon-status-title").textContent = "Lỗi phân tích PDF: " + e.message;
      logLine("Lỗi prepare PDF: " + e.message);
    });
  }

  function updateProgressUI(p) {
    if (!p || !p.total) return;
    var pct = Math.round((100 * p.done) / p.total);
    $("#mon-progress-bar").style.width = pct + "%";
    $("#mon-progress-nums").textContent = p.done.toLocaleString("vi-VN") + "/" + p.total.toLocaleString("vi-VN") + " đoạn · " + pct + "% (lô " + p.batches_done + "/" + p.batches_total + ")";
  }

  function appendSegmentRows(items, translatedObj, warnings) {
    var tbody = $("#seg-tbody");
    if (!STATE.segments.length) tbody.innerHTML = "";
    items.forEach(function (it) {
      var dst = translatedObj[it.id] || "";
      var w = warnings && warnings[it.id] ? warnings[it.id].warning : "";
      if (STATE.segMap[it.id] !== undefined) {
        var idx = STATE.segMap[it.id];
        STATE.segments[idx] = { id: it.id, src: it.text, dst: dst, warn: w };
      } else {
        STATE.segMap[it.id] = STATE.segments.length;
        STATE.segments.push({ id: it.id, src: it.text, dst: dst, warn: w });
      }
    });
    tbody.innerHTML = STATE.segments.slice(-150).map(function (s) {
      var st = s.warn ? "<span class='status-chip warn'>" + esc(s.warn) + "</span>" : "<span class='status-chip ok'>OK</span>";
      return "<tr><td class='mono'>" + esc(s.id) + "</td><td>" + esc(s.src.slice(0, 180)) + "</td><td>" + esc((s.dst || "").slice(0, 200)) + "</td><td>" + st + "</td></tr>";
    }).join("");
    tbody.parentElement.parentElement.scrollTop = tbody.parentElement.parentElement.scrollHeight;
  }

  function stripCodeFences(s) {
    var t = String(s || "").trim();
    var m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
    if (m) return m[1].trim();
    var i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i >= 0 && j > i) return t.slice(i, j + 1);
    return t;
  }

  function u8ToBase64(u8) {
    var chunks = [], step = 0x8000;
    for (var i = 0; i < u8.length; i += step) {
      chunks.push(String.fromCharCode.apply(null, u8.subarray(i, i + step)));
    }
    return btoa(chunks.join(""));
  }

  function buildAndSavePdfs() {
    var outs = $$('input[name="ws-out"]:checked').map(function (c) { return c.value; });
    var footer = !$("#ws-own-doc").checked;
    var steps = ["don-ngu"].concat(outs);
    var builtFiles = {};
    var L_out = STATE.docInfo && STATE.docInfo.huong === "vi-en" ? "_EN.pdf" : "_VI.pdf";

    $("#mon-status-title").textContent = "Đang dựng file PDF vector…";
    logLine("Bắt đầu dựng " + steps.length + " chế độ PDF…");

    return steps.reduce(function (p, mode, idx) {
      return p.then(function () {
        $("#mon-status-title").textContent = "Đang dựng PDF (" + (idx + 1) + "/" + steps.length + ": " + mode + ")…";
        return callWorker("build", mode, footer).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          (r.files || []).forEach(function (f) { builtFiles[f.name] = f; });
        });
      });
    }, Promise.resolve()).then(function () {
      $("#mon-status-title").textContent = "Đang chạy kiểm định chất lượng QA…";
      return callWorker("qa");
    }).then(function (qa) {
      var list = Object.keys(builtFiles).map(function (k) { return builtFiles[k]; })
        .filter(function (f) { return f.name.indexOf(L_out) > 0 || steps.some(function (m) { return m !== "don-ngu" && f.name.indexOf(m) > 0; }); });
      if (qa.report_path) list.push({ name: qa.report_name, path: qa.report_path, size: qa.report_md.length });

      return Promise.all(list.map(function (f) {
        return callWorker("readFile", f.path).then(function (u8) {
          return { name: f.name, base64: u8ToBase64(u8), size: u8.length };
        });
      })).then(function (payloadFiles) {
        var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
        var folderName = STATE.pdfName.replace(/\.pdf$/i, "") + "-" + stamp;
        return api("/api/output/save", { folderName: folderName, files: payloadFiles }).then(function (saved) {
          renderBuildResult(qa, saved);
        });
      });
    });
  }

  function renderBuildResult(qa, saved) {
    $("#res-empty").hidden = true;
    $("#res-content").hidden = false;
    var ban = $("#res-qa-banner");
    ban.className = "qa-banner " + (qa.pass ? "ok" : "bad");
    ban.innerHTML = "<strong>" + (qa.pass ? "✓ Phiếu kiểm định: ĐẠT (0 lỗi cấu trúc)" : "⚠ Phiếu kiểm định: Cần xem lại một số mục") + "</strong>";

    $("#res-dir-card").hidden = false;
    $("#res-dir-path").textContent = saved.dir;
    $("#res-open-dir").onclick = function () {
      if (window.PDF_DESKTOP && window.PDF_DESKTOP.openPath) window.PDF_DESKTOP.openPath(saved.dir);
    };

    $("#res-files-list").innerHTML = (saved.files || []).map(function (f) {
      return "<div class='out-file-card'><div class='out-file-meta'><strong>" + esc(f.name) + "</strong><span>" + fmtSize(f.size) + "</span></div>" +
        "<button class='btn btn-ghost btn-sm' data-open-file='" + esc(f.path) + "' type='button'>Mở file</button></div>";
    }).join("");
    $$("[data-open-file]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (window.PDF_DESKTOP && window.PDF_DESKTOP.openPath) window.PDF_DESKTOP.openPath(b.getAttribute("data-open-file"));
      });
    });

    $("#res-qa-tbody").innerHTML = (qa.checks || []).map(function (c, i) {
      var warnOnly = c.canh_bao !== undefined ? c.canh_bao : i >= 6;
      var cls = c.dat ? "qa-yes" : (warnOnly ? "" : "qa-bad");
      var mark = c.dat ? "✔ Đạt" : (warnOnly ? "⚠ Xem lại" : "✘ Cần sửa");
      return "<tr><td>" + esc(c.muc) + "</td><td class='" + cls + "'>" + mark + "</td><td>" + esc(c.chi_tiet) + "</td></tr>";
    }).join("");

    switchMonTab("results");
    $("#mon-status-title").textContent = "Hoàn tất · đã lưu " + (saved.files || []).length + " file PDF & QA!";
    logLine("Hoàn tất xuất PDF tại: " + saved.dir);
  }

  function runTranslationAndBuild() {
    var engId = $("#ws-engine-select").value;
    var eng = findEngine(engId);
    if (!eng || !eng.installed || !eng.loggedIn) {
      STATE.inspectedId = engId;
      switchView("connectors");
      renderConnectorsGrid();
      renderInspector();
      logLine("Cần kết nối/đăng nhập nền tảng " + (eng ? eng.name : engId) + " trước khi dịch.");
      return;
    }

    var model = $("#ws-model-input").value.trim();
    var chunkChars = Math.max(2000, Math.min(16000, Number($("#ws-chunk").value) || 7000));
    STATE.stop = false;
    STATE.running = true;
    $("#ws-run-btn").disabled = true;
    $("#ws-stop-btn").hidden = false;
    switchMonTab("segments");

    var stuck = 0, lastDone = -1, batchNo = 0;
    function step() {
      if (STATE.stop) {
        STATE.running = false;
        $("#ws-run-btn").disabled = false;
        $("#ws-stop-btn").hidden = true;
        $("#mon-status-title").textContent = "Đã tạm dừng. Bấm Bắt đầu để chạy tiếp.";
        return Promise.resolve();
      }
      return callWorker("nextItems", chunkChars).then(function (r) {
        updateProgressUI(r);
        if (!r.items.length) return buildAndSavePdfs();
        if (r.done === lastDone) stuck++; else stuck = 0;
        lastDone = r.done;
        if (stuck >= 3) throw new Error(eng.name + " nhiều lần không trả JSON đúng định dạng.");

        batchNo++;
        var rules = ((STATE.docInfo && STATE.docInfo.rules) || "").replace("trong cuộc trò chuyện này", "trong toàn bộ tài liệu");
        var rulesEnd = ((STATE.docInfo && STATE.docInfo.rules_end) || "").replace("{n}", r.items.length).replace(/\{\{/g, "{").replace(/\}\}/g, "}");
        var prompt = rules + "\n" + rulesEnd + "\n\n" + r.items.map(function (it) { return JSON.stringify(it); }).join("\n");

        $("#mon-status-title").textContent = "Lô #" + batchNo + ": đang dịch " + r.items.length + " đoạn qua " + eng.name + (model ? " (" + model + ")" : "") + "…";
        logLine("Gửi lô #" + batchNo + " (" + r.items.length + " đoạn) -> " + eng.name);

        return api("/api/cli/translate", { engine: eng.id, model: model, prompt: prompt }).then(function (ans) {
          var cleaned = stripCodeFences(ans.text);
          var parsed = {};
          try { parsed = JSON.parse(cleaned); } catch { /* web_api.load handles repairs */ }
          return callWorker("load", cleaned).then(function (lr) {
            if (!lr.ok) throw new Error(lr.error || "JSON trả về chưa đọc được");
            updateProgressUI(lr);
            appendSegmentRows(r.items, parsed, lr.warnings);
            var wKeys = Object.keys(lr.warnings || {});
            wKeys.forEach(function (k) { if (STATE.warnIds.indexOf(k) < 0) STATE.warnIds.push(k); });
            if (STATE.warnIds.length) {
              $("#ws-warn-bar").hidden = false;
              $("#ws-warn-summary").textContent = STATE.warnIds.length + " đoạn có cảnh báo QA (đã nạp tạm).";
            }
            return step();
          });
        });
      });
    }

    step().catch(function (e) {
      $("#mon-status-title").textContent = "Lỗi: " + e.message;
      logLine("Lỗi dịch: " + e.message);
    }).then(function () {
      STATE.running = false;
      $("#ws-run-btn").disabled = false;
      $("#ws-stop-btn").hidden = true;
    });
  }

  /* ---------------- QA Scorer ---------------- */
  function base64ToArrayBuffer(b64) {
    var bin = atob(b64), len = bin.length, u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  function readFileInput(file) {
    return file.arrayBuffer().then(function (buf) { return { name: file.name, buffer: buf }; });
  }

  function runStandaloneQa() {
    if (!STATE.qaSrcFile || !STATE.qaDstFile) { logLine("Hãy chọn đủ 2 file gốc và dịch để chấm QA."); return; }
    $("#qa-run-btn").disabled = true;
    callWorker("score", STATE.qaSrcFile.buffer.slice(0), STATE.qaDstFile.buffer.slice(0), STATE.qaSrcFile.name, STATE.qaDstFile.name).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      var rows = [
        ["Số trang (dịch/gốc)", r.so_trang, true],
        ["Ký tự lỗi phông (tofu)", r.ky_tu_loi_phong, r.ky_tu_loi_phong === 0],
        ["Liên kết (còn/gốc)", r.lien_ket, true],
        ["Trang mất lớp chữ vector", r.trang_mat_lop_chu, r.trang_mat_lop_chu === 0],
        ["Cặp dòng chồng đè", r.cap_dong_chong_nhau, r.cap_dong_chong_nhau === 0],
        ["Độ trùng bố cục", r.do_trung_bo_cuc === "" ? "N/A" : r.do_trung_bo_cuc, r.do_trung_bo_cuc === "" || r.do_trung_bo_cuc >= 0.7],
      ];
      $("#qa-score-tbody").innerHTML = rows.map(function (x) {
        return "<tr><td>" + esc(x[0]) + "</td><td class='mono'>" + esc(x[1]) + "</td><td class='" + (x[2] ? "qa-yes" : "qa-bad") + "'>" + (x[2] ? "✔ Đạt" : "✘ Cần xem") + "</td></tr>";
      }).join("");
      $("#qa-score-out").hidden = false;
    }).catch(function (e) { logLine("Lỗi chấm QA: " + e.message); })
      .then(function () { $("#qa-run-btn").disabled = false; });
  }

  /* ---------------- Init & Event Wiring ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    $$(".nav-btn").forEach(function (b) { b.addEventListener("click", function () { switchView(b.getAttribute("data-view")); }); });
    $$(".tab-btn").forEach(function (b) { b.addEventListener("click", function () { switchMonTab(b.getAttribute("data-mon-tab")); }); });

    $("#top-connector-btn").addEventListener("click", function () { switchView("connectors"); });
    $("#btn-go-translate").addEventListener("click", function () { switchView("workspace"); });
    $("#ws-change-ai").addEventListener("click", function () {
      STATE.inspectedId = $("#ws-engine-select").value;
      renderConnectorsGrid();
      renderInspector();
      switchView("connectors");
    });

    $("#btn-refresh-engines").addEventListener("click", loadEngines);
    $("#rail-refresh-btn").addEventListener("click", loadEngines);

    $("#pick-output-btn").addEventListener("click", function () {
      if (window.PDF_DESKTOP && window.PDF_DESKTOP.pickFolder) {
        window.PDF_DESKTOP.pickFolder().then(function (r) {
          if (!r.canceled && r.path) {
            api("/api/config", { outputDir: r.path }).then(function (d) { STATE.config = d.config; updateHeaderAndConfigUI(); });
          }
        });
      }
    });
    $("#open-output-root-btn").addEventListener("click", function () {
      if (window.PDF_DESKTOP && window.PDF_DESKTOP.openPath && STATE.config.outputDir) {
        window.PDF_DESKTOP.openPath(STATE.config.outputDir);
      }
    });

    // Inspector actions
    $("#insp-activate").addEventListener("click", function () { setActiveEngine(STATE.inspectedId); });
    $("#insp-save-model").addEventListener("click", function () {
      var patch = { models: {} };
      patch.models[STATE.inspectedId] = $("#insp-model").value.trim();
      api("/api/config", patch).then(function (d) {
        STATE.config = d.config;
        updateHeaderAndConfigUI(); renderRailConnectors(); renderConnectorsGrid();
        logLine("Đã lưu mô hình cho " + STATE.inspectedId);
      });
    });
    $("#insp-save-key").addEventListener("click", function () {
      var eng = findEngine(STATE.inspectedId);
      if (!eng || !eng.envKeyName) return;
      var val = $("#insp-api-key").value.trim();
      if (!val) return;
      var patch = { apiKeys: {} };
      patch.apiKeys[eng.envKeyName] = val;
      api("/api/config", patch).then(function () { loadEngines(); });
    });
    $("#insp-clear-key").addEventListener("click", function () {
      var eng = findEngine(STATE.inspectedId);
      if (!eng || !eng.envKeyName) return;
      var patch = { apiKeys: {} };
      patch.apiKeys[eng.envKeyName] = "";
      api("/api/config", patch).then(function () { loadEngines(); });
    });
    $("#insp-ping").addEventListener("click", function () {
      var box = $("#insp-ping-box");
      var mdl = $("#insp-model").value.trim();
      box.hidden = false; box.className = "ping-box";
      box.textContent = "Đang gửi yêu cầu kiểm tra tới " + STATE.inspectedId + "…";
      api("/api/cli/ping", { engine: STATE.inspectedId, model: mdl }).then(function (r) {
        box.className = "ping-box ok";
        box.textContent = "✓ Kết nối OK (" + r.latencyMs + " ms)\nPhản hồi: " + r.reply;
        logLine("Ping " + STATE.inspectedId + ": OK (" + r.latencyMs + "ms)");
      }).catch(function (e) {
        box.className = "ping-box err";
        box.textContent = "✘ Lỗi: " + e.message;
        logLine("Ping " + STATE.inspectedId + " lỗi: " + e.message);
      });
    });
    $("#insp-login").addEventListener("click", function () {
      api("/api/cli/login", { engine: STATE.inspectedId, mode: "stream" }).then(function (r) {
        if (r.id) startConsolePoll(r.id, "Đăng nhập " + STATE.inspectedId);
        else logLine("Đã mở cửa sổ đăng nhập ngoài cho " + STATE.inspectedId);
      }).catch(function (e) { logLine("Lỗi login: " + e.message); });
    });
    $("#insp-login-term").addEventListener("click", function () {
      api("/api/cli/login", { engine: STATE.inspectedId, mode: "terminal" }).catch(function (e) { logLine("Lỗi mở Terminal: " + e.message); });
    });
    $("#insp-install").addEventListener("click", function () {
      api("/api/cli/install", { engine: STATE.inspectedId, mode: "stream" }).then(function (r) {
        if (r.id) startConsolePoll(r.id, "Cài đặt " + STATE.inspectedId);
      }).catch(function (e) { logLine("Lỗi cài CLI: " + e.message); });
    });
    $("#cli-stdin-send").addEventListener("click", function () {
      var val = $("#cli-stdin-field").value.trim();
      if (!val || !STATE.activeJobId) return;
      api("/api/cli/job/input", { id: STATE.activeJobId, text: val }).then(function () {
        $("#cli-stdin-field").value = "";
        $("#cli-console-input").hidden = true;
      });
    });
    $("#cli-console-stop").addEventListener("click", function () {
      if (STATE.activeJobId) api("/api/cli/job/stop", { id: STATE.activeJobId });
    });

    // Workspace file drop & native picker
    var drop = $("#ws-drop");
    $("#ws-pick-btn").addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (window.PDF_DESKTOP && window.PDF_DESKTOP.pickPdf) {
        window.PDF_DESKTOP.pickPdf(false).then(function (res) {
          if (!res.canceled && res.files[0]) loadPdfBuffer(base64ToArrayBuffer(res.files[0].base64), res.files[0].name);
        });
      } else {
        $("#ws-file-input").click();
      }
    });
    drop.addEventListener("click", function () { $("#ws-pick-btn").click(); });
    $("#ws-file-input").addEventListener("change", function () {
      var f = $("#ws-file-input").files[0];
      if (f) f.arrayBuffer().then(function (b) { loadPdfBuffer(b, f.name); });
    });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer.files[0];
      if (f) f.arrayBuffer().then(function (b) { loadPdfBuffer(b, f.name); });
    });

    $("#ws-engine-select").addEventListener("change", function () {
      setActiveEngine($("#ws-engine-select").value);
      syncWorkspaceModel();
    });
    $("#ws-model-input").addEventListener("change", function () {
      var id = $("#ws-engine-select").value;
      if (!id) return;
      var patch = { models: {} };
      patch.models[id] = $("#ws-model-input").value.trim();
      api("/api/config", patch).then(function (d) { STATE.config = d.config; updateHeaderAndConfigUI(); renderConnectorsGrid(); });
    });
    $("#ws-retry-warn").addEventListener("click", function () {
      if (!STATE.warnIds.length || STATE.running) return;
      var engId = $("#ws-engine-select").value;
      var model = $("#ws-model-input").value.trim();
      callWorker("itemsFor", STATE.warnIds).then(function (items) {
        if (!items.length) return;
        var rules = ((STATE.docInfo && STATE.docInfo.rules) || "").replace("trong cuộc trò chuyện này", "trong toàn bộ tài liệu");
        var rulesEnd = ((STATE.docInfo && STATE.docInfo.rules_end) || "").replace("{n}", items.length).replace(/\{\{/g, "{").replace(/\}\}/g, "}");
        var retryHint = "\n- Đây là lượt sửa cảnh báo: hãy dịch đủ tiếng Việt có dấu (hoặc tiếng Anh đúng chiều), giữ nguyên số liệu/tên riêng.";
        var prompt = rules + retryHint + "\n" + rulesEnd + "\n\n" + items.map(function (it) { return JSON.stringify(it); }).join("\n");
        $("#mon-status-title").textContent = "Đang dịch lại " + items.length + " đoạn cảnh báo…";
        return api("/api/cli/translate", { engine: engId, model: model, prompt: prompt }).then(function (ans) {
          var cleaned = stripCodeFences(ans.text);
          var parsed = {};
          try { parsed = JSON.parse(cleaned); } catch { /* ignore */ }
          return callWorker("load", cleaned).then(function (lr) {
            appendSegmentRows(items, parsed, lr.warnings);
            STATE.warnIds = Object.keys(lr.warnings || {});
            $("#ws-warn-bar").hidden = !STATE.warnIds.length;
            $("#mon-status-title").textContent = "Đã cập nhật lại các đoạn cảnh báo.";
          });
        });
      }).catch(function (e) { logLine("Lỗi dịch lại cảnh báo: " + e.message); });
    });
    $("#ws-run-btn").addEventListener("click", runTranslationAndBuild);
    $("#ws-stop-btn").addEventListener("click", function () { STATE.stop = true; });
    $("#ws-build-only-btn").addEventListener("click", function () { buildAndSavePdfs().catch(function (e) { logLine("Lỗi dựng: " + e.message); }); });
    $$('input[name="ws-dir"]').forEach(function (r) { r.addEventListener("change", function () { if (STATE.pdfBytes) preparePdf(); }); });

    // QA Scorer
    $("#qa-pick-src").addEventListener("click", function () { $("#qa-src-file").click(); });
    $("#qa-pick-dst").addEventListener("click", function () { $("#qa-dst-file").click(); });
    $("#qa-src-file").addEventListener("change", function () {
      var f = $("#qa-src-file").files[0];
      if (f) readFileInput(f).then(function (x) { STATE.qaSrcFile = x; $("#qa-src-name").textContent = x.name; });
    });
    $("#qa-dst-file").addEventListener("change", function () {
      var f = $("#qa-dst-file").files[0];
      if (f) readFileInput(f).then(function (x) { STATE.qaDstFile = x; $("#qa-dst-name").textContent = x.name; });
    });
    $("#qa-run-btn").addEventListener("click", runStandaloneQa);
    $("#logs-clear-btn").addEventListener("click", function () { $("#logs-pre").textContent = ""; });

    // Boot sequence
    loadEngines();
    callWorker("init").catch(function (e) {
      $("#top-engine-label").textContent = "Lỗi bộ máy PDF";
      $("#top-engine-dot").className = "dot";
      logLine("Khởi động Pyodide thất bại: " + e.message);
    });
  });
})();
