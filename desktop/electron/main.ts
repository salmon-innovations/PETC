import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import log from "electron-log";
import {
  CommissioningConfig,
  installCommissioningFile,
  loadCommissioningFile,
} from "./commissioning";

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
let commissioningConfig: CommissioningConfig | null = null;

function sidecarBinary(): string {
  if (isDev) {
    // In dev: prefer the local venv created for sidecar dependencies.
    const desktopRoot = path.join(__dirname, "..", "..");
    const venvPython = process.platform === "win32"
      ? path.join(desktopRoot, ".venv", "Scripts", "python.exe")
      : path.join(desktopRoot, ".venv", "bin", "python");
    return fs.existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3");
  }
  // In production: PyInstaller-frozen directory bundle inside resources/petc-sidecar/
  // The COLLECT() in petc_sidecar.spec names the directory "petc"; the exe inside is "petc".
  const exe = process.platform === "win32" ? "petc.exe" : "petc";
  return path.join(process.resourcesPath, "petc-sidecar", "petc", exe);
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
    : path.join(process.resourcesPath, "petc-sidecar", "petc");

  log.info(`Spawning sidecar: ${bin} ${args.join(" ")} (cwd: ${cwd})`);

  sidecarProcess = spawn(bin, args, {
    cwd,
    env: {
      ...process.env,
      PETC_PORT: String(SIDECAR_PORT),
      PETC_DATA_DIR: app.getPath("userData"),
      ...(commissioningConfig ? commissioningEnvironment(commissioningConfig) : {}),
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

function commissioningEnvironment(config: CommissioningConfig): NodeJS.ProcessEnv {
  return {
    PETC_PROFILE: config.profile,
    PETC_CLOUD_URL: config.cloudUrl,
    PETC_CLOUD_KEY: config.cloudKey,
    PETC_CENTER_ID: config.centerId,
    ...(config.analyzer ? { PETC_ANALYZER: config.analyzer } : {}),
    ...(config.analyzerPort ? { PETC_ANALYZER_PORT: config.analyzerPort } : {}),
    ...(config.analyzerBaud ? { PETC_ANALYZER_BAUD: config.analyzerBaud } : {}),
    ...(config.camera ? { PETC_CAMERA: config.camera } : {}),
    ...(config.printer ? { PETC_PRINTER: config.printer } : {}),
    ...(config.enforceHardware ? { PETC_ENFORCE_HARDWARE: config.enforceHardware } : {}),
  };
}

async function chooseAndInstallCommissioningFile(): Promise<CommissioningConfig | null> {
  const result = await dialog.showOpenDialog({
    title: "Select PETC commissioning file",
    properties: ["openFile"],
    filters: [{ name: "PETC properties", extensions: ["properties"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return installCommissioningFile(result.filePaths[0], app.getPath("userData"), app.isPackaged);
}

async function loadOrCommission(): Promise<CommissioningConfig | null> {
  const configuredPath = process.env.PETC_CONFIG_FILE;
  const installedPath = path.join(app.getPath("userData"), "petc.properties");
  const devPath = path.join(__dirname, "..", "..", "petc.properties");
  const candidate = configuredPath
    || (fs.existsSync(installedPath) ? installedPath : "")
    || (!app.isPackaged && fs.existsSync(devPath) ? devPath : "");

  if (candidate) return loadCommissioningFile(candidate, app.isPackaged);
  if (!app.isPackaged) return null;

  await dialog.showMessageBox({
    type: "info",
    title: "Commission PETC Desktop",
    message: "A commissioning file is required",
    detail: "Download the center-specific petc.properties file from the PETC portal, then select it in the next window.",
  });
  return chooseAndInstallCommissioningFile();
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

/** Renderer asks to open a file in the OS file manager */
ipcMain.handle("shell:openPath", (_e, filePath: string) => shell.openPath(filePath));

/** Renderer reports a fatal error it cannot recover from */
ipcMain.on("renderer:fatal", (_e, msg: string) => {
  log.error("Renderer fatal:", msg);
});

/** Replace the center commissioning file and restart with the new identity. */
ipcMain.handle("commissioning:import", async () => {
  try {
    const imported = await chooseAndInstallCommissioningFile();
    if (!imported) return { imported: false, message: "Import cancelled." };
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 250);
    return { imported: true, message: "Commissioning updated. Restarting…" };
  } catch (error) {
    log.error("Commissioning import failed", error);
    return {
      imported: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
});

// ── auto-updater ───────────────────────────────────────────────────────────
function setupAutoUpdater(): void {
  if (!autoUpdater) return; // disabled in dev
  if (!commissioningConfig?.updateUrl) {
    log.warn("Automatic updates disabled: no update URL is configured");
    return;
  }
  autoUpdater.setFeedURL({ provider: "generic", url: commissioningConfig.updateUrl });
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
app.whenReady().then(async () => {
  try {
    commissioningConfig = await loadOrCommission();
  } catch (error) {
    log.error("Invalid commissioning configuration", error);
    await dialog.showMessageBox({
      type: "error",
      title: "PETC commissioning error",
      message: error instanceof Error ? error.message : String(error),
      detail: "Replace the commissioning file or set PETC_CONFIG_FILE to a valid file, then restart the application.",
    });
    app.quit();
    return;
  }

  if (app.isPackaged && !commissioningConfig) {
    app.quit();
    return;
  }

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
