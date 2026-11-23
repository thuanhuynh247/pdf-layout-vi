// drivers.mjs — Unified AI CLI & API drivers, OAuth streaming jobs, installer jobs, and translation runner
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { cleanChildEnv, resolveExecutable } from "./env-path.mjs";
import { getConfig } from "./config-store.mjs";

const isWin = process.platform === "win32";
const home = os.homedir();

function vaultEnv() {
  const cfg = getConfig();
  const keys = cfg.apiKeys || {};
  const extra = {};
  if (keys.OPENAI_API_KEY) extra.OPENAI_API_KEY = keys.OPENAI_API_KEY;
  if (keys.ANTHROPIC_API_KEY) extra.ANTHROPIC_API_KEY = keys.ANTHROPIC_API_KEY;
  if (keys.GEMINI_API_KEY) extra.GEMINI_API_KEY = keys.GEMINI_API_KEY;
  if (keys.OPENROUTER_API_KEY) extra.OPENROUTER_API_KEY = keys.OPENROUTER_API_KEY;
  return extra;
}

function getKeyValue(name) {
  const cfg = getConfig();
  return (cfg.apiKeys && cfg.apiKeys[name]) || process.env[name] || "";
}

function runCmd(bin, args, { input = null, timeoutMs = 15000, extraEnv = {}, cwd = undefined } = {}) {
  return new Promise((resolve) => {
    const resolved = resolveExecutable(bin);
    if (!resolved) {
      return resolve({ ok: false, code: -1, stdout: "", stderr: `Executable not found: ${bin}` });
    }
    const needCmd = isWin && /\.(cmd|bat)$/i.test(resolved);
    const spawnBin = needCmd ? (process.env.ComSpec || "cmd.exe") : resolved;
    const spawnArgs = needCmd ? ["/d", "/c", resolved, ...args] : args;
    const child = spawn(spawnBin, spawnArgs, {
      shell: false,
      windowsHide: true,
      cwd: cwd || os.tmpdir(),
      env: cleanChildEnv({ ...vaultEnv(), ...extraEnv }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      resolve({ ok: false, code: -2, stdout, stderr: (stderr + "\nTimeout after " + timeoutMs + "ms").trim() });
    }, timeoutMs);

    child.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code ?? -1, stdout, stderr });
    });
    if (input !== null && input !== undefined) {
      try {
        child.stdin.write(String(input), "utf8");
        child.stdin.end();
      } catch { /* ignore */ }
    } else {
      try { child.stdin.end(); } catch { /* ignore */ }
    }
  });
}

function fileExistsNonEmpty(p) {
  try {
    if (!fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    return st.isFile() && st.size > 4;
  } catch { return false; }
}

function getOllamaTags(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:11434/api/tags", { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d.toString("utf8"); });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const models = (parsed.models || []).map((m) => m.name).filter(Boolean);
          resolve({ up: true, models });
        } catch {
          resolve({ up: false, models: [] });
        }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ up: false, models: [] }); });
    req.on("error", () => resolve({ up: false, models: [] }));
  });
}

