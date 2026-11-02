import { app, BrowserWindow, shell } from "electron";
import { createServer as createPortProbe } from "node:net";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const HOST = "127.0.0.1";
let windowInstance;
let localUrl;

app.setName("Hanabi·灵感如火花般闪现");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!windowInstance) return;
    if (windowInstance.isMinimized()) windowInstance.restore();
    windowInstance.focus();
  });

  app.whenReady().then(async () => {
    const dataDirectory = join(app.getPath("appData"), "Content Alchemy");
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    app.setPath("userData", dataDirectory);
    process.env.CONTENT_ALCHEMY_DATA_DIR = dataDirectory;
    if (app.isPackaged) process.env.CONTENT_ALCHEMY_SEED_DIR = join(process.resourcesPath, "content-alchemy-seed");

    const probe = createPortProbe();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, HOST, () => {
        process.env.CONTENT_ALCHEMY_PORT = String(probe.address().port);
        probe.close(resolve);
      });
    });
    localUrl = `http://${HOST}:${process.env.CONTENT_ALCHEMY_PORT}`;
    await import("./server.mjs");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`${localUrl}/healthz`);
        if (response.ok) break;
      } catch { /* Wait for the local HTTP server to bind. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    createWindow();

    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch((error) => {
    console.error("Content Alchemy failed to start:", error);
    app.quit();
  });
}

function createWindow() {
  windowInstance = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 900,
    minHeight: 650,
    title: "Hanabi·灵感如火花般闪现",
    backgroundColor: "#fff8fc",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  windowInstance.once("ready-to-show", () => windowInstance.show());
  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  windowInstance.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${localUrl}/`)) return;
    event.preventDefault();
    if (url.startsWith("https://")) shell.openExternal(url);
  });
  windowInstance.loadURL(localUrl);
  windowInstance.on("closed", () => { windowInstance = undefined; });
}
