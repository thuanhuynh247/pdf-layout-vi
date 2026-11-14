// electron/main.mjs — OpenMausBot-style Electron shell + ELECTRON_RUN_AS_NODE=1 embedded server
import { app, BrowserWindow, shell, dialog, Menu } from "electron";
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
      uiDir: path.join(process.resourcesPath, "app-ui"),
      iconPath: path.join(process.resourcesPath, "app-ui", "assets", "img", "icon-256.png"),
    };
  }
  const desktopRoot = path.resolve(__dirname, "..");
  return {
    serverEntry: path.join(desktopRoot, "server", "index.mjs"),
    uiDir: path.resolve(desktopRoot, ".."),
    iconPath: path.join(desktopRoot, "build", "icon.png"),
  };
}

function startEmbeddedServer() {
  return new Promise((resolve, reject) => {
    const { serverEntry, uiDir } = resolvePaths();
    // Preferred fixed port 47123 so web users can also detect desktop bridge; fall back cleanly to ephemeral 0 if busy
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: process.env.PORT || "47123",
      HOST: "127.0.0.1",
      PDF_LAYOUT_UI_DIR: uiDir,
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
        // Retry cleanly on ephemeral port
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

function createWindow(baseUrl) {
  const { iconPath } = resolvePaths();
  const winOpts = {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: "PDF Layout VI — Dịch PDF Giữ Nguyên Bố Cục",
    autoHideMenuBar: true,
    backgroundColor: "#f7f5f0",
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

  // Open external AI web links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(baseUrl)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.loadURL(`${baseUrl}/dich`);
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
      const url = await startEmbeddedServer();
      createWindow(url);
    } catch (err) {
      dialog.showErrorBox("PDF Layout VI Error", err && err.message ? err.message : String(err));
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
