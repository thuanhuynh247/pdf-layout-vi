const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("PDF_DESKTOP", {
  isDesktop: true,
  platform: process.platform,
  version: "4.0.0",
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  pickPdf: (multiple = false) => ipcRenderer.invoke("dialog:pickPdf", Boolean(multiple)),
  openPath: (targetPath) => ipcRenderer.invoke("shell:openPath", targetPath),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  setTheme: (theme) => ipcRenderer.invoke("theme:set", theme),
  notify: (title, body) => ipcRenderer.invoke("app:notify", title, body),
});
