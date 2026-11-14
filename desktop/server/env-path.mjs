// env-path.mjs — Windows & cross-platform CLI discovery inspired by OpenMausBot (server/env-path.ts)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const isWin = process.platform === "win32";

function pushIfDir(list, p) {
  if (!p) return;
  try {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) list.push(p);
  } catch { /* ignore */ }
}

export function windowsKnownDirs() {
  if (!isWin) return [];
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const dirs = [];
  const candidates = [
    "D:\\npm-global",
    "D:\\nodejs",
    path.join(appData, "npm"),
    path.join(localAppData, "pnpm"),
    path.join(appData, "pnpm"),
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    path.join(home, ".opencode", "bin"),
    path.join(home, ".kimi-code", "bin"),
    path.join(home, ".grok", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".muse", "bin"),
    path.join(localAppData, "agy", "bin"),
    path.join(localAppData, "cursor-agent"),
    path.join(localAppData, "Programs", "cursor-agent"),
    path.join(localAppData, "Programs", "nodejs"),
    path.join(localAppData, "Microsoft", "WinGet", "Links"),
    path.join(programFiles, "nodejs"),
    path.join(programFiles, "Git", "cmd"),
    path.join(programFilesX86, "Git", "cmd"),
  ];
  for (const c of candidates) pushIfDir(dirs, c);

  // NVM for Windows & Unix-like nvm dirs
  for (const nvmRoot of [path.join(appData, "nvm"), path.join(localAppData, "nvm"), "C:\\nvm"]) {
    try {
      if (fs.existsSync(nvmRoot)) {
        for (const ent of fs.readdirSync(nvmRoot)) {
          const full = path.join(nvmRoot, ent);
          if (ent.startsWith("v") && fs.statSync(full).isDirectory()) dirs.push(full);
        }
      }
    } catch { /* ignore */ }
  }
  return dirs;
}

export function augmentedPath(basePath = process.env.PATH || process.env.Path || "") {
  const sep = isWin ? ";" : ":";
  const parts = String(basePath).split(sep).filter(Boolean);
  const extra = isWin
    ? windowsKnownDirs()
    : [
        path.join(os.homedir(), ".local", "bin"),
        path.join(os.homedir(), ".npm-global", "bin"),
        path.join(os.homedir(), ".bun", "bin"),
        "/usr/local/bin",
        "/opt/homebrew/bin",
      ];
  const seen = new Set();
  const out = [];
  for (const d of [...parts, ...extra]) {
    const key = isWin ? d.toLowerCase() : d;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out.join(sep);
}

export function resolveExecutable(names) {
  const nameList = Array.isArray(names) ? names : [names];
  const sep = isWin ? ";" : ":";
  const dirs = augmentedPath().split(sep).filter(Boolean);
  const exts = isWin ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const rawName of nameList) {
    if (!rawName) continue;
    if (path.isAbsolute(rawName) && fs.existsSync(rawName)) return rawName;
    const hasExt = Boolean(path.extname(rawName));
    for (const dir of dirs) {
      const tryExts = hasExt ? [""] : exts;
      for (const ext of tryExts) {
        const candidate = path.join(dir, rawName + ext);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        } catch { /* ignore */ }
      }
    }
  }
  return null;
}

export function cleanChildEnv(extraEnv = {}) {
  const env = { ...process.env };
  // Strip nested-agent guard variables (OpenMausBot pattern) so spawned CLIs run cleanly
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.Path;
  env.PATH = augmentedPath(process.env.PATH || process.env.Path || "");
  Object.assign(env, extraEnv);
  return env;
}
