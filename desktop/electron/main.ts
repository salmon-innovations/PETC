import { app, BrowserWindow, ipcMain, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import log from "electron-log";

// ── logging ───────────────────────────────────────────────────────────────
log.transports.file.level = "info";

// ── constants ─────────────────────────────────────────────────────────────
const SIDECAR_PORT = 8765;
const isDev = !app.isPackaged;

// electron-updater is only loaded in packaged builds. Loading it during
// `electron .` dev runs trips an internal `app.getVersion()` call before
// the `app` module is fully initialised, which crashes the main process.
let autoUpdater: typeof import("electron-updater").autoUpdater | null = null;
if (!isDev) {
  autoUpdater = require("electron-updater").autoUpdater;
  if (autoUpdater) autoUpdater.logger = log;
}

// ── sidecar lifecycle ─────────────────────────────────────────────────────
let sidecarProcess: ChildProcess | null = null;
// Capability shared only with the context-isolated PETC renderer and its
// localhost sidecar. It prevents arbitrary local web pages from replacing a
// workstation credential through the commissioning endpoints.
const commissioningToken = randomBytes(32).toString("hex");

function sidecarBinary(): string {
  if (isDev) {
    // In dev: prefer the local venv created for sidecar dependencies.
    const desktopRoot = path.join(__dirname, "..", "..");
    const venvPython = process.platform === "win32"
      ? path.join(desktopRoot, ".venv", "Scripts", "python.exe")
      : path.join(desktopRoot, ".venv", "bin", "python");
    return fs.existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3");
  }
  // In production the FileSet copies the contents of sidecar/dist/petc into
  // resources/petc-sidecar/, so the frozen executable is directly beneath it.
  const exe = process.platform === "win32" ? "petc.exe" : "petc";
  return path.join(process.resourcesPath, "petc-sidecar", exe);
}

function sidecarArgs(): string[] {
  if (isDev) {
    return ["-m", "petc.service"];
  }
  return [];
}

function spawnSidecar(): void {
  const bin = sidecarBinary();
  const args = sidecarArgs();
  const cwd = isDev
    ? path.join(__dirname, "..", "..", "sidecar")
    : path.join(process.resourcesPath, "petc-sidecar");

  log.info(`Spawning sidecar: ${bin} ${args.join(" ")} (cwd: ${cwd})`);

  sidecarProcess = spawn(bin, args, {
    cwd,
    env: {
      ...process.env,
      PETC_PORT: String(SIDECAR_PORT),
      PETC_DATA_DIR: app.getPath("userData"),
      PETC_COMMISSIONING_TOKEN: commissioningToken,
      // Production configuration is deliberately beside PETC Desktop.exe,
      // not beside the packaged sidecar under resources/. This is a trusted
      // internal handoff, distinct from the dev/test PETC_CONFIG_PATH override.
      ...(isDev ? { PETC_CONFIG_PATH: path.join(__dirname, "..", "..", "petc.properties") } : {
        PETC_PACKAGED_CONFIG_PATH: path.join(path.dirname(app.getPath("exe")), "petc.properties"),
      }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  sidecarProcess.stdout?.on("data", (d) => log.info("[sidecar]", d.toString().trim()));
  sidecarProcess.stderr?.on("data", (d) => log.warn("[sidecar]", d.toString().trim()));

  sidecarProcess.on("exit", (code, signal) => {
    log.warn(`Sidecar exited code=${code} signal=${signal}`);
    sidecarProcess = null;
    // Restart unless app is quitting
    if (!(app as any).isQuitting) {
      setTimeout(spawnSidecar, 2000);
    }
  });
}

function killSidecar(): void {
  if (sidecarProcess) {
    sidecarProcess.kill();
    sidecarProcess = null;
  }
}

// ── window ─────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: "PETC — Emission Testing",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC handlers ───────────────────────────────────────────────────────────

/** Renderer asks for the sidecar base URL */
ipcMain.handle("sidecar:url", () => `http://127.0.0.1:${SIDECAR_PORT}`);

/** Renderer asks for the app data directory (for DB file path display) */
ipcMain.handle("app:userData", () => app.getPath("userData"));
ipcMain.handle("commissioning:token", () => commissioningToken);

/** Renderer asks to open a file in the OS file manager */
ipcMain.handle("shell:openPath", (_e, filePath: string) => shell.openPath(filePath));

/** Renderer reports a fatal error it cannot recover from */
ipcMain.on("renderer:fatal", (_e, msg: string) => {
  log.error("Renderer fatal:", msg);
});

// ── auto-updater ───────────────────────────────────────────────────────────
function setupAutoUpdater(): void {
  if (!autoUpdater) return; // disabled in dev
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on("update-available", () => {
    mainWindow?.webContents.send("update:available");
  });
  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update:ready");
  });

  // Renderer can trigger install-and-relaunch
  ipcMain.on("update:install", () => autoUpdater!.quitAndInstall());
}

// ── app lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  spawnSidecar();
  createWindow();

  if (!isDev) {
    setupAutoUpdater();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  (app as any).isQuitting = true;
  killSidecar();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
