// server/history-store.mjs — Persistent Project History Library for translated PDF jobs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_HISTORY = 200;

function dataDir() {
  if (process.env.PDF_LAYOUT_DATA_DIR) return path.resolve(process.env.PDF_LAYOUT_DATA_DIR);
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "pdf-layout-vi");
}

function historyPath() {
  return path.join(dataDir(), "history.json");
}

function readRaw() {
  try {
    const p = historyPath();
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(list) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = historyPath();
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

export function listHistory() {
  return readRaw();
}

export function addHistoryEntry(entry = {}) {
  const list = readRaw();
  const item = {
    id: entry.id || `hist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: entry.createdAt || new Date().toISOString(),
    pdfName: String(entry.pdfName || "document.pdf"),
    huong: entry.huong === "vi-en" ? "vi-en" : "en-vi",
    pages: Number(entry.pages || 0),
    segments: Number(entry.segments || 0),
    words: Number(entry.words || 0),
    engine: String(entry.engine || ""),
    model: String(entry.model || ""),
    tmHitPct: Number(entry.tmHitPct || 0),
    qaPass: Boolean(entry.qaPass),
    qaPassedCount: Number(entry.qaPassedCount || 0),
    qaTotalCount: Number(entry.qaTotalCount || 0),
    outputDir: String(entry.outputDir || ""),
    files: Array.isArray(entry.files)
      ? entry.files.slice(0, 12).map((f) => ({
          name: String(f.name || ""),
          path: String(f.path || ""),
          size: Number(f.size || 0),
        }))
      : [],
  };
  const updated = [item, ...list.filter((x) => x.id !== item.id)].slice(0, MAX_HISTORY);
  writeRaw(updated);
  return item;
}

export function deleteHistoryEntry(id) {
  const list = readRaw();
  const next = list.filter((x) => x.id !== id);
  writeRaw(next);
  return { ok: true, remaining: next.length };
}

export function clearHistory() {
  writeRaw([]);
  return { ok: true, remaining: 0 };
}
