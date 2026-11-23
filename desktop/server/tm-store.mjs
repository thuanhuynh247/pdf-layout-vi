// server/tm-store.mjs — Local persistent Translation Memory (TM) cache for 0ms exact-match reuse
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_TM_ENTRIES = 50000;

function dataDir() {
  if (process.env.PDF_LAYOUT_DATA_DIR) return path.resolve(process.env.PDF_LAYOUT_DATA_DIR);
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "pdf-layout-vi");
}

function tmPath() {
  return path.join(dataDir(), "translation-memory.json");
}

export function normalizeTmKey(text, dir = "en-vi") {
  const clean = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!clean) return "";
  return `${dir || "en-vi"}|${clean}`;
}

function readStore() {
  try {
    const p = tmPath();
    if (!fs.existsSync(p)) return { version: 1, updatedAt: null, entries: {} };
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!parsed || typeof parsed.entries !== "object") {
      return { version: 1, updatedAt: null, entries: {} };
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: null, entries: {} };
  }
}

function writeStore(store) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = tmPath();
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, target);
}

export function lookupTm(items = [], dir = "en-vi") {
  const store = readStore();
  const entries = store.entries || {};
  const hits = {};
  const misses = [];
  for (const it of items) {
    const src = String(it && it.text ? it.text : "");
    const key = normalizeTmKey(src, dir);
    const hit = key ? entries[key] : null;
    if (hit && hit.dst) {
      hits[it.id] = hit.dst;
    } else {
      misses.push(it);
    }
  }
  return {
    hits,
    misses,
    hitCount: Object.keys(hits).length,
    totalChecked: items.length,
  };
}

export function saveTmEntries(pairs = [], dir = "en-vi", engine = "") {
  const store = readStore();
  const entries = store.entries || {};
  const now = new Date().toISOString();
  let added = 0;
  for (const p of pairs) {
    const src = String(p && p.src ? p.src : "").trim();
    const dst = String(p && p.dst ? p.dst : "").trim();
    if (!src || !dst || src.length < 2) continue;
    const key = normalizeTmKey(src, dir);
    if (!key) continue;
    if (!entries[key]) added++;
    entries[key] = { src, dst, dir, engine: engine || "", updatedAt: now };
  }
  // Evict oldest entries if cap exceeded
  const keys = Object.keys(entries);
  if (keys.length > MAX_TM_ENTRIES) {
    keys
      .sort((a, b) => String(entries[a].updatedAt || "").localeCompare(String(entries[b].updatedAt || "")))
      .slice(0, keys.length - MAX_TM_ENTRIES)
      .forEach((k) => delete entries[k]);
  }
  store.entries = entries;
  store.updatedAt = now;
  writeStore(store);
  return { count: Object.keys(entries).length, added, updatedAt: now };
}

export function getTmStats() {
  const p = tmPath();
  const store = readStore();
  const entries = store.entries || {};
  const count = Object.keys(entries).length;
  let bytes = 0;
  try { if (fs.existsSync(p)) bytes = fs.statSync(p).size; } catch { /* ignore */ }
  return { count, bytes, updatedAt: store.updatedAt, path: p };
}

export function exportTmEntries() {
  const store = readStore();
  return Object.values(store.entries || {});
}

export function clearTm() {
  writeStore({ version: 1, updatedAt: new Date().toISOString(), entries: {} });
  return { ok: true, count: 0 };
}
