// server/index.mjs — Dedicated Windows Desktop backend v4.1.0 (AI Connectors, Vault, TM, Glossary, History, Loopback-Safe File I/O)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listEngines,
  getEngine,
  startLogin,
  startInstall,
  getJob,
  sendJobInput,
  stopJob,
  pingEngine,
} from "./drivers.mjs";
import { getPublicConfig, updateConfig, defaultOutputDir, GLOSSARY_PRESETS } from "./config-store.mjs";
import { lookupTm, saveTmEntries, getTmStats, exportTmEntries, clearTm } from "./tm-store.mjs";
import { listHistory, addHistoryEntry, deleteHistoryEntry, clearHistory } from "./history-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOOPBACK_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;
const TRUSTED_WEB_ORIGINS = new Set([
  "https://pdf.huynhanhthuan.com",
  "https://pdf-layout-vi.vercel.app",
]);

function isBridgePathname(pathname) {
  return pathname === "/api/health" || pathname.startsWith("/api/cli/");
}

function isAllowedOrigin(origin, pathname) {
  if (!origin) return true;
  if (LOOPBACK_ORIGIN_RE.test(origin)) return true;
  if (TRUSTED_WEB_ORIGINS.has(origin) && isBridgePathname(pathname)) return true;
  return false;
}

const DEFAULT_EDITION = { id: "standard", name: "PDF Layout VI Studio", badge: "v4.1 PRO", defaultDomain: "chung" };

// Ấn bản (Studio hay Y Dược): bản cài đặt mang file edition.json trong resources; lúc phát triển chọn bằng PDF_LAYOUT_EDITION
export function loadEdition() {
  const candidates = [
    process.env.PDF_LAYOUT_EDITION_FILE,
    path.resolve(__dirname, "..", "edition.json"),
    path.resolve(__dirname, "..", "editions", `${(process.env.PDF_LAYOUT_EDITION || "standard").replace(/[^a-z-]/g, "")}.json`),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const e = JSON.parse(fs.readFileSync(f, "utf8"));
      if (e && typeof e.id === "string") {
        return {
          ...DEFAULT_EDITION,
          ...e,
          defaultDomain: e.defaultDomain === "y-duoc" ? "y-duoc" : "chung",
        };
      }
    } catch { /* thử file kế tiếp */ }
  }
  return { ...DEFAULT_EDITION };
}

const EDITION = loadEdition();

function resolvePaths() {
  const envDesktop = process.env.PDF_LAYOUT_DESKTOP_UI_DIR;
  const packagedDesktop = path.resolve(__dirname, "..", "app");
  const devDesktop = path.resolve(__dirname, "..", "app");
  const desktopDir = envDesktop && fs.existsSync(envDesktop)
    ? envDesktop
    : fs.existsSync(path.join(packagedDesktop, "index.html"))
      ? packagedDesktop
      : devDesktop;

  const envEngine = process.env.PDF_LAYOUT_ENGINE_DIR;
  const packagedEngine = path.resolve(__dirname, "..", "engine");
  const devEngine = path.resolve(__dirname, "..", "..", "engine");
  const engineDir = envEngine && fs.existsSync(envEngine)
    ? envEngine
    : fs.existsSync(path.join(packagedEngine, "dich_pdf.py"))
      ? packagedEngine
      : devEngine;

  return { desktopDir, engineDir };
}

const { desktopDir: DESKTOP_DIR, engineDir: ENGINE_DIR } = resolvePaths();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".whl": "application/zip",
  ".zip": "application/zip",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
  ".py": "text/x-python; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function corsHeaders(req, pathname) {
  const origin = req && req.headers && req.headers.origin ? String(req.headers.origin) : "";
  const routePath = pathname || new URL((req && req.url) || "/", "http://127.0.0.1").pathname;
  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (origin && isAllowedOrigin(origin, routePath)) {
    headers["Access-Control-Allow-Origin"] = origin;
    if (req.headers["access-control-request-private-network"] === "true") {
      headers["Access-Control-Allow-Private-Network"] = "true";
    }
  }
  return headers;
}

function sendJson(req, res, status, data, pathname) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...corsHeaders(req, pathname),
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("JSON không hợp lệ: " + e.message));
      }
    });
    req.on("error", reject);
  });
}

