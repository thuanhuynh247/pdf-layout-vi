// server/index.mjs — Zero-dependency local HTTP + AI CLI bridge for PDF Layout VI Desktop
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listEngines, getEngine, startLogin, startInstall } from "./drivers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveUiDir() {
  if (process.env.PDF_LAYOUT_UI_DIR && fs.existsSync(process.env.PDF_LAYOUT_UI_DIR)) {
    return process.env.PDF_LAYOUT_UI_DIR;
  }
  const packagedUi = path.resolve(__dirname, "..", "app-ui");
  if (fs.existsSync(path.join(packagedUi, "dich.html"))) return packagedUi;
  return path.resolve(__dirname, "..", "..");
}

const UI_DIR = resolveUiDir();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".whl": "application/zip",
  ".zip": "application/zip",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
  ".py": "text/x-python; charset=utf-8",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const CLEAN_ROUTES = {
  "/": "index.html",
  "/index": "index.html",
  "/dich": "dich.html",
  "/chat-luong": "chat-luong.html",
  "/dung-voi-claude": "dung-voi-claude.html",
  "/privacy": "privacy.html",
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

function readJsonBody(req, maxBytes = 4 * 1024 * 1024) {
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

function serveStatic(req, res, pathname) {
  const mapped = CLEAN_ROUTES[pathname];
  let rel = mapped || pathname.replace(/^\/+/, "");
  try { rel = decodeURIComponent(rel); } catch { /* ignore */ }
  const full = path.resolve(UI_DIR, rel);
  if (!full.startsWith(path.resolve(UI_DIR))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  let target = full;
  if (!fs.existsSync(target) && !path.extname(target) && fs.existsSync(target + ".html")) {
    target = target + ".html";
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found: " + pathname);
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  fs.createReadStream(target).pipe(res);
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
          version: "3.3.0",
          platform: process.platform,
          uiDir: UI_DIR,
        });
      }

      if (pathname === "/api/cli/engines" && req.method === "GET") {
        const engines = await listEngines();
        return sendJson(res, 200, { ok: true, engines });
      }

      if (pathname === "/api/cli/login" && req.method === "POST") {
        const body = await readJsonBody(req);
        const launch = startLogin(body.engine);
        return sendJson(res, 200, { ok: true, ...launch });
      }

      if (pathname === "/api/cli/install" && req.method === "POST") {
        const body = await readJsonBody(req);
        const launch = startInstall(body.engine);
        return sendJson(res, 200, { ok: true, ...launch });
      }

      if (pathname === "/api/cli/translate" && req.method === "POST") {
        const body = await readJsonBody(req);
        const eng = getEngine(body.engine);
        if (!eng) return sendJson(res, 400, { ok: false, error: `Engine không hợp lệ: ${body.engine}` });
        if (!body.prompt) return sendJson(res, 400, { ok: false, error: "Thiếu prompt" });
        const text = await eng.translate(body.prompt, body.model || "");
        return sendJson(res, 200, { ok: true, engine: eng.id, text });
      }

      if (req.method === "GET" || req.method === "HEAD") {
        return serveStatic(req, res, pathname);
      }

      sendJson(res, 404, { ok: false, error: "Route not found" });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err && err.message ? err.message : String(err) });
    }
  });
}

// Start directly when executed as standalone script or ELECTRON_RUN_AS_NODE child
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
