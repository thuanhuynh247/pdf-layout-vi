// electron/main.mjs — Dedicated Windows Desktop Shell v4.0.0 (OpenMausBot ELECTRON_RUN_AS_NODE=1 + Fluent Window)
import { app, BrowserWindow, shell, dialog, Menu, ipcMain, Notification } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let serverProc = null;
let serverUrl = "";

function resolvePaths() {
  if (app.isPackaged) {
    return {
      serverEntry: path.join(process.resourcesPath, "server", "index.mjs"),
      desktopDir: path.join(process.resourcesPath, "app"),
      engineDir: path.join(process.resourcesPath, "engine"),
      iconPath: path.join(process.resourcesPath, "app", "icon.png"),
    };
  }
  const desktopRoot = path.resolve(__dirname, "..");
  return {
    serverEntry: path.join(desktopRoot, "server", "index.mjs"),
    desktopDir: path.join(desktopRoot, "app"),
    engineDir: path.resolve(desktopRoot, "..", "engine"),
    iconPath: path.join(desktopRoot, "build", "icon.png"),
  };
}

function startEmbeddedServer() {
  return new Promise((resolve, reject) => {
    const { serverEntry, desktopDir, engineDir } = resolvePaths();
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: process.env.PORT || "47123",
      HOST: "127.0.0.1",
      PDF_LAYOUT_DESKTOP_UI_DIR: desktopDir,
      PDF_LAYOUT_ENGINE_DIR: engineDir,
    };

    const child = spawn(process.execPath, [serverEntry], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProc = child;

    let buf = "", settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Local bridge server timed out while starting."));
      }
    }, 15000);

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const m = /PDF_LAYOUT_VI_LISTENING=(http:\/\/[^\s]+)/.exec(buf);
      if (m && !settled) {
        settled = true;
        clearTimeout(timeout);
        serverUrl = m[1];
        resolve(serverUrl);
      }
    });

    child.stderr.on("data", (chunk) => {
      const msg = chunk.toString("utf8");
      if (/EADDRINUSE/i.test(msg) && !settled) {
        settled = true;
        clearTimeout(timeout);
        const fallback = spawn(process.execPath, [serverEntry], {
          env: { ...env, PORT: "0" },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        serverProc = fallback;
        let fbuf = "";
        fallback.stdout.on("data", (c) => {
          fbuf += c.toString("utf8");
          const fm = /PDF_LAYOUT_VI_LISTENING=(http:\/\/[^\s]+)/.exec(fbuf);
          if (fm) { serverUrl = fm[1]; resolve(serverUrl); }
        });
        fallback.on("error", reject);
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function registerIpc() {
  ipcMain.handle("dialog:pickFolder", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Chọn thư mục lưu file PDF xuất ra",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, path: res.filePaths[0] };
  });

  ipcMain.handle("dialog:pickPdf", async (_ev, multiple) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Chọn tài liệu PDF",
      filters: [{ name: "Tài liệu PDF", extensions: ["pdf"] }],
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true, files: [] };
    const files = res.filePaths.map((p) => {
      const buf = fs.readFileSync(p);
      return {
        path: p,
        name: path.basename(p),
        size: buf.length,
        base64: buf.toString("base64"),
      };
    });
    return { canceled: false, files };
  });

  ipcMain.handle("shell:openPath", async (_ev, targetPath) => {
    if (!targetPath) return "";
    return shell.openPath(String(targetPath));
  });

  ipcMain.handle("shell:openExternal", async (_ev, url) => {
    if (url && /^https?:\/\//i.test(String(url))) {
      await shell.openExternal(String(url));
    }
    return true;
  });

  ipcMain.handle("theme:set", (_ev, theme) => {
    if (mainWindow && process.platform === "win32" && typeof mainWindow.setTitleBarOverlay === "function") {
      const isLight = theme === "light";
      mainWindow.setTitleBarOverlay({
        color: isLight ? "#f8fafc" : "#0b1120",
        symbolColor: isLight ? "#0f172a" : "#cbd5e1",
        height: 44,
      });
    }
    return true;
  });

  ipcMain.handle("app:notify", (_ev, title, body) => {
    try {
      if (Notification && Notification.isSupported()) {
        new Notification({
          title: String(title || "PDF Layout VI Studio"),
          body: String(body || ""),
          silent: false,
        }).show();
        return true;
      }
    } catch { /* ignore */ }
    return false;
  });
}

function createWindow(baseUrl) {
  const { iconPath } = resolvePaths();
  const isWin = process.platform === "win32";
  const winOpts = {
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: "PDF Layout VI Studio",
    autoHideMenuBar: true,
    backgroundColor: "#0c1117",
    ...(isWin
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#0c1117",
            symbolColor: "#cbd5e1",
            height: 44,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  if (fs.existsSync(iconPath)) winOpts.icon = iconPath;

  mainWindow = new BrowserWindow(winOpts);
  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(baseUrl)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.loadURL(`${baseUrl}/`);
  mainWindow.on("closed", () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      registerIpc();
      const url = await startEmbeddedServer();
      createWindow(url);
    } catch (err) {
      dialog.showErrorBox("PDF Layout VI Studio Error", err && err.message ? err.message : String(err));
      app.quit();
    }
  });

  app.on("before-quit", () => {
    if (serverProc && !serverProc.killed) {
      try { serverProc.kill(); } catch { /* ignore */ }
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