function runOllamaGenerate(model, prompt, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: model || "qwen2.5:14b",
      prompt,
      stream: false,
      options: { temperature: 0 },
    });
    const req = http.request("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d.toString("utf8"); });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`Ollama HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try {
          const d = JSON.parse(body);
          if (!d.response) return reject(new Error("Ollama trả về rỗng."));
          resolve(d.response);
        } catch (e) {
          reject(new Error("Lỗi đọc JSON từ Ollama: " + e.message));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Ollama timeout.")); });
    req.on("error", (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

function geminiThinkingConfig(model) {
  const m = String(model || "").toLowerCase();
  if (m.startsWith("gemini-3")) {
    return /pro/.test(m) ? { thinkingLevel: "low" } : { thinkingLevel: "minimal" };
  }
  if (m.startsWith("gemini-2.5")) {
    return /pro/.test(m) ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
  }
  return null;
}

async function runGeminiApi(prompt, model, tries = 0) {
  const key = getKeyValue("GEMINI_API_KEY") || process.env.GOOGLE_API_KEY || "";
  if (!key) throw new Error("Chưa nhập khóa Google Gemini API (GEMINI_API_KEY).");
  const mdl = String(model || "gemini-2.5-flash").replace(/^models\//, "");
  const generationConfig = {
    temperature: 0,
    maxOutputTokens: 16384,
    responseMimeType: "application/json",
  };
  const tcfg = geminiThinkingConfig(mdl);
  if (tcfg) generationConfig.thinkingConfig = tcfg;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined,
    }
  );
  if ((res.status === 429 || res.status >= 500) && tries < 3) {
    await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, tries)));
    return runGeminiApi(prompt, mdl, tries + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rawMsg = (data.error && data.error.message) || `Gemini API HTTP ${res.status}`;
    if (res.status === 404) {
      throw new Error(`Mô hình ${mdl} không còn khả dụng (404). Hãy dùng gemini-2.5-flash hoặc gemini-3-flash-preview.`);
    }
    if (res.status === 429) {
      throw new Error(`Vượt hạn mức Gemini API (429) với ${mdl}. Thử gemini-2.5-flash / gemini-3-flash-preview hoặc kiểm tra gói Google AI.`);
    }
    throw new Error(rawMsg.slice(0, 320));
  }
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = parts ? parts.map((p) => p.text || "").join("").trim() : "";
  if (!text) throw new Error("Google Gemini API không trả nội dung.");
  return text;
}

function extractGeminiCliError(stderr) {
  const txt = String(stderr || "").trim();
  const m = /Full report available at:\s*([^\r\n]+)/i.exec(txt);
  if (m && m[1]) {
    const p = m[1].trim();
    try {
      if (fs.existsSync(p)) {
        const rep = JSON.parse(fs.readFileSync(p, "utf8"));
        const msg = rep?.error?.message || rep?.message || "";
        if (msg) return String(msg).slice(0, 320);
      }
    } catch { /* ignore */ }
  }
  return (txt || "Gemini CLI thất bại").slice(0, 400);
}

async function runOpenRouter(prompt, model) {
  const key = getKeyValue("OPENROUTER_API_KEY");
  if (!key) throw new Error("Chưa nhập khóa OpenRouter API.");
  const mdl = model || "google/gemini-2.5-flash";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://pdf.huynhanhthuan.com",
      "X-Title": "PDF Layout VI Desktop",
    },
    body: JSON.stringify({
      model: mdl,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || `OpenRouter HTTP ${res.status}`);
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("OpenRouter không trả nội dung.");
  return text.trim();
}

export function openExternalUrl(url) {
  if (!url) return;
  if (isWin) {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, windowsHide: true, stdio: "ignore" }).unref();
  }
}

export function launchInteractiveCommand(cmdLine, title = "PDF Layout VI - AI CLI") {
  if (isWin) {
    const child = spawn("cmd.exe", ["/c", "start", `"${title}"`, "cmd.exe", "/k", cmdLine], {
      detached: true,
      windowsHide: false,
      stdio: "ignore",
      env: cleanChildEnv(vaultEnv()),
    });
    child.unref();
    return { launched: true, mode: "windows-console" };
  }
  return { launched: false, mode: "manual", command: cmdLine };
}

// Track live streaming CLI auth & install jobs inside Desktop UI
const JOBS = new Map();
let jobSeq = 0;

