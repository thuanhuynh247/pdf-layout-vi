// drivers.mjs — Unified local AI CLI detection, auth status, interactive login, install & translation runner
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { cleanChildEnv, resolveExecutable } from "./env-path.mjs";

const isWin = process.platform === "win32";
const home = os.homedir();

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
      env: cleanChildEnv(extraEnv),
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

// Launch an interactive console on Windows so user can complete browser OAuth or paste one-time code cleanly
export function launchInteractiveCommand(cmdLine, title = "PDF Layout VI - Dang nhap AI CLI") {
  if (isWin) {
    const child = spawn("cmd.exe", ["/c", "start", `"${title}"`, "cmd.exe", "/k", cmdLine], {
      detached: true,
      windowsHide: false,
      stdio: "ignore",
      env: cleanChildEnv(),
    });
    child.unref();
    return { launched: true, mode: "windows-console" };
  }
  return { launched: false, mode: "manual", command: cmdLine };
}

export const ENGINES = [
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    vendor: "OpenAI (ChatGPT Plus/Pro)",
    tier: "primary",
    defaultModel: "gpt-5.4-mini",
    models: ["gpt-5.4-mini", "gpt-5.4", "o4-mini"],
    installCmd: "npm install -g @openai/codex",
    loginCmd: "codex login",
    detect: async () => {
      const bin = resolveExecutable(["codex"]);
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài đặt" };
      const st = await runCmd(bin, ["login", "status"], { timeoutMs: 8000 });
      const text = (st.stdout + "\n" + st.stderr).trim();
      const hasFile = fileExistsNonEmpty(path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "auth.json"));
      const loggedIn = /logged in/i.test(text) || hasFile || Boolean(process.env.OPENAI_API_KEY);
      return {
        installed: true,
        bin,
        loggedIn,
        detail: loggedIn ? (text || "Đã đăng nhập ChatGPT/OpenAI") : "Chưa đăng nhập",
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
    vendor: "Anthropic (Claude Pro/Max)",
    tier: "primary",
    defaultModel: "sonnet",
    models: ["sonnet", "haiku", "opus"],
    installCmd: "npm install -g @anthropic-ai/claude-code",
    loginCmd: "claude auth login",
    detect: async () => {
      const bin = resolveExecutable(["claude"]);
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài đặt" };
      const st = await runCmd(bin, ["auth", "status", "--json"], { timeoutMs: 8000 });
      try {
        const j = JSON.parse(st.stdout || "{}");
        const loggedIn = Boolean(j.loggedIn || process.env.ANTHROPIC_API_KEY);
        const acct = [j.email, j.orgName].filter(Boolean).join(" · ");
        return {
          installed: true,
          bin,
          loggedIn,
          account: acct,
          detail: loggedIn ? (acct ? `Đã đăng nhập (${acct})` : "Đã đăng nhập Claude") : "Chưa đăng nhập (bấm Đăng nhập)",
        };
      } catch {
        return {
          installed: true,
          bin,
          loggedIn: Boolean(process.env.ANTHROPIC_API_KEY),
          detail: process.env.ANTHROPIC_API_KEY ? "Đang dùng ANTHROPIC_API_KEY" : "Chưa đăng nhập",
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
    vendor: "Google (Workspace / AI Key)",
    tier: "primary",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"],
    installCmd: "npm install -g @google/gemini-cli",
    loginCmd: "gemini",
    detect: async () => {
      const bin = resolveExecutable(["gemini"]);
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài đặt" };
      const oauthOk = fileExistsNonEmpty(path.join(home, ".gemini", "oauth_creds.json"));
      const keyOk = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
      const loggedIn = oauthOk || keyOk;
      return {
        installed: true,
        bin,
        loggedIn,
        detail: oauthOk ? "Đã đăng nhập Google OAuth" : keyOk ? "Đang dùng GEMINI_API_KEY" : "Chưa đăng nhập (chọn Login with Google)",
      };
    },
    translate: async (prompt, model) => {
      const args = ["--skip-trust", "-p", "Hãy dịch toàn bộ các đoạn được gửi qua stdin và CHỈ trả về JSON hợp lệ.", "-o", "text"];
      if (model) args.push("-m", model);
      const res = await runCmd("gemini", args, { input: prompt, timeoutMs: 180000 });
      if (!res.ok && !res.stdout.trim()) throw new Error((res.stderr || "Gemini CLI thất bại").slice(0, 400));
      return res.stdout.trim();
    },
  },
  {
    id: "antigravity",
    name: "Antigravity ACP / CLI",
    vendor: "Google Antigravity",
    tier: "recommended",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "claude-sonnet-4.5"],
    installCmd: isWin
      ? "irm https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.4.3-windows-x86_64.zip -OutFile $env:TEMP\\agy.zip; Expand-Archive $env:TEMP\\agy.zip \"$env:LOCALAPPDATA\\agy\\bin\" -Force"
      : "brew install antigravity",
    loginCmd: "agy auth login",
    detect: async () => {
      const bin = resolveExecutable(["agy_acp_server", "agy"]);
      const agyDir = path.join(home, ".gemini", "antigravity");
      const hasAuth = fs.existsSync(agyDir);
      return {
        installed: Boolean(bin),
        bin,
        loggedIn: Boolean(bin && hasAuth),
        detail: bin ? (hasAuth ? "Đã cài Antigravity ACP/CLI" : "Đã cài, cần đăng nhập") : "Chưa cài agy CLI",
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
    tier: "recommended",
    defaultModel: "",
    models: [],
    installCmd: isWin ? "irm https://dev.meta.ai/install.ps1 | iex" : "curl -fsSL https://dev.meta.ai/install.sh | sh",
    loginCmd: "muse login",
    detect: async () => {
      const bin = resolveExecutable(["muse", "muse-code"]);
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài đặt (bấm Cài CLI)" };
      const st = await runCmd(bin, ["auth", "status"], { timeoutMs: 8000 });
      const loggedIn = st.ok || fileExistsNonEmpty(path.join(home, ".muse", "auth.json"));
      return { installed: true, bin, loggedIn, detail: loggedIn ? "Đã sẵn sàng" : "Đã cài, bấm Đăng nhập (muse login)" };
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
    id: "opencode",
    name: "OpenCode CLI",
    vendor: "Open Source / Multi-provider",
    tier: "recommended",
    defaultModel: "",
    models: [],
    installCmd: "npm install -g opencode-ai",
    loginCmd: "opencode auth login",
    detect: async () => {
      const bin = resolveExecutable(["opencode"]);
      const authExists = fileExistsNonEmpty(path.join(home, ".local", "share", "opencode", "auth.json"));
      return {
        installed: Boolean(bin),
        bin,
        loggedIn: Boolean(bin && authExists),
        detail: bin ? (authExists ? "Đã cấu hình" : "Đã cài, chạy opencode auth login") : "Chưa cài đặt",
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
    tier: "recommended",
    defaultModel: "",
    models: [],
    installCmd: "npm install -g @github/copilot",
    loginCmd: "gh auth login",
    detect: async () => {
      const bin = resolveExecutable(["copilot", "gh"]);
      if (!bin) return { installed: false, loggedIn: false, detail: "Chưa cài đặt" };
      const st = await runCmd("gh", ["auth", "status"], { timeoutMs: 6000 });
      const copilotBin = resolveExecutable(["copilot"]);
      const ok = Boolean(copilotBin) && st.ok;
      return {
        installed: Boolean(copilotBin),
        bin: copilotBin || bin,
        loggedIn: ok,
        detail: copilotBin ? (st.ok ? "GitHub đã đăng nhập" : "Cần đăng nhập GitHub") : "Có gh CLI, chưa cài @github/copilot",
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
    tier: "recommended",
    defaultModel: "",
    models: [],
    installCmd: "npm install -g @qwen-code/qwen-code",
    loginCmd: "qwen",
    detect: async () => {
      const bin = resolveExecutable(["qwen"]);
      return {
        installed: Boolean(bin),
        bin,
        loggedIn: Boolean(bin),
        detail: bin ? "Đã cài đặt" : "Chưa cài đặt",
      };
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
    id: "ollama",
    name: "Ollama (Offline Local LLM)",
    vendor: "100% Ngoại tuyến trên GPU/CPU máy bạn",
    tier: "recommended",
    defaultModel: "qwen2.5:14b",
    models: [],
    installCmd: isWin ? "winget install Ollama.Ollama" : "curl -fsSL https://ollama.com/install.sh | sh",
    loginCmd: "ollama serve",
    detect: async () => {
      const bin = resolveExecutable(["ollama"]);
      const tags = await getOllamaTags();
      return {
        installed: Boolean(bin) || tags.up,
        bin: bin || "http://127.0.0.1:11434",
        loggedIn: tags.up && tags.models.length > 0,
        models: tags.models,
        detail: tags.up
          ? tags.models.length
            ? `Đang chạy (${tags.models.length} mô hình nội bộ)`
            : "Ollama đang chạy nhưng chưa pull mô hình"
          : bin
            ? "Đã cài Ollama, chưa bật server"
            : "Chưa cài đặt",
      };
    },
    translate: async (prompt, model) => runOllamaGenerate(model || "qwen2.5:14b", prompt),
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
        tier: e.tier,
        defaultModel: e.defaultModel,
        models: status.models && status.models.length ? status.models : e.models,
        installCmd: e.installCmd,
        loginCmd: e.loginCmd,
        installed: Boolean(status.installed),
        loggedIn: Boolean(status.loggedIn),
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

export function startLogin(id) {
  const eng = getEngine(id);
  if (!eng) throw new Error(`Không rõ CLI: ${id}`);
  if (id === "antigravity") {
    return launchInteractiveCommand(eng.loginCmd, "Dang nhap Antigravity CLI");
  }
  return launchInteractiveCommand(eng.loginCmd, `Dang nhap ${eng.name}`);
}

export function startInstall(id) {
  const eng = getEngine(id);
  if (!eng) throw new Error(`Không rõ CLI: ${id}`);
  if (isWin && (eng.installCmd.includes("irm ") || eng.installCmd.includes("$env:"))) {
    const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${eng.installCmd.replace(/"/g, '\\"')}"`;
    return launchInteractiveCommand(psCmd, `Cai dat ${eng.name}`);
  }
  return launchInteractiveCommand(eng.installCmd, `Cai dat ${eng.name}`);
}