function serveFileFromRoot(res, rootDir, relPath) {
  let clean = String(relPath || "").replace(/^\/+/, "");
  try { clean = decodeURIComponent(clean); } catch { /* ignore */ }
  const full = path.resolve(rootDir, clean);
  if (!full.startsWith(path.resolve(rootDir))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found: " + clean);
  }
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(full).pipe(res);
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;

    // Reject cross-origin API calls from untrusted sites (allow loopback + trusted web origins on CLI bridge routes only)
    const origin = req.headers && req.headers.origin ? String(req.headers.origin) : "";
    if (origin && pathname.startsWith("/api/") && !isAllowedOrigin(origin, pathname)) {
      return sendJson(req, res, 403, { ok: false, error: "Forbidden cross-origin request" }, pathname);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req, pathname));
      return res.end();
    }

    try {
      if (pathname === "/api/health" && req.method === "GET") {
        return sendJson(req, res, 200, {
          ok: true,
          app: "pdf-layout-vi-desktop",
          version: "4.1.0",
          edition: EDITION,
          platform: process.platform,
          desktopDir: DESKTOP_DIR,
          engineDir: ENGINE_DIR,
          features: ["visual-preview", "batch-queue", "glossary", "tm-cache", "auto-failover", "history", "command-palette", "fr-vi", "y-duoc"],
        });
      }

      if (pathname === "/api/edition" && req.method === "GET") {
        return sendJson(req, res, 200, { ok: true, edition: EDITION });
      }

      if (pathname === "/api/config" && req.method === "GET") {
        return sendJson(req, res, 200, { ok: true, config: getPublicConfig() });
      }

      if (pathname === "/api/config" && req.method === "POST") {
        const body = await readJsonBody(req);
        return sendJson(req, res, 200, { ok: true, config: updateConfig(body) });
      }

      if (pathname === "/api/glossary/presets" && req.method === "GET") {
        return sendJson(req, res, 200, { ok: true, presets: GLOSSARY_PRESETS });
      }

      // Translation Memory endpoints
      if (pathname === "/api/tm/stats" && req.method === "GET") {
        return sendJson(req, res, 200, { ok: true, stats: getTmStats() });
      }

      if (pathname === "/api/tm/export" && req.method === "GET") {
        return sendJson(req, res, 200, { ok: true, entries: exportTmEntries() });
      }

      if (pathname === "/api/tm/lookup" && req.method === "POST") {
        const body = await readJsonBody(req);
        const result = lookupTm(Array.isArray(body.items) ? body.items : [], body.dir || "en-vi");
        return sendJson(req, res, 200, { ok: true, ...result });
      }

      if (pathname === "/api/tm/save" && req.method === "POST") {
        const body = await readJsonBody(req);
        const result = saveTmEntries(Array.isArray(body.pairs) ? body.pairs : [], body.dir || "en-vi", body.engine || "");
        return sendJson(req, res, 200, { ok: true, ...result });
      }

      if (pathname === "/api/tm/clear" && req.method === "POST") {
        return sendJson(req, res, 200, clearTm());
      }

      // Project History endpoints
      if (pathname === "/api/history" && req.method === "GET") {
        return sendJson(req, res, 200, { ok: true, items: listHistory() });
      }

      if (pathname === "/api/history" && req.method === "POST") {
        const body = await readJsonBody(req);
        const item = addHistoryEntry(body);
        return sendJson(req, res, 200, { ok: true, item });
      }

      if (pathname === "/api/history/delete" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (body.clearAll) return sendJson(req, res, 200, clearHistory());
        return sendJson(req, res, 200, deleteHistoryEntry(String(body.id || "")));
      }

      if (pathname === "/api/cli/engines" && req.method === "GET") {
        const engines = await listEngines();
        return sendJson(req, res, 200, { ok: true, engines, config: getPublicConfig(), tm: getTmStats() });
      }

      if (pathname === "/api/cli/login" && req.method === "POST") {
        const body = await readJsonBody(req);
        const resJob = startLogin(body.engine, { mode: body.mode || "stream" });
        return sendJson(req, res, 200, { ok: true, ...resJob });
      }

      if (pathname === "/api/cli/install" && req.method === "POST") {
        const body = await readJsonBody(req);
        const resJob = startInstall(body.engine, { mode: body.mode || "stream" });
        return sendJson(req, res, 200, { ok: true, ...resJob });
      }

      if (pathname === "/api/cli/job" && req.method === "GET") {
        const id = url.searchParams.get("id") || "";
        const j = getJob(id);
        if (!j) return sendJson(req, res, 404, { ok: false, error: "Không tìm thấy tiến trình." });
        return sendJson(req, res, 200, { ok: true, job: j });
      }

      if (pathname === "/api/cli/job/input" && req.method === "POST") {
        const body = await readJsonBody(req);
        return sendJson(req, res, 200, sendJobInput(body.id, body.text));
      }

      if (pathname === "/api/cli/job/stop" && req.method === "POST") {
        const body = await readJsonBody(req);
        return sendJson(req, res, 200, stopJob(body.id));
      }

      if (pathname === "/api/cli/ping" && req.method === "POST") {
        const body = await readJsonBody(req);
        const out = await pingEngine(body.engine, body.model || "");
        return sendJson(req, res, 200, out);
      }

      if (pathname === "/api/cli/translate" && req.method === "POST") {
        const body = await readJsonBody(req);
        const eng = getEngine(body.engine);
        if (!eng) return sendJson(req, res, 400, { ok: false, error: `Nền tảng không hợp lệ: ${body.engine}` });
        if (!body.prompt) return sendJson(req, res, 400, { ok: false, error: "Thiếu prompt" });
        const text = await eng.translate(body.prompt, body.model || "");
        return sendJson(req, res, 200, { ok: true, engine: eng.id, text });
      }

      // Save built PDF/QA files directly into a clean Windows output folder (strict path traversal defense)
      if (pathname === "/api/output/save" && req.method === "POST") {
        const body = await readJsonBody(req);
        const rawFolder = String(body.folderName || `PDF-${Date.now()}`).trim();
        const baseName = rawFolder.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
        if (!baseName || baseName === "." || baseName === ".." || /^\.+$/.test(baseName)) {
          return sendJson(req, res, 400, { ok: false, error: "Tên thư mục xuất không hợp lệ." });
        }
        const cfg = getPublicConfig();
        const rootOut = path.resolve(body.outputDir || cfg.outputDir || defaultOutputDir());
        const targetDir = path.resolve(rootOut, baseName);
        if (!targetDir.startsWith(rootOut + path.sep)) {
          return sendJson(req, res, 400, { ok: false, error: "Đường dẫn thư mục vượt phạm vi cho phép." });
        }
        fs.mkdirSync(targetDir, { recursive: true });
        const saved = [];
        for (const f of body.files || []) {
          const rawFile = String(f.name || "output.pdf");
          if (rawFile.includes("..") || rawFile.includes("/") || rawFile.includes("\\")) {
            return sendJson(req, res, 400, { ok: false, error: `Tên file không hợp lệ: ${rawFile}` });
          }
          const safeFile = path.basename(rawFile).replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
          if (!safeFile || safeFile === "." || safeFile === "..") {
            return sendJson(req, res, 400, { ok: false, error: "Tên file rỗng hoặc không hợp lệ." });
          }
          const dest = path.resolve(targetDir, safeFile);
          if (!dest.startsWith(targetDir + path.sep)) {
            return sendJson(req, res, 400, { ok: false, error: "Đường dẫn file không hợp lệ." });
          }
          fs.writeFileSync(dest, Buffer.from(String(f.base64 || ""), "base64"));
          saved.push({ name: safeFile, path: dest, size: fs.statSync(dest).size });
        }
        return sendJson(req, res, 200, { ok: true, dir: targetDir, files: saved });
      }

      if (req.method === "GET" || req.method === "HEAD") {
        if (pathname.startsWith("/engine/")) {
          return serveFileFromRoot(res, ENGINE_DIR, pathname.slice("/engine/".length));
        }
        if (pathname === "/" || pathname === "/index.html" || pathname === "/dich") {
          return serveFileFromRoot(res, DESKTOP_DIR, "index.html");
        }
        return serveFileFromRoot(res, DESKTOP_DIR, pathname.slice(1));
      }

      sendJson(req, res, 404, { ok: false, error: "Route not found" });
    } catch (err) {
      sendJson(req, res, 500, { ok: false, error: err && err.message ? err.message : String(err) });
    }
  });
}

const entryArg = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryArg === path.resolve(__filename)) {
  const port = Number(process.env.PORT || 0);
  const host = process.env.HOST || "127.0.0.1";
  const server = createAppServer();
  server.listen(port, host, () => {
    const addr = server.address();
    const boundPort = typeof addr === "object" && addr ? addr.port : port;
    process.stdout.write(`PDF_LAYOUT_VI_LISTENING=http://${host}:${boundPort}\n`);
  });
}
