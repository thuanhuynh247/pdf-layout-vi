// server/config-store.mjs — Persistent Desktop App settings, active AI connector & API key vault
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function configDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "pdf-layout-vi");
}

function configPath() {
  return path.join(configDir(), "desktop-config.json");
}

export function defaultOutputDir() {
  const dir = path.join(os.homedir(), "Documents", "PDF-Layout-VI");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function readRaw() {
  const defaults = {
    activeEngine: "codex",
    chunkChars: 7000,
    outputDir: defaultOutputDir(),
    models: {},
    apiKeys: {},
  };
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      ...defaults,
      ...parsed,
      models: { ...defaults.models, ...(parsed.models || {}) },
      apiKeys: { ...defaults.apiKeys, ...(parsed.apiKeys || {}) },
    };
  } catch {
    return defaults;
  }
}

function writeRaw(cfg) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
  return cfg;
}

export function getConfig() {
  return readRaw();
}

export function getPublicConfig() {
  const cfg = readRaw();
  const maskedKeys = {};
  for (const [k, v] of Object.entries(cfg.apiKeys || {})) {
    const s = String(v || "").trim();
    if (!s) continue;
    maskedKeys[k] = {
      configured: true,
      preview: s.length > 10 ? `${s.slice(0, 5)}…${s.slice(-4)}` : "••••••",
    };
  }
  return {
    activeEngine: cfg.activeEngine || "codex",
    chunkChars: Number(cfg.chunkChars) || 7000,
    outputDir: cfg.outputDir || defaultOutputDir(),
    models: cfg.models || {},
    apiKeys: maskedKeys,
    configFile: configPath(),
  };
}

export function updateConfig(patch = {}) {
  const cur = readRaw();
  if (typeof patch.activeEngine === "string" && patch.activeEngine.trim()) {
    cur.activeEngine = patch.activeEngine.trim();
  }
  if (patch.chunkChars !== undefined) {
    const n = Number(patch.chunkChars);
    if (Number.isFinite(n) && n >= 1500 && n <= 20000) cur.chunkChars = Math.round(n);
  }
  if (typeof patch.outputDir === "string" && patch.outputDir.trim()) {
    cur.outputDir = patch.outputDir.trim();
  }
  if (patch.models && typeof patch.models === "object") {
    for (const [k, v] of Object.entries(patch.models)) {
      if (v === null || v === "") delete cur.models[k];
      else cur.models[k] = String(v).trim();
    }
  }
  if (patch.apiKeys && typeof patch.apiKeys === "object") {
    for (const [k, v] of Object.entries(patch.apiKeys)) {
      if (v === null || v === "") delete cur.apiKeys[k];
      else cur.apiKeys[k] = String(v).trim();
    }
  }
  writeRaw(cur);
  return getPublicConfig();
}