function stripAnsi(s) {
  return String(s || "").replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function startStreamJob(kind, engineId, binOrShell, args = [], { autoOpenUrl = false, usePowerShell = false } = {}) {
  const id = `job-${++jobSeq}-${Date.now().toString(36)}`;
  const job = {
    id,
    kind,
    engine: engineId,
    status: "running",
    code: null,
    output: "",
    urls: [],
    needsInput: false,
    startedAt: Date.now(),
    child: null,
  };
  JOBS.set(id, job);

  let spawnBin = binOrShell;
  let spawnArgs = args;
  if (usePowerShell && isWin) {
    spawnBin = "powershell.exe";
    spawnArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", binOrShell];
  } else {
    const resolved = resolveExecutable(binOrShell);
    if (!resolved) {
      job.status = "error";
      job.code = -1;
      job.output = `Không tìm thấy lệnh: ${binOrShell}`;
      return { id, status: job.status, output: job.output };
    }
    const needCmd = isWin && /\.(cmd|bat)$/i.test(resolved);
    spawnBin = needCmd ? (process.env.ComSpec || "cmd.exe") : resolved;
    spawnArgs = needCmd ? ["/d", "/c", resolved, ...args] : args;
  }

  const child = spawn(spawnBin, spawnArgs, {
    shell: false,
    windowsHide: true,
    cwd: os.tmpdir(),
    env: cleanChildEnv(vaultEnv()),
    stdio: ["pipe", "pipe", "pipe"],
  });
  job.child = child;

  const onChunk = (chunk) => {
    const text = stripAnsi(chunk.toString("utf8"));
    job.output = (job.output + text).slice(-24000);
    const matches = job.output.match(/https?:\/\/[^\s"'<>]+/g) || [];
    for (const u of matches) {
      if (!job.urls.includes(u)) {
        job.urls.push(u);
        if (autoOpenUrl && /(oauth|authorize|device|login|auth|google\.com|claude\.com|openai\.com)/i.test(u)) {
          openExternalUrl(u);
        }
      }
    }
    if (/(paste code|enter code|authorization code|paste.*>|user_code)/i.test(job.output)) {
      job.needsInput = true;
    }
  };

  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);
  child.on("error", (err) => {
    job.status = "error";
    job.code = -1;
    job.output += `\n[Lỗi] ${err.message}\n`;
  });
  child.on("close", (code) => {
    job.code = code ?? -1;
    job.status = code === 0 ? "done" : "error";
    job.child = null;
  });

  // Auto-timeout stale interactive jobs after 10 minutes
  setTimeout(() => {
    if (job.child && job.status === "running") {
      try { job.child.kill(); } catch { /* ignore */ }
      job.status = "timeout";
    }
  }, 600000).unref();

  return { id, kind, engine: engineId, status: job.status };
}

export function getJob(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  return {
    id: j.id,
    kind: j.kind,
    engine: j.engine,
    status: j.status,
    code: j.code,
    output: j.output,
    urls: j.urls,
    needsInput: j.needsInput,
    startedAt: j.startedAt,
  };
}

export function sendJobInput(id, text) {
  const j = JOBS.get(id);
  if (!j || !j.child || j.status !== "running") {
    throw new Error("Phiên CLI không còn chạy.");
  }
  j.child.stdin.write(String(text || "") + "\n", "utf8");
  j.needsInput = false;
  return { ok: true };
}

export function stopJob(id) {
  const j = JOBS.get(id);
  if (j && j.child) {
    try { j.child.kill(); } catch { /* ignore */ }
    j.status = "stopped";
    j.child = null;
  }
  return { ok: true };
}

export const ENGINES = [
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    vendor: "OpenAI · ChatGPT Plus/Pro",
    category: "cli",
    tier: "primary",
    envKeyName: "OPENAI_API_KEY",
    envKeyLabel: "OpenAI API Key (tùy chọn nếu đã login ChatGPT)",
    defaultModel: "",
    models: ["gpt-5.4-mini", "gpt-5.4", "o4-mini"],
    installCmd: "npm install -g @openai/codex@latest",
    loginCmd: "codex login",
    loginArgs: ["login"],
    supportsStreamAuth: true,
    detect: async () => {
      const bin = resolveExecutable(["codex"]);
      const keySet = Boolean(getKeyValue("OPENAI_API_KEY"));
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài @openai/codex" };
      const st = await runCmd(bin, ["login", "status"], { timeoutMs: 8000 });
      const text = (st.stdout + "\n" + st.stderr).trim();
      const hasFile = fileExistsNonEmpty(path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "auth.json"));
      const loggedIn = /logged in/i.test(text) || hasFile || keySet;
      return {
        installed: true,
        bin,
        loggedIn,
        account: /chatgpt/i.test(text) ? "ChatGPT OAuth" : keySet ? "OPENAI_API_KEY" : "",
        detail: loggedIn ? (text || "Đã đăng nhập ChatGPT/OpenAI") : "Đã cài CLI, chưa đăng nhập",
      };
    },
    translate: async (prompt, model) => {
      const tmpOut = path.join(os.tmpdir(), `ptl-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
      const args = ["exec", "-C", os.tmpdir(), "--skip-git-repo-check", "--ephemeral", "--color", "never", "-s", "read-only", "-o", tmpOut];
      if (model) args.push("-m", model);
      args.push("-");
      try {
        const res = await runCmd("codex", args, { input: prompt, timeoutMs: 180000 });
        let out = "";
        if (fs.existsSync(tmpOut)) out = fs.readFileSync(tmpOut, "utf8").trim();
        if (!out) out = res.stdout.trim();
        if (!res.ok && !out) throw new Error((res.stderr || res.stdout || "Codex thất bại").slice(0, 400));
        return out;
      } finally {
        try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch { /* ignore */ }
      }
    },
  },
  {
    id: "claude",
    name: "Claude Code CLI",
    vendor: "Anthropic · Claude Pro/Max",
    category: "cli",
    tier: "primary",
    envKeyName: "ANTHROPIC_API_KEY",
    envKeyLabel: "Anthropic API Key (tùy chọn nếu đã login OAuth)",
    defaultModel: "",
    models: ["sonnet", "haiku", "opus"],
    installCmd: "npm install -g @anthropic-ai/claude-code",
    loginCmd: "claude auth login",
    loginArgs: ["auth", "login"],
    supportsStreamAuth: true,
    detect: async () => {
      const bin = resolveExecutable(["claude"]);
      const keySet = Boolean(getKeyValue("ANTHROPIC_API_KEY"));
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài @anthropic-ai/claude-code" };
      const st = await runCmd(bin, ["auth", "status", "--json"], { timeoutMs: 8000 });
      try {
        const j = JSON.parse(st.stdout || "{}");
        const loggedIn = Boolean(j.loggedIn || keySet);
        const acct = [j.email, j.orgName].filter(Boolean).join(" · ") || (keySet ? "ANTHROPIC_API_KEY" : "");
        return {
          installed: true,
          bin,
          loggedIn,
          account: acct,
          detail: loggedIn ? (acct ? `Đã kết nối (${acct})` : "Đã đăng nhập Claude") : "Chưa đăng nhập OAuth",
        };
      } catch {
        return {
          installed: true,
          bin,
          loggedIn: keySet,
          account: keySet ? "ANTHROPIC_API_KEY" : "",
          detail: keySet ? "Đang dùng ANTHROPIC_API_KEY" : "Chưa đăng nhập OAuth",
        };
      }
    },
    translate: async (prompt, model) => {
      const args = ["-p", "--output-format", "text", "--tools", ""];
      if (model) args.push("--model", model);
      const res = await runCmd("claude", args, { input: prompt, timeoutMs: 180000 });
      if (!res.ok) throw new Error((res.stderr || res.stdout || "Claude CLI thất bại").slice(0, 400));
      return res.stdout.trim();
    },
  },
  {
    id: "gemini",
    name: "Google Gemini CLI",
    vendor: "Google · Google AI Pro (OAuth) hoặc API Key",
    category: "cli",
    tier: "primary",
    envKeyName: "GEMINI_API_KEY",
    envKeyLabel: "GEMINI_API_KEY (tùy chọn nếu đăng nhập Google AI Pro OAuth)",
    defaultModel: "",
    models: ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview"],
    installCmd: "npm install -g @google/gemini-cli",
    loginCmd: "gemini",
    loginArgs: [],
    supportsStreamAuth: false,
    detect: async () => {
      const bin = resolveExecutable(["gemini"]);
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài @google/gemini-cli" };
      const oauthOk = fileExistsNonEmpty(path.join(home, ".gemini", "oauth_creds.json"));
      const keyOk = Boolean(getKeyValue("GEMINI_API_KEY") || process.env.GOOGLE_API_KEY);
      const loggedIn = oauthOk || keyOk;
      return {
        installed: true,
        bin,
        loggedIn,
        account: oauthOk ? "Google OAuth (AI Pro)" : keyOk ? "GEMINI_API_KEY" : "",
        detail: oauthOk ? "Đã đăng nhập Google OAuth" : keyOk ? "Đã kết nối GEMINI_API_KEY" : "Mở terminal để chọn Login with Google",
      };
    },
    translate: async (prompt, model) => {
      const args = ["--skip-trust", "-p", "Hãy dịch toàn bộ các đoạn được gửi qua stdin và CHỈ trả về JSON hợp lệ.", "-o", "text"];
      if (model) args.push("-m", model);
      const res = await runCmd("gemini", args, { input: prompt, timeoutMs: 180000 });
      if (!res.ok && !res.stdout.trim()) throw new Error(extractGeminiCliError(res.stderr));
      return res.stdout.trim();
    },
  },
  {
    id: "gemini-api",
    name: "Google Gemini API (Direct)",
    vendor: "Google AI Studio · Google AI Pro API Key",
    category: "api",
    tier: "primary",
    envKeyName: "GEMINI_API_KEY",
    envKeyLabel: "Khóa Google Gemini API (AIza...)",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-3.1-pro-preview"],
    installCmd: "",
    loginCmd: "",
    supportsStreamAuth: false,
    detect: async () => {
      const hasKey = Boolean(getKeyValue("GEMINI_API_KEY") || process.env.GOOGLE_API_KEY);
      return {
        installed: true,
        bin: "https://generativelanguage.googleapis.com",
        loggedIn: hasKey,
        account: hasKey ? "GEMINI_API_KEY" : "",
        detail: hasKey
          ? "Sẵn sàng gọi trực tiếp Google Gemini REST API (nhanh, JSON chuẩn)"
          : "Nhập khóa AIza... từ aistudio.google.com/apikey để kích hoạt",
      };
    },
    translate: async (prompt, model) => runGeminiApi(prompt, model),
  },
  {
    id: "antigravity",
    name: "Antigravity ACP / CLI",
    vendor: "Google Antigravity",
    category: "cli",
    tier: "primary",
    envKeyName: "",
    defaultModel: "",
    models: ["gemini-3-flash-preview", "gemini-3.1-pro-preview", "gemini-2.5-flash"],
    installCmd: isWin
      ? "irm https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.4.3-windows-x86_64.zip -OutFile $env:TEMP\\agy.zip; Expand-Archive $env:TEMP\\agy.zip \"$env:LOCALAPPDATA\\agy\\bin\" -Force"
      : "brew install antigravity",
    loginCmd: "agy auth login",
    loginArgs: ["auth", "login"],
    supportsStreamAuth: true,
    detect: async () => {
      const bin = resolveExecutable(["agy_acp_server", "agy"]);
      const agyDir = path.join(home, ".gemini", "antigravity");
      const hasAuth = fs.existsSync(agyDir);
      return {
        installed: Boolean(bin),
        bin,
        loggedIn: Boolean(bin && hasAuth),
        account: hasAuth ? "Antigravity Profile" : "",
        detail: bin ? (hasAuth ? "Đã sẵn sàng Antigravity ACP" : "Đã cài, cần đăng nhập") : "Chưa cài agy CLI",
      };
    },
    translate: async (prompt, model) => {
      const bin = resolveExecutable(["agy", "gemini"]);
      if (!bin) throw new Error("Chưa cài Antigravity/Gemini CLI.");
      const args = ["-p", "Chỉ trả về JSON bản dịch hợp lệ theo stdin.", "-o", "text"];
      if (/gemini/i.test(bin)) {
        args.unshift("--skip-trust");
        if (model) args.push("-m", model);
      }
      const res = await runCmd(bin, args, { input: prompt, timeoutMs: 180000 });
      if (!res.ok && !res.stdout.trim()) throw new Error((res.stderr || "Antigravity CLI lỗi").slice(0, 400));
      return res.stdout.trim();
    },
  },
  {
    id: "muse",
    name: "Meta Muse Code",
    vendor: "Meta AI",
    category: "cli",
    tier: "primary",
    envKeyName: "",
    defaultModel: "",
    models: [],
    installCmd: isWin ? "irm https://dev.meta.ai/install.ps1 | iex" : "curl -fsSL https://dev.meta.ai/install.sh | sh",
    loginCmd: "muse login",
    loginArgs: ["login"],
    supportsStreamAuth: true,
    detect: async () => {
      const bin = resolveExecutable(["muse", "muse-code"]);
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài đặt (bấm Cài CLI)" };
      const st = await runCmd(bin, ["auth", "status"], { timeoutMs: 8000 });
      const loggedIn = st.ok || fileExistsNonEmpty(path.join(home, ".muse", "auth.json"));
      return { installed: true, bin, loggedIn, detail: loggedIn ? "Đã kết nối Meta Muse" : "Đã cài, bấm Đăng nhập" };
    },
    translate: async (prompt, model) => {
      const bin = resolveExecutable(["muse", "muse-code"]);
      if (!bin) throw new Error("Chưa cài Meta Muse Code.");
      const args = ["-p", "Translate the JSON batch provided on stdin and output ONLY valid JSON."];
      if (model) args.push("--model", model);
      const res = await runCmd(bin, args, { input: prompt, timeoutMs: 180000 });
      if (!res.ok && !res.stdout.trim()) throw new Error((res.stderr || "Muse CLI lỗi").slice(0, 400));
      return res.stdout.trim();
    },
  },
  {
    id: "ollama",
    name: "Ollama (Offline Local)",
    vendor: "100% Ngoại tuyến trên CPU/GPU máy bạn",
    category: "local",
    tier: "primary",
    envKeyName: "",
    defaultModel: "qwen2.5:14b",
    models: ["qwen2.5:14b", "gemma3:12b", "llama3.3"],
    installCmd: isWin ? "winget install Ollama.Ollama" : "curl -fsSL https://ollama.com/install.sh | sh",
    loginCmd: "ollama serve",
    loginArgs: ["serve"],
    supportsStreamAuth: false,
    detect: async () => {
      const bin = resolveExecutable(["ollama"]);
      const tags = await getOllamaTags();
      return {
        installed: Boolean(bin) || tags.up,
        bin: bin || "http://127.0.0.1:11434",
        loggedIn: tags.up && tags.models.length > 0,
        models: tags.models,
        account: tags.up ? `${tags.models.length} mô hình cục bộ` : "",
        detail: tags.up
          ? tags.models.length
            ? `Đang chạy · ${tags.models.slice(0, 3).join(", ")}`
            : "Server đang chạy nhưng chưa tải mô hình (ollama pull qwen2.5:14b)"
          : bin
            ? "Đã cài Ollama, chưa bật dịch vụ"
            : "Chưa cài Ollama",
      };
    },
    translate: async (prompt, model) => runOllamaGenerate(model || "qwen2.5:14b", prompt),
  },
  {
    id: "opencode",
    name: "OpenCode CLI",
    vendor: "Open Source · Multi-provider",
    category: "cli",
    tier: "recommended",
    envKeyName: "",
    defaultModel: "",
    models: [],
    installCmd: "npm install -g opencode-ai",
    loginCmd: "opencode auth login",
    loginArgs: ["auth", "login"],
    supportsStreamAuth: false,
    detect: async () => {
      const bin = resolveExecutable(["opencode"]);
      const authExists = fileExistsNonEmpty(path.join(home, ".local", "share", "opencode", "auth.json"));
      return {
        installed: Boolean(bin),
        bin,
        loggedIn: Boolean(bin && authExists),
        detail: bin ? (authExists ? "Đã cấu hình" : "Đã cài, cần đăng nhập") : "Chưa cài đặt",
      };
    },
    translate: async (prompt, model) => {
      const args = ["run"];
      if (model) args.push("-m", model);
      args.push("Translate the batch from stdin and return ONLY valid JSON.");
      const res = await runCmd("opencode", args, { input: prompt, timeoutMs: 180000 });
      if (!res.ok && !res.stdout.trim()) throw new Error((res.stderr || "OpenCode lỗi").slice(0, 400));
      return res.stdout.trim();
    },
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    vendor: "GitHub",
    category: "cli",
    tier: "recommended",
    envKeyName: "",
    defaultModel: "",
    models: [],
    installCmd: "npm install -g @github/copilot",
    loginCmd: "gh auth login",
    loginArgs: ["auth", "login"],
    supportsStreamAuth: false,
    detect: async () => {
      const copilotBin = resolveExecutable(["copilot"]);
      const ghBin = resolveExecutable(["gh"]);
      if (!copilotBin && !ghBin) return { installed: false, loggedIn: false, detail: "Chưa cài đặt" };
      const st = ghBin ? await runCmd(ghBin, ["auth", "status"], { timeoutMs: 6000 }) : { ok: false };
      return {
        installed: Boolean(copilotBin),
        bin: copilotBin || ghBin,
        loggedIn: Boolean(copilotBin) && st.ok,
        detail: copilotBin ? (st.ok ? "GitHub đã đăng nhập" : "Cần đăng nhập gh") : "Có gh CLI, chưa cài @github/copilot",
      };
    },
    translate: async (prompt, model) => {
      const args = ["-p", "Read stdin and output ONLY valid JSON translation."];
      if (model) args.push("--model", model);
      const res = await runCmd("copilot", args, { input: prompt, timeoutMs: 180000 });
      if (!res.ok && !res.stdout.trim()) throw new Error((res.stderr || "Copilot CLI lỗi").slice(0, 400));
      return res.stdout.trim();
    },
  },
  {
    id: "qwen",
    name: "Qwen Code CLI",
    vendor: "Alibaba Qwen",
    category: "cli",
    tier: "recommended",
    envKeyName: "",
    defaultModel: "",
    models: [],
    installCmd: "npm install -g @qwen-code/qwen-code",
    loginCmd: "qwen",
    loginArgs: [],
    supportsStreamAuth: false,
    detect: async () => {
      const bin = resolveExecutable(["qwen"]);
      return { installed: Boolean(bin), bin, loggedIn: Boolean(bin), detail: bin ? "Đã cài đặt" : "Chưa cài đặt" };
    },
    translate: async (prompt, model) => {
      const args = ["-p", "Read stdin and output ONLY valid JSON.", "-o", "text"];
      if (model) args.push("-m", model);
      const res = await runCmd("qwen", args, { input: prompt, timeoutMs: 180000 });
      if (!res.ok && !res.stdout.trim()) throw new Error((res.stderr || "Qwen CLI lỗi").slice(0, 400));
      return res.stdout.trim();
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter API (Cloud)",
    vendor: "API Key · Thanh toán theo lượt",
    category: "api",
    tier: "recommended",
    envKeyName: "OPENROUTER_API_KEY",
    envKeyLabel: "Khóa OpenRouter (sk-or-...)",
    defaultModel: "google/gemini-2.5-flash",
    models: [
      "google/gemini-2.5-flash",
      "google/gemini-3-flash-preview",
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-4.1-mini",
      "deepseek/deepseek-chat-v3.1",
    ],
    installCmd: "",
    loginCmd: "",
    supportsStreamAuth: false,
    detect: async () => {
      const hasKey = Boolean(getKeyValue("OPENROUTER_API_KEY"));
      return {
        installed: true,
        bin: "https://openrouter.ai",
        loggedIn: hasKey,
        account: hasKey ? "API Key đã lưu cục bộ" : "",
        detail: hasKey ? "Sẵn sàng gửi qua OpenRouter" : "Nhập khóa sk-or-... bên phải để kích hoạt",
      };
    },
    translate: async (prompt, model) => runOpenRouter(prompt, model),
  },
];

export async function listEngines() {
  const results = await Promise.all(
    ENGINES.map(async (e) => {
      let status = { installed: false, loggedIn: false, detail: "" };
      try {
        status = await e.detect();
      } catch (err) {
        status = { installed: false, loggedIn: false, detail: err.message };
      }
      return {
        id: e.id,
        name: e.name,
        vendor: e.vendor,
        category: e.category,
        tier: e.tier,
        envKeyName: e.envKeyName || "",
        envKeyLabel: e.envKeyLabel || "",
        defaultModel: e.defaultModel,
        models: status.models && status.models.length ? status.models : e.models,
        installCmd: e.installCmd,
        loginCmd: e.loginCmd,
        supportsStreamAuth: Boolean(e.supportsStreamAuth),
        installed: Boolean(status.installed),
        loggedIn: Boolean(status.loggedIn),
        bin: status.bin || "",
        account: status.account || "",
        detail: status.detail || "",
      };
    })
  );
  return results;
}

export function getEngine(id) {
  return ENGINES.find((e) => e.id === id) || null;
}

export function startLogin(id, { mode = "stream" } = {}) {
  const eng = getEngine(id);
  if (!eng) throw new Error(`Không rõ nền tảng: ${id}`);
  if (!eng.loginCmd) throw new Error(`${eng.name} dùng API Key, không cần lệnh OAuth.`);
  if (mode === "terminal" || !eng.supportsStreamAuth) {
    return launchInteractiveCommand(eng.loginCmd, `Dang nhap ${eng.name}`);
  }
  const bin = eng.loginCmd.split(/\s+/)[0];
  return startStreamJob("login", eng.id, bin, eng.loginArgs || [], { autoOpenUrl: true });
}

export function startInstall(id, { mode = "stream" } = {}) {
  const eng = getEngine(id);
  if (!eng) throw new Error(`Không rõ nền tảng: ${id}`);
  if (!eng.installCmd) throw new Error(`${eng.name} không cần cài CLI.`);
  if (mode === "terminal") {
    if (isWin && (eng.installCmd.includes("irm ") || eng.installCmd.includes("$env:"))) {
      return launchInteractiveCommand(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${eng.installCmd.replace(/"/g, '\\"')}"`, `Cai dat ${eng.name}`);
    }
    return launchInteractiveCommand(eng.installCmd, `Cai dat ${eng.name}`);
  }
  if (isWin && (eng.installCmd.includes("irm ") || eng.installCmd.includes("$env:") || eng.installCmd.includes("winget "))) {
    return startStreamJob("install", eng.id, eng.installCmd, [], { usePowerShell: true });
  }
  const parts = eng.installCmd.split(/\s+/);
  return startStreamJob("install", eng.id, parts[0], parts.slice(1));
}

export async function pingEngine(id, model) {
  const eng = getEngine(id);
  if (!eng) throw new Error(`Không rõ nền tảng: ${id}`);
  const t0 = Date.now();
  const reply = await eng.translate('Return ONLY valid JSON: {"ok": "Xin chào"}. Input: "Hello"', model || "");
  return {
    ok: true,
    engine: eng.id,
    latencyMs: Date.now() - t0,
    reply,
  };
}
