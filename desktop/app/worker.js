/* desktop/app/worker.js — Dedicated offline Pyodide + PyMuPDF Web Worker for PDF Layout VI Studio */
"use strict";

var ENGINE = new URL("/engine/", self.location.href).href;
var WHEEL = "pymupdf-1.28.2-cp313-abi3-pyemscripten_2025_0_wasm32.whl";
var SELF_CORE = { name: "local", url: ENGINE + "pyodide/", self: true };
var SELF_WHEEL = { name: "local", url: ENGINE + WHEEL };
var FONT_BASE = { serif: "LiberationSerif", sans: "LiberationSans", mono: "LiberationMono", calibri: "Carlito" };
var STYLES = ["Regular", "Bold", "Italic", "BoldItalic"];
var py = null, api = null, initPromise = null, loadedFamilies = {};

function status(text, frac) {
  self.postMessage({ type: "status", text: text, frac: frac });
}

async function doInit() {
  status("Đang nạp runtime Python nội bộ…", 0.08);
  importScripts(SELF_CORE.url + "pyodide.js");
  status("Đang khởi động Pyodide…", 0.35);
  py = await loadPyodide({ indexURL: SELF_CORE.url });
  status("Đang nạp PyMuPDF WebAssembly…", 0.6);
  var res = await fetch(SELF_WHEEL.url);
  if (!res.ok) throw new Error("Không đọc được PyMuPDF wheel (HTTP " + res.status + ")");
  var bytes = new Uint8Array(await res.arrayBuffer());
  var site = py.runPython("import site; site.getsitepackages()[0]");
  py.unpackArchive(bytes.buffer, "wheel", { extractDir: site });
  py.pyimport("pymupdf");

  status("Đang nạp engine dàn trang vector…", 0.85);
  py.FS.mkdirTree("/app/scripts");
  py.FS.mkdirTree("/app/assets/fonts");
  py.FS.mkdirTree("/tmp/in");
  for (var f of ["dich_pdf.py", "web_api.py"]) {
    var fr = await fetch(ENGINE + f);
    if (!fr.ok) throw new Error("Không tải được " + f);
    py.FS.writeFile("/app/scripts/" + f, await fr.text());
  }
  py.runPython("import sys; sys.path.insert(0, '/app/scripts')");
  api = py.pyimport("web_api");
  var ver = py.runPython("import pymupdf, dich_pdf; f'{dich_pdf.PHIEN_BAN} · PyMuPDF {pymupdf.VersionBind}'");
  status("Sẵn sàng (100% Offline)", 1);
  return { ready: true, version: ver };
}

function init() {
  if (!initPromise) initPromise = doInit().catch(function (e) { initPromise = null; throw e; });
  return initPromise;
}

async function loadFonts(families) {
  var need = [];
  families.forEach(function (fam) { if (FONT_BASE[fam] && !loadedFamilies[fam]) need.push(fam); });
  if (!loadedFamilies.sans && need.indexOf("sans") < 0) need.push("sans");
  var jobs = [];
  need.forEach(function (fam) {
    STYLES.forEach(function (st) {
      var name = FONT_BASE[fam] + "-" + st + ".ttf";
      jobs.push(fetch(ENGINE + "fonts/" + name).then(function (r) {
        if (!r.ok) throw new Error("Không tải được phông " + name);
        return r.arrayBuffer();
      }).then(function (b) { py.FS.writeFile("/app/assets/fonts/" + name, new Uint8Array(b)); }));
    });
  });
  if (jobs.length) status("Đang nạp phông chữ tiếng Việt…", 0.96);
  await Promise.all(jobs);
  need.forEach(function (fam) { loadedFamilies[fam] = true; });
  return Object.keys(loadedFamilies);
}

function J(s) { return JSON.parse(s); }

var handlers = {
  init: init,
  prepare: async function (bytes, name, lo, trang, huong) {
    await init();
    var safe = (name || "tai-lieu.pdf").replace(/[\\/:*?"<>|]+/g, "_");
    if (!/\.pdf$/i.test(safe)) safe += ".pdf";
    try { py.FS.readdir("/tmp/in").forEach(function (f) { if (f !== "." && f !== "..") py.FS.unlink("/tmp/in/" + f); }); } catch (e) { /* empty */ }
    py.FS.writeFile("/tmp/in/" + safe, new Uint8Array(bytes));
    var r = J(api.prepare("/tmp/in/" + safe, lo || 15, trang || "", huong || "tu-dong"));
    if (r.ok) r.loadedFamilies = await loadFonts(r.families);
    return r;
  },
  nextItems: async function (maxChars) { return J(api.next_items(maxChars || 7000)); },
  load: async function (text) { return J(api.load(text)); },
  missingIds: async function (ids) { return J(api.missing_ids(JSON.stringify(ids))); },
  itemsFor: async function (ids) { return J(api.items_for(JSON.stringify(ids))); },
  translations: async function () { return J(api.translations()); },
  progress: async function () { return J(api.progress()); },
  build: async function (mode, footer) { return J(api.build(mode, footer !== false)); },
  qa: async function () { return J(api.qa()); },
  zipAll: async function () { return J(api.zip_all()); },
  availableOutputs: async function () { return J(api.available_outputs()); },
  renderPage: async function (which, pageNo, zoom) { return J(api.render_page(which || "src", pageNo || 1, zoom || 1.35)); },
  readFile: async function (p) { return py.FS.readFile(p); },
  score: async function (goc, dich, nameGoc, nameDich) {
    await init();
    py.FS.mkdirTree("/tmp/cham");
    py.FS.writeFile("/tmp/cham/goc.pdf", new Uint8Array(goc));
    py.FS.writeFile("/tmp/cham/dich.pdf", new Uint8Array(dich));
    var r = J(api.score("/tmp/cham/goc.pdf", "/tmp/cham/dich.pdf", nameDich || ""));
    r.ten_goc = nameGoc; r.ten_dich = nameDich;
    return r;
  },
};

self.onmessage = async function (e) {
  var d = e.data;
  try {
    var result = await handlers[d.cmd].apply(null, d.args || []);
    var transfer = result instanceof Uint8Array ? [result.buffer] : [];
    self.postMessage({ id: d.id, ok: true, result: result }, transfer);
  } catch (err) {
    self.postMessage({ id: d.id, ok: false, error: String(err && err.message || err) });
  }
};
