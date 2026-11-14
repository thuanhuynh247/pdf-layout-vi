const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("PDF_DESKTOP", {
  isDesktop: true,
  platform: process.platform,
});
