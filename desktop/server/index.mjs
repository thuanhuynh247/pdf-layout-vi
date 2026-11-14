// server/index.mjs — Dedicated Windows Desktop backend (AI Connectors, Vault, File I/O, Local Engine Host)
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
import { getPublicConfig, updateConfig, defaultOutputDir } from "./config-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePaths() {
  // Desktop app HTML/JS/CSS
  const envDesktop = process.env.PDF_LAYOUT_DESKTOP_UI_DIR;
  const packagedDesktop = path.resolve(__dirname, "..", "app");
  const devDesktop = path.resolve(__dirname, "..", "app");
  const desktopDir = envDesktop && fs.existsSync(envDesktop)
    ? envDesktop
    : fs.existsSync(path.join(packagedDesktop, "index.html"))
      ? packagedDesktop
      : devDesktop;

  // Shared Pyodide + PyMuPDF + dich_pdf.py engine assets
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

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    try {
      if (pathname === "/api/health" && req.method === "GET") {
        return sendJson(res, 200, {
          ok: true,
          app: "pdf-layout-vi-desktop",
          version: "3.4.0",
          platform: process.platform,
          desktopDir: DESKTOP_DIR,
          engineDir: ENGINE_DIR,
        });
      }

      if (pathname === "/api/config" && req.method === "GET") {
        return sendJson(res, 200, { ok: true, config: getPublicConfig() });
      }

      if (pathname === "/api/config" && req.method === "POST") {
        const body = await readJsonBody(req);
        return sendJson(res, 200, { ok: true, config: updateConfig(body) });
      }

      if (pathname === "/api/cli/engines" && req.method === "GET") {
        const engines = await listEngines();
        return sendJson(res, 200, { ok: true, engines, config: getPublicConfig() });
      }

      if (pathname === "/api/cli/login" && req.method === "POST") {
        const body = await readJsonBody(req);
        const resJob = startLogin(body.engine, { mode: body.mode || "stream" });
        return sendJson(res, 200, { ok: true, ...resJob });
      }

      if (pathname === "/api/cli/install" && req.method === "POST") {
        const body = await readJsonBody(req);
        const resJob = startInstall(body.engine, { mode: body.mode || "stream" });
        return sendJson(res, 200, { ok: true, ...resJob });
      }

      if (pathname === "/api/cli/job" && req.method === "GET") {
        const id = url.searchParams.get("id") || "";
        const j = getJob(id);
        if (!j) return sendJson(res, 404, { ok: false, error: "Không tìm thấy tiến trình." });
        return sendJson(res, 200, { ok: true, job: j });
      }

      if (pathname === "/api/cli/job/input" && req.method === "POST") {
        const body = await readJsonBody(req);
        return sendJson(res, 200, sendJobInput(body.id, body.text));
      }

      if (pathname === "/api/cli/job/stop" && req.method === "POST") {
        const body = await readJsonBody(req);
        return sendJson(res, 200, stopJob(body.id));
      }

      if (pathname === "/api/cli/ping" && req.method === "POST") {
        const body = await readJsonBody(req);
        const out = await pingEngine(body.engine, body.model || "");
        return sendJson(res, 200, out);
      }

      if (pathname === "/api/cli/translate" && req.method === "POST") {
        const body = await readJsonBody(req);
        const eng = getEngine(body.engine);
        if (!eng) return sendJson(res, 400, { ok: false, error: `Nền tảng không hợp lệ: ${body.engine}` });
        if (!body.prompt) return sendJson(res, 400, { ok: false, error: "Thiếu prompt" });
        const text = await eng.translate(body.prompt, body.model || "");
        return sendJson(res, 200, { ok: true, engine: eng.id, text });
      }

      // Save built PDF/QA files directly into a clean Windows output folder
      if (pathname === "/api/output/save" && req.method === "POST") {
        const body = await readJsonBody(req);
        const baseName = String(body.folderName || `PDF-${Date.now()}`).replace(/[<>:"/\\|?*]+/g, "_");
        const cfg = getPublicConfig();
        const rootOut = body.outputDir || cfg.outputDir || defaultOutputDir();
        const targetDir = path.join(rootOut, baseName);
        fs.mkdirSync(targetDir, { recursive: true });
        const saved = [];
        for (const f of body.files || []) {
          const safeFile = path.basename(String(f.name || "output.pdf"));
          const dest = path.join(targetDir, safeFile);
          fs.writeFileSync(dest, Buffer.from(String(f.base64 || ""), "base64"));
          saved.push({ name: safeFile, path: dest, size: fs.statSync(dest).size });
        }
        return sendJson(res, 200, { ok: true, dir: targetDir, files: saved });
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

      sendJson(res, 404, { ok: false, error: "Route not found" });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err && err.message ? err.message : String(err) });
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
