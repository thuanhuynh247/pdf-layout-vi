/* desktop/app/app.js — PDF Layout VI Studio v4.0 PRO (Windows Desktop Application) */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var STATE = {
    engines: [],
    config: {
      activeEngine: "codex",
      failoverEngines: ["gemini", "claude", "openrouter", "ollama"],
      chunkChars: 7000,
      outputDir: "",
      theme: "dark",
      tmEnabled: true,
      glossaryPreset: "none",
      glossary: [],
      models: {},
      apiKeys: {},
    },
    glossaryPresets: {},
    tmStats: { count: 0, bytes: 0 },
    history: [],
    queue: [],          // [{ id, name, size, buffer, status: 'pending'|'running'|'done'|'error', detail, outputDir }]
    activeQueueId: null,
    queueRunning: false,
    inspectedId: "codex",
    activeJobId: null,
    jobTimer: null,
    pdfBytes: null,
    pdfName: "",
    docInfo: null,
    segments: [],       // [{ id, src, dst, warn, origin: 'ai'|'tm'|'manual' }]
    segMap: {},
    segFilter: "all",
    segSearch: "",
    warnIds: [],
    running: false,
    stop: false,
    qaSrcFile: null,
    qaDstFile: null,
    pingResults: {},
    batchLatencies: [],
    charsDone: 0,
    startedAt: 0,
    tmSessionHits: 0,
    tmSessionChecked: 0,
    checkpointKey: "",
    previewPage: 1,
    previewTotal: 1,
    hasBuiltOutput: false,
  };

  function H() { return window.PTLHelpers || {}; }

  function redact(s) {
    return H().redactSecrets ? H().redactSecrets(s) : String(s || "");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtSize(n) {
    var v = Number(n || 0);
    return v < 1e6 ? Math.max(1, Math.round(v / 1e3)) + " KB" : (v / 1e6).toFixed(1) + " MB";
  }

  function logLine(msg) {
    var pre = $("#logs-pre");
    if (!pre) return;
    var ts = new Date().toLocaleTimeString("vi-VN", { hour12: false });
    pre.textContent += "[" + ts + "] " + redact(msg) + "\n";
    pre.scrollTop = pre.scrollHeight;
  }

  function notifyDesktop(title, body) {
    if (window.PDF_DESKTOP && window.PDF_DESKTOP.notify) {
      window.PDF_DESKTOP.notify(title, body).catch(function () { /* ignore */ });
    }
  }

  function downloadTextFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
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

  /* ---------------- Theme Management ---------------- */
  function applyTheme(theme) {
    var mode = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", mode);
    if ($("#theme-icon-sun")) $("#theme-icon-sun").hidden = mode === "light";
    if ($("#theme-icon-moon")) $("#theme-icon-moon").hidden = mode !== "light";
    if (window.PDF_DESKTOP && window.PDF_DESKTOP.setTheme) {
      window.PDF_DESKTOP.setTheme(mode).catch(function () { /* ignore */ });
    }
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
    if (name === "history") loadHistory();
    if (name === "logs") refreshTmStats();
  }

  function switchMonTab(tab) {
    $$(".tab-btn").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-mon-tab") === tab); });
    $$(".mon-panel").forEach(function (p) { p.classList.toggle("is-active", p.id === "mon-tab-" + tab); });
    if (tab === "preview" && STATE.pdfBytes) renderPreviewPage();
  }

  /* ---------------- Connectors, Failover & Inspector ---------------- */
  function findEngine(id) {
    return STATE.engines.filter(function (e) { return e.id === id; })[0] || null;
  }

  function currentDomain() {
    var el = $('input[name="ws-domain"]:checked');
    return el && el.value === "y-duoc" ? "y-duoc" : "chung";
  }

  function getActiveGlossaryTerms() {
    var custom = [], fromPreset = [], fromMedical = [];
    // Thuật ngữ tự thêm đứng trước: khi trùng, cách dịch của người dùng thắng bộ mẫu
    (STATE.config.glossary || []).forEach(function (t) {
      custom.push({ src: t.src, dst: t.dst, note: t.note || "", source: "Tùy chỉnh" });
    });
    var preset = STATE.glossaryPresets && STATE.glossaryPresets[STATE.config.glossaryPreset];
    if (preset && Array.isArray(preset.terms)) {
      preset.terms.forEach(function (t) { fromPreset.push({ src: t.src, dst: t.dst, source: preset.name }); });
    }
    var dir = (STATE.docInfo && STATE.docInfo.huong) || ($('input[name="ws-dir"]:checked') || {}).value || "en-vi";
    var medId = currentDomain() === "y-duoc" && H().medicalPresetFor ? H().medicalPresetFor(dir) : "";
    var med = medId && STATE.glossaryPresets && STATE.glossaryPresets[medId];
    if (med && medId !== STATE.config.glossaryPreset) {
      med.terms.forEach(function (t) { fromMedical.push({ src: t.src, dst: t.dst, source: med.name + " (tự bật)" }); });
    }
    return H().mergeGlossary ? H().mergeGlossary([custom, fromPreset, fromMedical]) : custom.concat(fromPreset, fromMedical);
  }

  function applyEdition(ed) {
    if (!ed) return;
    STATE.edition = ed;
    if ($("#brand-name") && ed.name) $("#brand-name").textContent = ed.name;
    if ($("#brand-badge") && ed.badge) $("#brand-badge").textContent = ed.badge;
    if (ed.name) document.title = ed.name + " v4.1";
    var want = ed.defaultDomain === "y-duoc" ? "y-duoc" : "chung";
    var radio = $('input[name="ws-domain"][value="' + want + '"]');
    if (radio && !STATE.pdfBytes) radio.checked = true;
    updateDomainHint();
  }

  function updateDomainHint() {
    if ($("#ws-domain-hint")) $("#ws-domain-hint").hidden = currentDomain() !== "y-duoc";
    if ($("#badge-glossary")) $("#badge-glossary").textContent = String(getActiveGlossaryTerms().length);
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
    if ($("#cfg-tm-enabled")) $("#cfg-tm-enabled").checked = STATE.config.tmEnabled !== false;
    if ($("#ws-tm-pill")) $("#ws-tm-pill").textContent = "TM: " + (STATE.config.tmEnabled !== false ? "Bật (" + (STATE.tmStats.count || 0) + ")" : "Tắt");

    var gTerms = getActiveGlossaryTerms();
    if ($("#badge-glossary")) $("#badge-glossary").textContent = String(gTerms.length);
    if ($("#ws-gloss-pill")) $("#ws-gloss-pill").textContent = "Từ điển: " + gTerms.length + " mục";

    var fo = (STATE.config.failoverEngines || []).filter(function (id) { return id !== STATE.config.activeEngine; });
    var foNames = fo.map(function (id) { var e = findEngine(id); return e ? e.name : id; });
    if ($("#failover-summary")) {
      $("#failover-summary").textContent = foNames.length
        ? "Chuỗi dự phòng: " + foNames.join(" → ")
        : "Chưa chọn nền tảng dự phòng (bấm Cấu hình dự phòng để bật Auto-Failover).";
    }
    if ($("#vault-failover-count")) $("#vault-failover-count").textContent = String(foNames.length);
    if ($("#vault-failover-list")) $("#vault-failover-list").textContent = foNames.join(" → ") || "Chưa cấu hình";
    applyTheme(STATE.config.theme);
  }

  function renderFailoverChips() {
    var wrap = $("#failover-chips");
    if (!wrap) return;
    var selected = STATE.config.failoverEngines || [];
    wrap.innerHTML = STATE.engines.map(function (e) {
      var on = selected.indexOf(e.id) >= 0;
      return "<label class='fo-chip" + (on ? " is-on" : "") + "'>" +
        "<input type='checkbox' data-fo-id='" + esc(e.id) + "'" + (on ? " checked" : "") + ">" +
        "<span>" + esc(e.name) + (e.installed && e.loggedIn ? " ✓" : "") + "</span></label>";
    }).join("");
    $$("[data-fo-id]").forEach(function (chk) {
      chk.addEventListener("change", function () {
        chk.parentElement.classList.toggle("is-on", chk.checked);
      });
    });
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
      var ping = STATE.pingResults[e.id];
      var pingHtml = ping
        ? "<span class='conn-ping-tag " + esc(ping.status) + "'>" + esc(ping.label) + "</span>"
        : "";
      return "<div class='conn-card" + (isInsp ? " is-inspected" : "") + (isActive ? " is-active-engine" : "") + "' data-card-eng='" + esc(e.id) + "'>" +
        "<div class='conn-card-top'><div><div class='conn-name'>" + esc(e.name) + "</div><div class='conn-vendor'>" + esc(e.vendor) + "</div></div>" +
        pingHtml + "<span class='status-chip " + chipCls + "'>" + chipTxt + "</span></div>" +
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

  function pingAllReady() {
    var readyEngines = STATE.engines.filter(function (e) { return e.installed && e.loggedIn; });
    if (!readyEngines.length) {
      logLine("Chưa có nền tảng AI nào sẵn sàng để ping.");
      return;
    }
    var btn = $("#btn-ping-all");
    if (btn) btn.disabled = true;
    readyEngines.forEach(function (e) { STATE.pingResults[e.id] = { status: "busy", label: "Đang ping…" }; });
    renderConnectorsGrid();

    Promise.all(readyEngines.map(function (e) {
      var mdl = (STATE.config.models && STATE.config.models[e.id]) || "";
      return api("/api/cli/ping", { engine: e.id, model: mdl }).then(function (r) {
        STATE.pingResults[e.id] = { status: "ok", label: "✓ " + (r.latencyMs / 1000).toFixed(1) + "s" };
        logLine("Ping " + e.name + ": OK (" + r.latencyMs + " ms)");
      }).catch(function (err) {
        STATE.pingResults[e.id] = { status: "fail", label: "✘ Lỗi" };
        logLine("Ping " + e.name + " lỗi: " + err.message);
      }).then(function () {
        renderConnectorsGrid();
      });
    })).then(function () {
      if (btn) btn.disabled = false;
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

  function refreshTmStats() {
    return api("/api/tm/stats").then(function (d) {
      STATE.tmStats = d.stats || { count: 0, bytes: 0 };
      if ($("#tm-count-pill")) $("#tm-count-pill").textContent = String(STATE.tmStats.count || 0);
      if ($("#vault-tm-count")) $("#vault-tm-count").textContent = Number(STATE.tmStats.count || 0).toLocaleString("vi-VN");
      if ($("#vault-tm-size")) $("#vault-tm-size").textContent = fmtSize(STATE.tmStats.bytes || 0) + " trên đĩa";
      updateHeaderAndConfigUI();
    }).catch(function () { /* ignore */ });
  }

  function loadEngines() {
    return api("/api/cli/engines").then(function (d) {
      STATE.engines = d.engines || [];
      if (d.config) STATE.config = d.config;
      if (d.tm) STATE.tmStats = d.tm;
      if (!findEngine(STATE.config.activeEngine)) {
        var firstReady = STATE.engines.filter(function (e) { return e.installed && e.loggedIn; })[0];
        STATE.config.activeEngine = (firstReady && firstReady.id) || (STATE.engines[0] && STATE.engines[0].id) || "codex";
      }
      if (!findEngine(STATE.inspectedId)) STATE.inspectedId = STATE.config.activeEngine;
      if ($("#tm-count-pill")) $("#tm-count-pill").textContent = String(STATE.tmStats.count || 0);
      updateHeaderAndConfigUI();
      renderRailConnectors();
      renderConnectorsGrid();
      renderInspector();
      renderFailoverChips();
      renderGlossaryView();
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
        $("#cli-console-log").textContent = redact(j.output || "(đang chờ phản hồi…)");
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

  /* ---------------- Multi-PDF Batch Queue ---------------- */
  function renderQueueTable() {
    var count = STATE.queue.length;
    if ($("#tab-queue-count")) $("#tab-queue-count").textContent = String(count);
    var badge = $("#badge-queue");
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = String(count);
    }
    var pendingCount = STATE.queue.filter(function (q) { return q.status === "pending" || q.status === "error"; }).length;
    if ($("#q-run-all")) $("#q-run-all").disabled = pendingCount === 0 || STATE.running || STATE.queueRunning;

    var tbody = $("#queue-tbody");
    if (!tbody) return;
    if (!count) {
      tbody.innerHTML = "<tr><td colspan='4' class='empty-cell'>Chưa có tệp nào trong hàng đợi. Bấm \"+ Thêm nhiều PDF\" ở cột trái.</td></tr>";
      return;
    }
    tbody.innerHTML = STATE.queue.map(function (q, idx) {
      var cls = q.status === "done" ? "ok" : q.status === "running" ? "tm" : q.status === "error" ? "warn" : "off";
      var label = q.status === "done" ? "✔ Hoàn tất" : q.status === "running" ? "Đang xử lý…" : q.status === "error" ? "✘ Lỗi" : "Đang chờ";
      var isCur = STATE.activeQueueId === q.id;
      return "<tr><td><strong>" + (isCur ? "▶ " : "") + esc(q.name) + "</strong>" + (q.detail ? "<div class='hint'>" + esc(q.detail) + "</div>" : "") + "</td>" +
        "<td class='mono'>" + fmtSize(q.size) + "</td>" +
        "<td><span class='status-chip " + cls + "'>" + label + "</span></td>" +
        "<td><div style='display:flex;gap:4px'>" +
        "<button class='btn-xs' data-q-load='" + esc(q.id) + "' type='button'>Nạp</button>" +
        (idx > 0 ? "<button class='btn-xs' data-q-up='" + esc(q.id) + "' type='button' title='Đưa lên'>↑</button>" : "") +
        (q.outputDir ? "<button class='btn-xs' data-q-open='" + esc(q.outputDir) + "' type='button'>Mở</button>" : "") +
        "<button class='btn-xs' data-q-del='" + esc(q.id) + "' type='button'>Xóa</button>" +
        "</div></td></tr>";
    }).join("");

    $$("[data-q-load]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (STATE.running) return;
        var item = STATE.queue.filter(function (x) { return x.id === b.getAttribute("data-q-load"); })[0];
        if (item) {
          STATE.activeQueueId = item.id;
          loadPdfBuffer(item.buffer, item.name);
          renderQueueTable();
        }
      });
    });
    $$("[data-q-up]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-q-up");
        var i = STATE.queue.findIndex(function (x) { return x.id === id; });
        if (i > 0) {
          var tmp = STATE.queue[i - 1];
          STATE.queue[i - 1] = STATE.queue[i];
          STATE.queue[i] = tmp;
          renderQueueTable();
        }
      });
    });
    $$("[data-q-open]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (window.PDF_DESKTOP && window.PDF_DESKTOP.openPath) window.PDF_DESKTOP.openPath(b.getAttribute("data-q-open"));
      });
    });
    $$("[data-q-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-q-del");
        STATE.queue = STATE.queue.filter(function (x) { return x.id !== id; });
        renderQueueTable();
      });
    });
  }

  function enqueueFiles(fileEntries) {
    if (!fileEntries || !fileEntries.length) return;
    var firstNew = null;
    fileEntries.forEach(function (f) {
      var item = {
        id: "q-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        name: f.name,
        size: f.buffer.byteLength,
        buffer: f.buffer,
        status: "pending",
        detail: "",
        outputDir: "",
      };
      if (!firstNew) firstNew = item;
      STATE.queue.push(item);
    });
    renderQueueTable();
    if (fileEntries.length > 1) {
      logLine("Đã thêm " + fileEntries.length + " tệp PDF vào hàng đợi hàng loạt.");
      if (!STATE.pdfBytes && firstNew) {
        STATE.activeQueueId = firstNew.id;
        loadPdfBuffer(firstNew.buffer, firstNew.name);
      }
      switchMonTab("queue");
    } else if (firstNew) {
      STATE.activeQueueId = firstNew.id;
      loadPdfBuffer(firstNew.buffer, firstNew.name);
      renderQueueTable();
    }
  }

  function runBatchQueue() {
    if (STATE.running || STATE.queueRunning) return;
    var pending = STATE.queue.filter(function (q) { return q.status === "pending" || q.status === "error"; });
    if (!pending.length) return;
    STATE.queueRunning = true;
    STATE.stop = false;
    renderQueueTable();

    var doneCount = 0;
    function nextJob(idx) {
      if (STATE.stop || idx >= pending.length) {
        STATE.queueRunning = false;
        renderQueueTable();
        logLine("Hàng đợi hoàn tất: đã xử lý " + doneCount + "/" + pending.length + " tệp PDF.");
        notifyDesktop("PDF Layout VI Studio", "Đã hoàn tất hàng đợi " + doneCount + "/" + pending.length + " tài liệu PDF!");
        return Promise.resolve();
      }
      var item = pending[idx];
      item.status = "running";
      item.detail = "Đang phân tích & dịch…";
      STATE.activeQueueId = item.id;
      renderQueueTable();
      return loadPdfBuffer(item.buffer, item.name).then(function () {
        return runTranslationAndBuild(true);
      }).then(function (saved) {
        item.status = "done";
        item.outputDir = saved && saved.dir ? saved.dir : "";
        item.detail = saved ? ("Đã xuất " + (saved.files || []).length + " tệp") : "Hoàn tất";
        doneCount++;
        renderQueueTable();
        return nextJob(idx + 1);
      }).catch(function (err) {
        item.status = "error";
        item.detail = err && err.message ? err.message : String(err);
        renderQueueTable();
        return nextJob(idx + 1);
      });
    }
    nextJob(0);
  }

  /* ---------------- Checkpoints, Telemetry & PDF Workspace ---------------- */
  function checkpointStorageKey(name, bytesLen, pages, huong) {
    return "ptl_ckpt_v1:" + [name || "", bytesLen || 0, pages || "", huong || "tu-dong"].join("|");
  }

  function loadCheckpointMap(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch { return null; }
  }

  function saveStudioCheckpoint(translatedObj) {
    if (!STATE.checkpointKey || !translatedObj || typeof translatedObj !== "object") return;
    try {
      var cur = loadCheckpointMap(STATE.checkpointKey) || {};
      Object.keys(translatedObj).forEach(function (k) {
        if (translatedObj[k]) cur[k] = translatedObj[k];
      });
      localStorage.setItem(STATE.checkpointKey, JSON.stringify(cur));
    } catch { /* ignore quota */ }
  }

  function updateBentoKpis(done, total, warnCount) {
    var d = Number(done || 0), t = Number(total || 0);
    var pct = t > 0 ? Math.round((100 * d) / t) : 0;
    if ($("#kpi-seg")) $("#kpi-seg").textContent = d.toLocaleString("vi-VN") + " / " + t.toLocaleString("vi-VN");
    if ($("#kpi-seg-sub")) $("#kpi-seg-sub").textContent = pct + "% hoàn tất";

    var tmPct = STATE.tmSessionChecked > 0 ? Math.round((100 * STATE.tmSessionHits) / STATE.tmSessionChecked) : 0;
    if ($("#kpi-tm")) $("#kpi-tm").textContent = tmPct + "%";
    if ($("#kpi-tm-sub")) $("#kpi-tm-sub").textContent = STATE.tmSessionHits + " đoạn khớp 0ms";

    var lats = STATE.batchLatencies || [];
    if (STATE.startedAt && STATE.charsDone > 0 && $("#kpi-speed")) {
      var elapsedSec = Math.max(0.5, (Date.now() - STATE.startedAt) / 1000);
      var cps = Math.round(STATE.charsDone / elapsedSec);
      var avgStr = lats.length ? (" · TB " + ((lats.reduce(function (a, b) { return a + b; }, 0) / lats.length) / 1000).toFixed(1) + "s/lô") : "";
      $("#kpi-speed").textContent = cps.toLocaleString("vi-VN") + " c/s";
      $("#kpi-latency-sub").textContent = STATE.charsDone.toLocaleString("vi-VN") + " ký tự" + avgStr;
    } else if ($("#kpi-speed")) {
      $("#kpi-speed").textContent = "—";
      $("#kpi-latency-sub").textContent = "chưa chạy lô nào";
    }

    if (lats.length) {
      var chartEl = $("#ws-latency-chart");
      if (chartEl && H().buildBatchLatencySvg) {
        var svg = H().buildBatchLatencySvg(lats);
        if (svg) { chartEl.innerHTML = svg; chartEl.hidden = false; }
      }
    } else if ($("#ws-latency-chart")) {
      $("#ws-latency-chart").hidden = true;
      $("#ws-latency-chart").innerHTML = "";
    }

    var wc = typeof warnCount === "number" ? warnCount : STATE.warnIds.length;
    if ($("#kpi-warn")) $("#kpi-warn").textContent = String(wc);
    if ($("#kpi-warn-sub")) $("#kpi-warn-sub").textContent = wc === 0 ? "sạch cảnh báo" : "đoạn cần kiểm tra";
  }

  function loadPdfBuffer(arrayBuffer, fileName) {
    STATE.pdfBytes = arrayBuffer;
    STATE.pdfName = fileName;
    STATE.segments = [];
    STATE.segMap = {};
    STATE.warnIds = [];
    STATE.batchLatencies = [];
    STATE.charsDone = 0;
    STATE.startedAt = 0;
    STATE.tmSessionHits = 0;
    STATE.tmSessionChecked = 0;
    STATE.previewPage = 1;
    STATE.previewTotal = 1;
    STATE.hasBuiltOutput = false;
    $("#ws-file-name").textContent = fileName;
    $("#ws-file-sub").textContent = fmtSize(arrayBuffer.byteLength) + " · Đang phân tích cấu trúc…";
    $("#mon-status-title").textContent = "Đang khởi động bộ máy PDF & phân tích trang…";
    $("#seg-tbody").innerHTML = "<tr><td colspan='4' class='empty-cell'>Đang bóc tách khung chữ từ PDF…</td></tr>";
    $("#res-empty").hidden = false;
    $("#res-content").hidden = true;
    $("#ws-warn-bar").hidden = true;
    $("#pv-empty").hidden = false;
    $("#pv-side-grid").hidden = true;
    $("#pv-curtain-wrap").hidden = true;
    updateBentoKpis(0, 0, 0);
    switchMonTab("segments");
    STATE.autoDir = true; // file mới: để bộ máy tự nhận Anh, Pháp hay Việt; người dùng đổi chiều sau thì theo lựa chọn
    return preparePdf();
  }

  function preparePdf() {
    if (!STATE.pdfBytes) return Promise.resolve();
    var huongEl = $('input[name="ws-dir"]:checked');
    var huong = STATE.autoDir ? "tu-dong" : (huongEl ? huongEl.value : "tu-dong");
    STATE.autoDir = false;
    var pages = $("#ws-pages").value.trim();
    var copy = STATE.pdfBytes.slice(0);
    logLine("Phân tích PDF: " + STATE.pdfName + (pages ? " (trang " + pages + ")" : ""));
    var linhVuc = currentDomain();
    return callWorker("prepare", copy, STATE.pdfName, 15, pages, huong, linhVuc).then(function (r) {
      if (!r.ok) throw new Error(r.error || r.message || "Không đọc được file PDF.");
      STATE.docInfo = r;
      var summary = H().mapPrepareSummary ? H().mapPrepareSummary(r, STATE.pdfBytes.byteLength) : {
        pages: r.pages || 0, totalSegments: r.total || 0, words: r.words || 0,
        batchesTotal: r.batches_total || 0, scannedPages: r.scanned || [], huong: r.huong || "en-vi",
      };
      STATE.docInfo.summary = summary;
      STATE.previewTotal = Math.max(1, summary.pages || 1);
      STATE.previewPage = 1;
      $("#pv-page-label").textContent = "Trang 1 / " + STATE.previewTotal;
      STATE.checkpointKey = checkpointStorageKey(STATE.pdfName, STATE.pdfBytes.byteLength, pages, summary.huong + (summary.linhVuc === "y-duoc" ? "+y-duoc" : ""));

      $("#ws-file-sub").textContent = fmtSize(STATE.pdfBytes.byteLength) + " · Sẵn sàng dịch";
      $("#ws-doc-meta").hidden = false;
      $("#meta-pages").textContent = String(summary.pages);
      $("#meta-items").textContent = summary.totalSegments.toLocaleString("vi-VN") + " đoạn · " + summary.words.toLocaleString("vi-VN") + " từ";
      $("#meta-batches").textContent = String(summary.batchesTotal) + " lô";
      $("#meta-dir").textContent = (H().directionLabel ? H().directionLabel(summary.huong) : summary.huong) + (summary.linhVuc === "y-duoc" ? " · Y Dược" : "");
      var dirRadio = $('input[name="ws-dir"][value="' + summary.huong + '"]');
      if (dirRadio) dirRadio.checked = true;
      updateDomainHint();

      if (summary.scannedPages && summary.scannedPages.length) {
        $("#ws-scan-warn").hidden = false;
        $("#ws-scan-warn").textContent = "Cảnh báo: phát hiện " + summary.scannedPages.length + " trang dạng ảnh scan (không có lớp chữ vector).";
      } else {
        $("#ws-scan-warn").hidden = true;
      }

      $("#ws-run-btn").disabled = false;
      $("#ws-build-only-btn").disabled = false;
      updateProgressUI({ done: 0, total: summary.totalSegments, batches_done: 0, batches_total: summary.batchesTotal });
      updateBentoKpis(0, summary.totalSegments, 0);

      var savedCkpt = loadCheckpointMap(STATE.checkpointKey);
      var ckptKeys = savedCkpt ? Object.keys(savedCkpt) : [];
      if (ckptKeys.length > 0) {
        return callWorker("load", JSON.stringify(savedCkpt)).then(function (lr) {
          if (lr && lr.ok) {
            updateProgressUI(lr);
            STATE.warnIds = Object.keys(lr.warnings || {});
            updateBentoKpis(lr.done || 0, lr.total || summary.totalSegments, STATE.warnIds.length);
            var previewRows = ckptKeys.slice(0, 200).map(function (id) { return { id: id, text: "(đã nạp từ checkpoint phiên trước)" }; });
            appendSegmentRows(previewRows, savedCkpt, lr.warnings, "tm");
            $("#mon-status-title").textContent = "Đã khôi phục " + (lr.done || 0) + "/" + summary.totalSegments + " đoạn từ checkpoint · bấm Bắt đầu để dịch tiếp";
            logLine("Khôi phục checkpoint: " + (lr.done || 0) + "/" + summary.totalSegments + " đoạn.");
          }
        }).catch(function () {
          $("#mon-status-title").textContent = "Đã sẵn sàng · bấm \"Bắt đầu dịch & dựng PDF\"";
        });
      }

      $("#mon-status-title").textContent = "Đã sẵn sàng · bấm \"Bắt đầu dịch & dựng PDF\"";
      $("#seg-tbody").innerHTML = "<tr><td colspan='4' class='empty-cell'>Đã bóc tách " + summary.totalSegments.toLocaleString("vi-VN") + " đoạn (" + summary.words.toLocaleString("vi-VN") + " từ). Bấm Bắt đầu để AI dịch từng lô.</td></tr>";
      logLine("Phân tích xong: " + summary.pages + " trang, " + summary.totalSegments + " đoạn, " + summary.batchesTotal + " lô.");
    }).catch(function (e) {
      $("#mon-status-title").textContent = "Lỗi phân tích PDF: " + e.message;
      logLine("Lỗi prepare PDF: " + e.message);
      throw e;
    });
  }

  function updateProgressUI(p) {
    if (!p || !p.total) return;
    var pct = Math.round((100 * p.done) / p.total);
    $("#mon-progress-bar").style.width = pct + "%";
    $("#mon-progress-nums").textContent = p.done.toLocaleString("vi-VN") + "/" + p.total.toLocaleString("vi-VN") + " đoạn · " + pct + "% (lô " + (p.batches_done || 0) + "/" + (p.batches_total || 0) + ")";
  }

  /* ---------------- Inline Segment Editor & Filter ---------------- */
  function renderSegmentsTable() {
    var tbody = $("#seg-tbody");
    if (!tbody) return;
    if (!STATE.segments.length) {
      tbody.innerHTML = "<tr><td colspan='4' class='empty-cell'>Chưa có đoạn văn bản nào được nạp.</td></tr>";
      return;
    }
    var q = (STATE.segSearch || "").trim().toLowerCase();
    var filter = STATE.segFilter || "all";
    var filtered = STATE.segments.filter(function (s) {
      if (filter === "warn" && !s.warn) return false;
      if (filter === "tm" && s.origin !== "tm") return false;
      if (filter === "manual" && s.origin !== "manual") return false;
      if (q) {
        var hay = (s.id + " " + s.src + " " + s.dst).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (!filtered.length) {
      tbody.innerHTML = "<tr><td colspan='4' class='empty-cell'>Không có đoạn nào khớp bộ lọc hiện tại.</td></tr>";
      return;
    }
    var slice = filtered.slice(-220);
    tbody.innerHTML = slice.map(function (s) {
      var st = s.warn
        ? "<span class='status-chip warn'>" + esc(s.warn) + "</span>"
        : s.origin === "tm"
          ? "<span class='status-chip tm'>TM 0ms</span>"
          : s.origin === "manual"
            ? "<span class='status-chip ok'>Sửa tay</span>"
            : "<span class='status-chip ok'>OK</span>";
      return "<tr>" +
        "<td class='mono'>" + esc(s.id) + "</td>" +
        "<td>" + esc(s.src.slice(0, 220)) + "</td>" +
        "<td><div class='seg-edit-cell' contenteditable='true' data-edit-seg-id='" + esc(s.id) + "' title='Bấm để chỉnh sửa trực tiếp rồi nhấn ra ngoài để lưu'>" + esc(s.dst || "") + "</div></td>" +
        "<td>" + st + "</td></tr>";
    }).join("");

    $$("[data-edit-seg-id]").forEach(function (cell) {
      cell.addEventListener("blur", function () {
        var id = cell.getAttribute("data-edit-seg-id");
        var idx = STATE.segMap[id];
        if (idx === undefined) return;
        var seg = STATE.segments[idx];
        var nextText = cell.textContent.trim();
        if (!nextText || nextText === seg.dst) return;
        seg.dst = nextText;
        seg.origin = "manual";
        seg.warn = "";
        STATE.warnIds = STATE.warnIds.filter(function (w) { return w !== id; });
        var patch = {};
        patch[id] = nextText;
        saveStudioCheckpoint(patch);
        callWorker("load", JSON.stringify(patch)).then(function (lr) {
          if (STATE.config.tmEnabled && seg.src && seg.src.indexOf("(đã nạp") !== 0) {
            var dir = (STATE.docInfo && STATE.docInfo.huong) || "en-vi";
            api("/api/tm/save", { pairs: [{ src: seg.src, dst: nextText }], dir: dir, engine: "manual" }).catch(function () { /* ignore */ });
          }
          updateBentoKpis(lr.done, lr.total, STATE.warnIds.length);
          renderSegmentsTable();
          logLine("Đã lưu chỉnh sửa tay cho đoạn " + id + " (bấm \"Dựng lại PDF tức thì\" để xuất bản mới).");
        }).catch(function (e) { logLine("Lỗi cập nhật đoạn " + id + ": " + e.message); });
      });
    });
  }

  function appendSegmentRows(items, translatedObj, warnings, origin) {
    items.forEach(function (it) {
      var dst = translatedObj[it.id] || "";
      var w = warnings && warnings[it.id] ? warnings[it.id].warning : "";
      if (STATE.segMap[it.id] !== undefined) {
        var idx = STATE.segMap[it.id];
        STATE.segments[idx] = { id: it.id, src: it.text, dst: dst, warn: w, origin: origin || "ai" };
      } else {
        STATE.segMap[it.id] = STATE.segments.length;
        STATE.segments.push({ id: it.id, src: it.text, dst: dst, warn: w, origin: origin || "ai" });
      }
    });
    renderSegmentsTable();
    var wrap = $("#mon-tab-segments .table-wrap");
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  /* ---------------- Visual Offline PDF Page Comparator ---------------- */
  function updateCurtainSlider(pct) {
    var v = Math.max(0, Math.min(100, Number(pct) || 50));
    if ($("#pv-curtain-overlay")) $("#pv-curtain-overlay").style.clipPath = "inset(0 " + (100 - v) + "% 0 0)";
    if ($("#pv-curtain-divider")) $("#pv-curtain-divider").style.left = v + "%";
  }

  function renderPreviewPage() {
    if (!STATE.pdfBytes) return;
    var page = Math.max(1, Math.min(STATE.previewTotal, STATE.previewPage));
    var zoom = Number($("#pv-zoom").value) || 1.25;
    var mode = $("#pv-mode").value || "side";
    var target = $("#pv-target").value || "dst";
    $("#pv-page-label").textContent = "Đang tải trang " + page + "…";

    Promise.all([
      callWorker("renderPage", "src", page, zoom),
      callWorker("renderPage", target, page, zoom).catch(function () { return { ok: false }; }),
    ]).then(function (pair) {
      var src = pair[0], dst = pair[1];
      if (!src || !src.ok) throw new Error((src && src.error) || "Không render được trang gốc.");
      STATE.previewTotal = src.pages || STATE.previewTotal;
      STATE.previewPage = src.page || page;
      $("#pv-page-label").textContent = "Trang " + STATE.previewPage + " / " + STATE.previewTotal;
      var srcUrl = "data:image/png;base64," + src.png_base64;
      var dstUrl = (dst && dst.ok) ? ("data:image/png;base64," + dst.png_base64) : srcUrl;

      $("#pv-empty").hidden = true;
      if (mode === "slider" && dst && dst.ok) {
        $("#pv-side-grid").hidden = true;
        $("#pv-curtain-wrap").hidden = false;
        $("#pv-curtain-src").src = srcUrl;
        $("#pv-curtain-dst").src = dstUrl;
        updateCurtainSlider($("#pv-slider-range").value);
      } else {
        $("#pv-curtain-wrap").hidden = true;
        $("#pv-side-grid").hidden = false;
        $("#pv-img-src").src = srcUrl;
        $("#pv-img-dst").src = dstUrl;
        $("#pv-dst-caption").textContent = (dst && dst.ok)
          ? ("Bản đã dịch: " + dst.file)
          : "Chưa dựng bản dịch (đang hiển thị tạm trang gốc)";
      }
    }).catch(function (e) {
      $("#pv-page-label").textContent = "Trang " + STATE.previewPage + " / " + STATE.previewTotal;
      logLine("Lỗi render xem trước PDF: " + e.message);
    });
  }

  /* ---------------- Translation Engine (TM + Glossary + Auto-Failover) ---------------- */
  function stripCodeFences(s) {
    return H().extractJsonText ? H().extractJsonText(s) : String(s || "").trim();
  }

  function translateSingleEngineWithRetry(engineId, model, prompt, maxRetries) {
    var attempt = 0;
    var limit = typeof maxRetries === "number" ? maxRetries : 2;
    function runOnce() {
      var t0 = Date.now();
      return api("/api/cli/translate", { engine: engineId, model: model, prompt: prompt }).then(function (ans) {
        if (!ans || !String(ans.text || "").trim()) throw new Error("CLI trả về phản hồi rỗng.");
        return { text: ans.text, latencyMs: Date.now() - t0, engineId: engineId };
      }).catch(function (err) {
        if (STATE.stop || attempt >= limit) throw err;
        attempt++;
        var waitMs = attempt === 1 ? 800 : 1800;
        logLine("Thử lại " + engineId + " lần " + attempt + "/" + limit + " sau " + waitMs + "ms (" + err.message + ")");
        return new Promise(function (resolve) { setTimeout(resolve, waitMs); }).then(runOnce);
      });
    }
    return runOnce();
  }

  function translateWithFailover(primaryId, primaryModel, prompt) {
    var tried = [];
    function attemptEngine(engId, mdl) {
      tried.push(engId);
      return translateSingleEngineWithRetry(engId, mdl, prompt, 1).catch(function (err) {
        if (STATE.stop) throw err;
        var nextEng = H().pickFailoverEngine
          ? H().pickFailoverEngine(engId, STATE.config.failoverEngines, STATE.engines, tried)
          : null;
        if (!nextEng) throw err;
        var nextModel = (STATE.config.models && STATE.config.models[nextEng.id]) || "";
        logLine("⚡ Auto-Failover: " + engId + " gặp lỗi (" + err.message + ") → tự chuyển sang " + nextEng.name);
        $("#mon-status-title").textContent = "Auto-Failover → đang dịch tiếp bằng " + nextEng.name + "…";
        return attemptEngine(nextEng.id, nextModel);
      });
    }
    return attemptEngine(primaryId, primaryModel);
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
          STATE.hasBuiltOutput = true;
          renderBuildResult(qa, saved);
          recordHistory(qa, saved);
          return saved;
        });
      });
    });
  }

  function recordHistory(qa, saved) {
    var checks = qa.checks || [];
    var passed = checks.filter(function (c) { return !!c.dat; }).length;
    var summary = (STATE.docInfo && STATE.docInfo.summary) || {};
    var tmPct = STATE.tmSessionChecked > 0 ? Math.round((100 * STATE.tmSessionHits) / STATE.tmSessionChecked) : 0;
    api("/api/history", {
      pdfName: STATE.pdfName,
      huong: summary.huong || "en-vi",
      pages: summary.pages || 0,
      segments: summary.totalSegments || STATE.segments.length,
      words: summary.words || 0,
      engine: $("#ws-engine-select").value || STATE.config.activeEngine,
      model: $("#ws-model-input").value.trim(),
      tmHitPct: tmPct,
      qaPass: Boolean(qa.pass),
      qaPassedCount: passed,
      qaTotalCount: checks.length,
      outputDir: saved.dir || "",
      files: saved.files || [],
    }).then(function () {
      loadHistory();
    }).catch(function () { /* ignore */ });
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

    var qaChartEl = $("#res-lieflat-chart");
    if (qaChartEl && H().buildLieFlatMetricsSvg && qa.checks && qa.checks.length) {
      var totalChecks = qa.checks.length;
      var passedChecks = qa.checks.filter(function (c) { return !!c.dat; }).length;
      var hardChecks = qa.checks.filter(function (c, idx) { return !(c.canh_bao !== undefined ? c.canh_bao : idx >= 6); });
      var hardPassed = hardChecks.filter(function (c) { return !!c.dat; }).length;
      var warnCleanPct = totalChecks ? Math.round((100 * passedChecks) / totalChecks) : 100;
      var hardPct = hardChecks.length ? Math.round((100 * hardPassed) / hardChecks.length) : 100;
      var segDone = STATE.segments.length;
      var warnSegs = STATE.warnIds.length;
      var segCleanPct = segDone > 0 ? Math.max(0, Math.round((100 * (segDone - warnSegs)) / segDone)) : 100;
      qaChartEl.innerHTML = H().buildLieFlatMetricsSvg("Tỷ lệ Đạt kiểm định PDF (LieFlat 0–100%)", [
        { label: "Cấu trúc bắt buộc", pct: hardPct, valueText: hardPassed + "/" + hardChecks.length + " đạt", color: hardPct === 100 ? "#22c55e" : "#f43f5e" },
        { label: "Tổng 8 tiêu chí QA", pct: warnCleanPct, valueText: passedChecks + "/" + totalChecks + " mục", color: "#14b8a6" },
        { label: "Đoạn văn sạch cảnh báo", pct: segCleanPct, valueText: segCleanPct + "%", color: "#38bdf8" },
      ]);
      qaChartEl.hidden = false;
    }

    switchMonTab("results");
    $("#mon-status-title").textContent = "Hoàn tất · đã lưu " + (saved.files || []).length + " file PDF & QA!";
    logLine("Hoàn tất xuất PDF tại: " + saved.dir);
    if (!STATE.queueRunning) {
      notifyDesktop("Đã dịch xong: " + STATE.pdfName, "Xuất thành công " + (saved.files || []).length + " tệp PDF & phiếu QA.");
    }
  }

  function runTranslationAndBuild(fromQueue) {
    var engId = $("#ws-engine-select").value;
    var eng = findEngine(engId);
    if (!eng || !eng.installed || !eng.loggedIn) {
      var fallback = H().pickFailoverEngine ? H().pickFailoverEngine("", STATE.config.failoverEngines, STATE.engines, []) : null;
      if (fallback) {
        eng = fallback;
        engId = fallback.id;
        logLine("Nền tảng chính chưa sẵn sàng → tự dùng dự phòng " + eng.name);
      } else {
        STATE.inspectedId = engId;
        switchView("connectors");
        renderConnectorsGrid();
        renderInspector();
        logLine("Cần kết nối/đăng nhập nền tảng " + (eng ? eng.name : engId) + " trước khi dịch.");
        return Promise.reject(new Error("Chưa có nền tảng AI sẵn sàng."));
      }
    }

    var model = $("#ws-model-input").value.trim();
    var chunkChars = Math.max(2000, Math.min(16000, Number($("#ws-chunk").value) || 7000));
    var dir = (STATE.docInfo && STATE.docInfo.huong) || "en-vi";
    var glossaryBlock = H().buildGlossaryPromptBlock ? H().buildGlossaryPromptBlock(getActiveGlossaryTerms(), dir) : "";

    STATE.stop = false;
    STATE.running = true;
    if (!STATE.startedAt) STATE.startedAt = Date.now();
    $("#ws-run-btn").disabled = true;
    $("#ws-stop-btn").hidden = false;
    switchMonTab("segments");

    var stuck = 0, lastDone = -1, batchNo = 0;
    function step() {
      if (STATE.stop) {
        $("#mon-status-title").textContent = "Đã tạm dừng (đã lưu checkpoint). Bấm Bắt đầu để chạy tiếp.";
        return Promise.resolve(null);
      }
      return callWorker("nextItems", chunkChars).then(function (r) {
        updateProgressUI(r);
        updateBentoKpis(r.done, r.total, STATE.warnIds.length);
        if (!r.items.length) return buildAndSavePdfs();
        if (r.done === lastDone) stuck++; else stuck = 0;
        lastDone = r.done;
        if (stuck >= 3) throw new Error(eng.name + " nhiều lần không trả JSON đúng định dạng.");

        // Step A: Local Translation Memory (0ms lookup)
        var tmPromise = (STATE.config.tmEnabled !== false)
          ? api("/api/tm/lookup", { items: r.items, dir: dir }).catch(function () { return { hits: {}, misses: r.items, hitCount: 0 }; })
          : Promise.resolve({ hits: {}, misses: r.items, hitCount: 0 });

        return tmPromise.then(function (tmRes) {
          STATE.tmSessionChecked += r.items.length;
          var hitsObj = tmRes.hits || {};
          var hitIds = Object.keys(hitsObj);
          var misses = Array.isArray(tmRes.misses) ? tmRes.misses : r.items;
          var applyHits = Promise.resolve();

          if (hitIds.length > 0) {
            STATE.tmSessionHits += hitIds.length;
            var hitItems = r.items.filter(function (it) { return Boolean(hitsObj[it.id]); });
            saveStudioCheckpoint(hitsObj);
            applyHits = callWorker("load", JSON.stringify(hitsObj)).then(function (lr) {
              updateProgressUI(lr);
              appendSegmentRows(hitItems, hitsObj, lr.warnings, "tm");
              updateBentoKpis(lr.done, lr.total, STATE.warnIds.length);
              logLine("TM 0ms khớp " + hitIds.length + "/" + r.items.length + " đoạn trong lô.");
            });
          }

          return applyHits.then(function () {
            if (!misses.length) return step();
            batchNo++;
            var rules = ((STATE.docInfo && STATE.docInfo.rules) || "").replace("trong cuộc trò chuyện này", "trong toàn bộ tài liệu");
            var rulesEnd = ((STATE.docInfo && STATE.docInfo.rules_end) || "").replace("{n}", misses.length).replace(/\{\{/g, "{").replace(/\}\}/g, "}");
            var batchPayload = misses.map(function (it) { return JSON.stringify(it); }).join("\n");
            // Chỉ gửi thuật ngữ có trong lô này: bộ Y Dược có hàng trăm mục, gửi hết làm câu nhắn dài vô ích
            var batchGlossary = H().buildGlossaryPromptBlock ? H().buildGlossaryPromptBlock(getActiveGlossaryTerms(), dir, misses.map(function (it) { return it.text; }).join("\n")) : glossaryBlock;
            var prompt = rules + batchGlossary + "\n" + rulesEnd + "\n\n" + batchPayload;

            $("#mon-status-title").textContent = "Lô #" + batchNo + ": đang dịch " + misses.length + " đoạn qua " + eng.name + (model ? " (" + model + ")" : "") + "…";
            logLine("Gửi lô #" + batchNo + " (" + misses.length + " đoạn) -> " + eng.name);

            return translateWithFailover(eng.id, model, prompt).then(function (ans) {
              STATE.batchLatencies.push(ans.latencyMs);
              STATE.charsDone += batchPayload.length;
              var cleaned = stripCodeFences(ans.text);
              var parsed = {};
              try { parsed = JSON.parse(cleaned); } catch { /* web_api.load handles repairs */ }
              saveStudioCheckpoint(parsed);

              // Persist new translations into local TM Vault
              if (STATE.config.tmEnabled !== false) {
                var pairs = misses
                  .filter(function (it) { return parsed[it.id]; })
                  .map(function (it) { return { src: it.text, dst: parsed[it.id] }; });
                if (pairs.length) {
                  api("/api/tm/save", { pairs: pairs, dir: dir, engine: ans.engineId || eng.id })
                    .then(function (s) { if (s && typeof s.count === "number") { STATE.tmStats.count = s.count; if ($("#tm-count-pill")) $("#tm-count-pill").textContent = String(s.count); } })
                    .catch(function () { /* ignore */ });
                }
              }

              return callWorker("load", cleaned).then(function (lr) {
                if (!lr.ok) throw new Error(lr.error || "JSON trả về chưa đọc được");
                updateProgressUI(lr);
                appendSegmentRows(misses, parsed, lr.warnings, "ai");
                var wKeys = Object.keys(lr.warnings || {});
                wKeys.forEach(function (k) { if (STATE.warnIds.indexOf(k) < 0) STATE.warnIds.push(k); });
                updateBentoKpis(lr.done, lr.total, STATE.warnIds.length);
                if (STATE.warnIds.length) {
                  $("#ws-warn-bar").hidden = false;
                  $("#ws-warn-summary").textContent = STATE.warnIds.length + " đoạn có cảnh báo QA (đã nạp tạm).";
                }
                return step();
              });
            });
          });
        });
      });
    }

    return step().catch(function (e) {
      $("#mon-status-title").textContent = "Lỗi: " + e.message;
      logLine("Lỗi dịch: " + e.message);
      if (fromQueue) throw e;
    }).finally(function () {
      STATE.running = false;
      $("#ws-run-btn").disabled = false;
      $("#ws-stop-btn").hidden = true;
      renderQueueTable();
    });
  }

  /* ---------------- Glossary View ---------------- */
  function loadGlossaryPresets() {
    return api("/api/glossary/presets").then(function (d) {
      STATE.glossaryPresets = d.presets || {};
      renderGlossaryView();
    }).catch(function () { /* ignore */ });
  }

  function renderGlossaryView() {
    var presetWrap = $("#gloss-presets");
    if (presetWrap) {
      var keys = ["none"].concat(Object.keys(STATE.glossaryPresets || {}));
      presetWrap.innerHTML = keys.map(function (k) {
        var label = k === "none" ? "Không dùng bộ mẫu" : (STATE.glossaryPresets[k].name + " (" + STATE.glossaryPresets[k].terms.length + ")");
        var active = (STATE.config.glossaryPreset || "none") === k;
        return "<button class='preset-btn" + (active ? " is-active" : "") + "' data-preset-id='" + esc(k) + "' type='button'>" + esc(label) + "</button>";
      }).join("");
      $$("[data-preset-id]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var pid = btn.getAttribute("data-preset-id");
          api("/api/config", { glossaryPreset: pid }).then(function (d) {
            STATE.config = d.config;
            renderGlossaryView();
            updateHeaderAndConfigUI();
            logLine("Chọn bộ từ điển mẫu: " + pid);
          });
        });
      });
    }

    var terms = getActiveGlossaryTerms();
    if ($("#gloss-active-count")) $("#gloss-active-count").textContent = String(terms.length);
    var tbody = $("#gloss-tbody");
    if (!tbody) return;
    if (!terms.length) {
      tbody.innerHTML = "<tr><td colspan='4' class='empty-cell'>Chưa có thuật ngữ nào. Chọn bộ mẫu phía trên hoặc thêm cặp thuật ngữ mới.</td></tr>";
      return;
    }
    tbody.innerHTML = terms.map(function (t) {
      var isCustom = t.source === "Tùy chỉnh";
      return "<tr><td class='mono'>" + esc(t.src) + "</td><td><strong>" + esc(t.dst) + "</strong>" + (t.note ? "<div class='hint'>" + esc(t.note) + "</div>" : "") + "</td>" +
        "<td><span class='status-chip " + (isCustom ? "ok" : "tm") + "'>" + esc(t.source) + "</span></td>" +
        "<td>" + (isCustom ? "<button class='btn-xs' data-gloss-del='" + esc(t.src) + "' type='button'>Xóa</button>" : "—") + "</td></tr>";
    }).join("");

    $$("[data-gloss-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var src = btn.getAttribute("data-gloss-del");
        var next = (STATE.config.glossary || []).filter(function (x) { return x.src !== src; });
        api("/api/config", { glossary: next }).then(function (d) {
          STATE.config = d.config;
          renderGlossaryView();
          updateHeaderAndConfigUI();
        });
      });
    });
  }

  /* ---------------- History View ---------------- */
  function loadHistory() {
    return api("/api/history").then(function (d) {
      STATE.history = d.items || [];
      if ($("#badge-history")) $("#badge-history").textContent = String(STATE.history.length);
      renderHistoryList();
    }).catch(function () { /* ignore */ });
  }

  function renderHistoryList() {
    var wrap = $("#history-list");
    if (!wrap) return;
    var q = ($("#hist-search") ? $("#hist-search").value : "").trim().toLowerCase();
    var list = STATE.history.filter(function (h) {
      if (!q) return true;
      return (h.pdfName + " " + h.engine + " " + h.outputDir).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) {
      wrap.innerHTML = "<div class='empty-panel'>Chưa có dự án nào phù hợp trong lịch sử.</div>";
      return;
    }
    wrap.innerHTML = list.map(function (h) {
      var dt = h.createdAt ? new Date(h.createdAt).toLocaleString("vi-VN") : "";
      var primaryFile = (h.files || []).filter(function (f) { return /\.pdf$/i.test(f.name); })[0];
      return "<div class='hist-card'>" +
        "<div class='hist-head'><div class='hist-title'>" + esc(h.pdfName) + "</div>" +
        "<span class='status-chip " + (h.qaPass ? "ok" : "warn") + "'>" + (h.qaPass ? "QA ĐẠT" : "Cần xem") + "</span></div>" +
        "<div class='hist-meta'>" +
        "<span>" + esc(dt) + "</span><span>·</span><span>" + h.pages + " trang</span><span>·</span>" +
        "<span>" + esc(h.engine || "AI") + "</span><span>·</span><span>TM " + (h.tmHitPct || 0) + "%</span></div>" +
        "<div class='hint mono' style='overflow:hidden;text-overflow:ellipsis'>" + esc(h.outputDir) + "</div>" +
        "<div class='hist-actions'>" +
        (h.outputDir ? "<button class='btn btn-primary btn-sm' data-h-open='" + esc(h.outputDir) + "' type='button'>Mở thư mục</button>" : "") +
        (primaryFile ? "<button class='btn btn-ghost btn-sm' data-h-open='" + esc(primaryFile.path) + "' type='button'>Mở PDF</button>" : "") +
        "<button class='btn btn-ghost btn-sm' data-h-del='" + esc(h.id) + "' type='button'>Xóa</button>" +
        "</div></div>";
    }).join("");

    $$("[data-h-open]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (window.PDF_DESKTOP && window.PDF_DESKTOP.openPath) window.PDF_DESKTOP.openPath(b.getAttribute("data-h-open"));
      });
    });
    $$("[data-h-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        api("/api/history/delete", { id: b.getAttribute("data-h-del") }).then(loadHistory);
      });
    });
  }

  /* ---------------- Command Palette (Ctrl+K) ---------------- */
  function getCommandItems() {
    return [
      { label: "Chuyển sang Kết nối nền tảng AI (10 CLI/API)", hint: "Alt+1", run: function () { switchView("connectors"); } },
      { label: "Chuyển sang Dịch PDF Studio", hint: "Alt+2", run: function () { switchView("workspace"); } },
      { label: "Chuyển sang Từ điển thuật ngữ (Glossary)", hint: "Alt+3", run: function () { switchView("glossary"); } },
      { label: "Chuyển sang Thư viện lịch sử dự án", hint: "Alt+4", run: function () { switchView("history"); } },
      { label: "Chuyển sang Kiểm định QA độc lập", hint: "Alt+5", run: function () { switchView("qa"); } },
      { label: "Chuyển sang Nhật ký & Bộ nhớ TM", hint: "Alt+6", run: function () { switchView("logs"); } },
      { label: "Mở tệp PDF để dịch ngay", hint: "Ctrl+O", run: function () { switchView("workspace"); $("#ws-pick-btn").click(); } },
      { label: "Thêm nhiều PDF vào hàng đợi (Batch Queue)", hint: "Batch", run: function () { switchView("workspace"); $("#ws-add-multi-btn").click(); } },
      { label: "So sánh trực quan trang PDF Gốc ↔ Dịch", hint: "Preview", run: function () { switchView("workspace"); switchMonTab("preview"); } },
      { label: "Ping toàn bộ nền tảng AI sẵn sàng", hint: "Health", run: function () { switchView("connectors"); pingAllReady(); } },
      { label: "Đổi giao diện Sáng / Tối (Editorial Light / Obsidian Dark)", hint: "Theme", run: function () { $("#btn-theme-toggle").click(); } },
    ];
  }

  function openCmdPalette() {
    var bd = $("#cmd-backdrop"), inp = $("#cmd-input");
    if (!bd || !inp) return;
    bd.hidden = false;
    inp.value = "";
    renderCmdList("");
    setTimeout(function () { inp.focus(); }, 20);
  }

  function closeCmdPalette() {
    if ($("#cmd-backdrop")) $("#cmd-backdrop").hidden = true;
  }

  function renderCmdList(query) {
    var listEl = $("#cmd-list");
    if (!listEl) return;
    var q = String(query || "").trim().toLowerCase();
    var items = getCommandItems().filter(function (it) {
      return !q || it.label.toLowerCase().indexOf(q) >= 0 || it.hint.toLowerCase().indexOf(q) >= 0;
    });
    listEl.innerHTML = items.map(function (it, idx) {
      return "<button class='cmd-item" + (idx === 0 ? " is-focus" : "") + "' data-cmd-idx='" + idx + "' type='button'>" +
        "<span>" + esc(it.label) + "</span><span class='cmd-hint'>" + esc(it.hint) + "</span></button>";
    }).join("");
    $$("[data-cmd-idx]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-cmd-idx"));
        closeCmdPalette();
        if (items[idx]) items[idx].run();
      });
    });
  }

  /* ---------------- Standalone QA Scorer ---------------- */
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
      var qaSvgBox = $("#qa-lieflat-chart");
      if (qaSvgBox && H().buildLieFlatMetricsSvg) {
        var accentPct = Math.round(Number(r.ty_le_tu_co_dau || 0) * 100);
        var layoutPct = r.do_trung_bo_cuc === "" ? 100 : Math.round(Number(r.do_trung_bo_cuc || 0) * 100);
        var cleanTofuPct = r.ky_tu_loi_phong === 0 ? 100 : Math.max(0, 100 - Math.min(100, Number(r.ky_tu_loi_phong) * 5));
        var vectorPct = r.trang_mat_lop_chu === 0 ? 100 : 0;
        var noOverlapPct = r.cap_dong_chong_nhau === 0 ? 100 : Math.max(0, 100 - Math.min(100, Number(r.cap_dong_chong_nhau) * 10));
        qaSvgBox.innerHTML = H().buildLieFlatMetricsSvg("Chỉ số Bảo toàn Bố cục & Tiếng Việt (0–100%)", [
          { label: "Sạch lỗi phông (Tofu)", pct: cleanTofuPct, valueText: r.ky_tu_loi_phong + " lỗi", color: "#22c55e" },
          { label: "Lớp chữ Vector", pct: vectorPct, valueText: r.trang_mat_lop_chu + " trang mất", color: "#14b8a6" },
          { label: "Không chồng dòng", pct: noOverlapPct, valueText: r.cap_dong_chong_nhau + " cặp", color: "#38bdf8" },
          { label: "Độ trùng bố cục", pct: layoutPct, valueText: r.do_trung_bo_cuc === "" ? "N/A" : layoutPct + "%", color: "#a855f7" },
          { label: "Từ tiếng Việt có dấu", pct: accentPct || 100, valueText: (accentPct || 100) + "%", color: "#f59e0b" },
        ]);
        qaSvgBox.hidden = false;
      }
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
      renderConnectorsGrid(); renderInspector(); switchView("connectors");
    });

    // Theme Toggle
    $("#btn-theme-toggle").addEventListener("click", function () {
      var next = STATE.config.theme === "light" ? "dark" : "light";
      STATE.config.theme = next;
      applyTheme(next);
      api("/api/config", { theme: next }).then(function (d) { STATE.config = d.config; }).catch(function () { /* ignore */ });
    });

    // Command Palette & Shortcuts
    $("#btn-cmd-palette").addEventListener("click", openCmdPalette);
    $("#cmd-backdrop").addEventListener("click", function (e) { if (e.target === $("#cmd-backdrop")) closeCmdPalette(); });
    $("#cmd-input").addEventListener("input", function () { renderCmdList($("#cmd-input").value); });
    $("#cmd-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = $("#cmd-list .cmd-item");
        if (first) first.click();
      }
    });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if ($("#cmd-backdrop").hidden) openCmdPalette(); else closeCmdPalette();
      } else if (e.key === "Escape") {
        closeCmdPalette();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        switchView("workspace");
        $("#ws-pick-btn").click();
      } else if (e.altKey && !e.ctrlKey && e.key >= "1" && e.key <= "6") {
        e.preventDefault();
        var views = ["connectors", "workspace", "glossary", "history", "qa", "logs"];
        switchView(views[Number(e.key) - 1]);
      }
    });

    // Connectors & Failover & TM toggle
    $("#btn-ping-all").addEventListener("click", pingAllReady);
    $("#btn-refresh-engines").addEventListener("click", loadEngines);
    $("#rail-refresh-btn").addEventListener("click", loadEngines);
    $("#cfg-tm-enabled").addEventListener("change", function () {
      api("/api/config", { tmEnabled: $("#cfg-tm-enabled").checked }).then(function (d) {
        STATE.config = d.config;
        updateHeaderAndConfigUI();
      });
    });
    $("#btn-edit-failover").addEventListener("click", function () {
      $("#failover-panel").hidden = !$("#failover-panel").hidden;
      renderFailoverChips();
    });
    $("#btn-save-failover").addEventListener("click", function () {
      var chosen = $$("[data-fo-id]:checked").map(function (c) { return c.getAttribute("data-fo-id"); });
      api("/api/config", { failoverEngines: chosen }).then(function (d) {
        STATE.config = d.config;
        $("#failover-panel").hidden = true;
        updateHeaderAndConfigUI();
        logLine("Đã lưu chuỗi AI dự phòng (" + chosen.length + " nền tảng).");
      });
    });

    // Output directory
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

    // Multi-file & Single-file PDF pickers + dropzone
    function pickPdfs(multiple) {
      if (window.PDF_DESKTOP && window.PDF_DESKTOP.pickPdf) {
        window.PDF_DESKTOP.pickPdf(multiple).then(function (res) {
          if (!res.canceled && res.files && res.files.length) {
            enqueueFiles(res.files.map(function (f) { return { name: f.name, buffer: base64ToArrayBuffer(f.base64) }; }));
          }
        });
      } else {
        $("#ws-file-input").click();
      }
    }
    var drop = $("#ws-drop");
    $("#ws-pick-btn").addEventListener("click", function (ev) { ev.stopPropagation(); pickPdfs(true); });
    $("#ws-add-multi-btn").addEventListener("click", function () { pickPdfs(true); });
    drop.addEventListener("click", function () { pickPdfs(true); });
    $("#ws-file-input").addEventListener("change", function () {
      var files = Array.prototype.slice.call($("#ws-file-input").files || []);
      Promise.all(files.map(readFileInput)).then(enqueueFiles);
    });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (e) {
      var files = Array.prototype.slice.call(e.dataTransfer.files || []).filter(function (f) { return /\.pdf$/i.test(f.name); });
      Promise.all(files.map(readFileInput)).then(enqueueFiles);
    });

    // Queue actions
    $("#q-run-all").addEventListener("click", runBatchQueue);
    $("#q-clear-done").addEventListener("click", function () {
      STATE.queue = STATE.queue.filter(function (q) { return q.status !== "done"; });
      renderQueueTable();
    });

    // Workspace controls
    $("#ws-engine-select").addEventListener("change", function () { setActiveEngine($("#ws-engine-select").value); syncWorkspaceModel(); });
    $("#ws-model-input").addEventListener("change", function () {
      var id = $("#ws-engine-select").value;
      if (!id) return;
      var patch = { models: {} };
      patch.models[id] = $("#ws-model-input").value.trim();
      api("/api/config", patch).then(function (d) { STATE.config = d.config; updateHeaderAndConfigUI(); renderConnectorsGrid(); });
    });
    $("#ws-run-btn").addEventListener("click", function () { runTranslationAndBuild(false); });
    $("#ws-stop-btn").addEventListener("click", function () { STATE.stop = true; });
    $("#ws-build-only-btn").addEventListener("click", function () { buildAndSavePdfs().catch(function (e) { logLine("Lỗi dựng: " + e.message); }); });
    $$('input[name="ws-dir"]').forEach(function (r) { r.addEventListener("change", function () { if (STATE.pdfBytes) preparePdf(); }); });
    $$('input[name="ws-domain"]').forEach(function (r) {
      r.addEventListener("change", function () { updateDomainHint(); if (STATE.pdfBytes) preparePdf(); });
    });

    // Segment filter, search, retry warn & bilingual exports
    $("#seg-search").addEventListener("input", function () { STATE.segSearch = $("#seg-search").value; renderSegmentsTable(); });
    $$("[data-seg-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        STATE.segFilter = btn.getAttribute("data-seg-filter");
        $$("[data-seg-filter]").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        renderSegmentsTable();
      });
    });
    $("#btn-export-csv").addEventListener("click", function () {
      if (!STATE.segments.length || !H().exportSegmentsToCsv) return;
      downloadTextFile((STATE.pdfName || "translation").replace(/\.pdf$/i, "") + "_bilingual.csv", H().exportSegmentsToCsv(STATE.segments), "text/csv;charset=utf-8");
    });
    $("#btn-export-md").addEventListener("click", function () {
      if (!STATE.segments.length || !H().exportSegmentsToMarkdown) return;
      downloadTextFile((STATE.pdfName || "translation").replace(/\.pdf$/i, "") + "_bilingual.md", H().exportSegmentsToMarkdown(STATE.segments, STATE.pdfName), "text/markdown;charset=utf-8");
    });
    $("#btn-export-tmx").addEventListener("click", function () {
      if (!STATE.segments.length || !H().exportSegmentsToTmx) return;
      var dir = (STATE.docInfo && STATE.docInfo.huong) || "en-vi";
      downloadTextFile((STATE.pdfName || "translation").replace(/\.pdf$/i, "") + ".tmx", H().exportSegmentsToTmx(STATE.segments, dir), "application/xml;charset=utf-8");
    });
    $("#btn-export-json").addEventListener("click", function () {
      if (!STATE.segments.length) return;
      var map = {};
      STATE.segments.forEach(function (s) { if (s.dst) map[s.id] = s.dst; });
      downloadTextFile((STATE.pdfName || "translation").replace(/\.pdf$/i, "") + "_translations.json", JSON.stringify(map, null, 2), "application/json;charset=utf-8");
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
        return translateWithFailover(engId, model, prompt).then(function (ans) {
          var cleaned = stripCodeFences(ans.text);
          var parsed = {};
          try { parsed = JSON.parse(cleaned); } catch { /* ignore */ }
          saveStudioCheckpoint(parsed);
          return callWorker("load", cleaned).then(function (lr) {
            appendSegmentRows(items, parsed, lr.warnings, "ai");
            STATE.warnIds = Object.keys(lr.warnings || {});
            updateBentoKpis(lr.done || 0, lr.total || 0, STATE.warnIds.length);
            $("#ws-warn-bar").hidden = !STATE.warnIds.length;
            $("#mon-status-title").textContent = "Đã cập nhật lại các đoạn cảnh báo.";
          });
        });
      }).catch(function (e) { logLine("Lỗi dịch lại cảnh báo: " + e.message); });
    });

    // Visual PDF Preview Comparator wiring
    $("#pv-render-btn").addEventListener("click", renderPreviewPage);
    $("#pv-prev").addEventListener("click", function () { if (STATE.previewPage > 1) { STATE.previewPage--; renderPreviewPage(); } });
    $("#pv-next").addEventListener("click", function () { if (STATE.previewPage < STATE.previewTotal) { STATE.previewPage++; renderPreviewPage(); } });
    $("#pv-mode").addEventListener("change", renderPreviewPage);
    $("#pv-target").addEventListener("change", renderPreviewPage);
    $("#pv-zoom").addEventListener("change", renderPreviewPage);
    $("#pv-slider-range").addEventListener("input", function () { updateCurtainSlider($("#pv-slider-range").value); });

    // Glossary Manager wiring
    $("#gloss-add-btn").addEventListener("click", function () {
      var src = $("#gloss-src-in").value.trim();
      var dst = $("#gloss-dst-in").value.trim();
      var note = $("#gloss-note-in").value.trim();
      if (!src || !dst) return;
      var cur = (STATE.config.glossary || []).filter(function (x) { return x.src.toLowerCase() !== src.toLowerCase(); });
      cur.push({ src: src, dst: dst, note: note });
      api("/api/config", { glossary: cur }).then(function (d) {
        STATE.config = d.config;
        $("#gloss-src-in").value = ""; $("#gloss-dst-in").value = ""; $("#gloss-note-in").value = "";
        renderGlossaryView(); updateHeaderAndConfigUI();
      });
    });
    $("#gloss-import-btn").addEventListener("click", function () { $("#gloss-import-box").hidden = !$("#gloss-import-box").hidden; });
    $("#gloss-import-cancel").addEventListener("click", function () { $("#gloss-import-box").hidden = true; });
    $("#gloss-import-apply").addEventListener("click", function () {
      var parsed = H().parseGlossaryImport ? H().parseGlossaryImport($("#gloss-import-text").value) : [];
      if (!parsed.length) return;
      var merged = (STATE.config.glossary || []).concat(parsed);
      api("/api/config", { glossary: merged }).then(function (d) {
        STATE.config = d.config;
        $("#gloss-import-text").value = "";
        $("#gloss-import-box").hidden = true;
        renderGlossaryView(); updateHeaderAndConfigUI();
        logLine("Đã nhập " + parsed.length + " thuật ngữ vào từ điển.");
      });
    });
    $("#gloss-export-btn").addEventListener("click", function () {
      var terms = getActiveGlossaryTerms();
      var csv = "\uFEFFSource,Target,Origin\r\n" + terms.map(function (t) {
        return "\"" + t.src.replace(/"/g, "\"\"") + "\",\"" + t.dst.replace(/"/g, "\"\"") + "\",\"" + (t.source || "") + "\"";
      }).join("\r\n");
      downloadTextFile("pdf-layout-vi-glossary.csv", csv, "text/csv;charset=utf-8");
    });
    $("#gloss-clear-custom").addEventListener("click", function () {
      api("/api/config", { glossary: [] }).then(function (d) {
        STATE.config = d.config;
        renderGlossaryView(); updateHeaderAndConfigUI();
      });
    });

    // History view wiring
    $("#hist-search").addEventListener("input", renderHistoryList);
    $("#hist-refresh-btn").addEventListener("click", loadHistory);
    $("#hist-clear-btn").addEventListener("click", function () {
      api("/api/history/delete", { clearAll: true }).then(loadHistory);
    });

    // Standalone QA Scorer
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

    // TM Vault & Logs wiring
    $("#tm-export-btn").addEventListener("click", function () {
      api("/api/tm/export").then(function (d) {
        downloadTextFile("pdf-layout-vi-tm.json", JSON.stringify(d.entries || [], null, 2), "application/json;charset=utf-8");
      });
    });
    $("#tm-clear-btn").addEventListener("click", function () {
      api("/api/tm/clear").then(function () { refreshTmStats(); logLine("Đã làm trống bộ nhớ dịch TM."); });
    });
    $("#logs-clear-btn").addEventListener("click", function () { $("#logs-pre").textContent = ""; });

    // Boot sequence
    api("/api/edition").then(function (d) { applyEdition(d && d.edition); }).catch(function () { /* bản cũ không có ấn bản */ });
    loadGlossaryPresets();
    loadEngines();
    loadHistory();
    refreshTmStats();
    callWorker("init").catch(function (e) {
      $("#top-engine-label").textContent = "Lỗi bộ máy PDF";
      $("#top-engine-dot").className = "dot";
      logLine("Khởi động Pyodide thất bại: " + e.message);
    });
  });
})();
