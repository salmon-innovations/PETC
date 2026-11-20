"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const electron_log_1 = __importDefault(require("electron-log"));
const commissioning_1 = require("./commissioning");
// ── logging ───────────────────────────────────────────────────────────────
electron_log_1.default.transports.file.level = "info";
// ── constants ─────────────────────────────────────────────────────────────
const SIDECAR_PORT = 8765;
const isDev = !electron_1.app.isPackaged;
// electron-updater is only loaded in packaged builds. Loading it during
// `electron .` dev runs trips an internal `app.getVersion()` call before
// the `app` module is fully initialised, which crashes the main process.
let autoUpdater = null;
if (!isDev) {
    autoUpdater = require("electron-updater").autoUpdater;
    if (autoUpdater)
        autoUpdater.logger = electron_log_1.default;
}
// ── sidecar lifecycle ─────────────────────────────────────────────────────
let sidecarProcess = null;
let commissioningConfig = null;
function sidecarBinary() {
    if (isDev) {
        // In dev: prefer the local venv created for sidecar dependencies.
        const desktopRoot = path.join(__dirname, "..", "..");
        const venvPython = process.platform === "win32"
            ? path.join(desktopRoot, ".venv", "Scripts", "python.exe")
            : path.join(desktopRoot, ".venv", "bin", "python");
        return fs.existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3");
    }
    // In production: electron-builder copies the contents of sidecar/dist/petc
    // directly into resources/petc-sidecar/.
    const exe = process.platform === "win32" ? "petc.exe" : "petc";
    return path.join(process.resourcesPath, "petc-sidecar", exe);
}
function sidecarArgs() {
    if (isDev) {
        return ["-m", "petc.service"];
    }
    return [];
}
function spawnSidecar() {
    const bin = sidecarBinary();
    const args = sidecarArgs();
    const cwd = isDev
        ? path.join(__dirname, "..", "..", "sidecar")
        : path.join(process.resourcesPath, "petc-sidecar");
    electron_log_1.default.info(`Spawning sidecar: ${bin} ${args.join(" ")} (cwd: ${cwd})`);
    sidecarProcess = (0, child_process_1.spawn)(bin, args, {
        cwd,
        env: {
            ...process.env,
            PETC_PORT: String(SIDECAR_PORT),
            PETC_DATA_DIR: electron_1.app.getPath("userData"),
            ...(commissioningConfig ? commissioningEnvironment(commissioningConfig) : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    sidecarProcess.stdout?.on("data", (d) => electron_log_1.default.info("[sidecar]", d.toString().trim()));
    sidecarProcess.stderr?.on("data", (d) => electron_log_1.default.warn("[sidecar]", d.toString().trim()));
    sidecarProcess.on("exit", (code, signal) => {
        electron_log_1.default.warn(`Sidecar exited code=${code} signal=${signal}`);
        sidecarProcess = null;
        // Restart unless app is quitting
        if (!electron_1.app.isQuitting) {
            setTimeout(spawnSidecar, 2000);
        }
    });
}
function commissioningEnvironment(config) {
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
async function chooseAndInstallCommissioningFile() {
    const result = await electron_1.dialog.showOpenDialog({
        title: "Select PETC commissioning file",
        properties: ["openFile"],
        filters: [{ name: "PETC properties", extensions: ["properties"] }],
    });
    if (result.canceled || result.filePaths.length === 0)
        return null;
    return (0, commissioning_1.installCommissioningFile)(result.filePaths[0], electron_1.app.getPath("userData"), electron_1.app.isPackaged);
}
async function loadOrCommission() {
    const configuredPath = process.env.PETC_CONFIG_FILE;
    const installedPath = path.join(electron_1.app.getPath("userData"), "petc.properties");
    const devPath = path.join(__dirname, "..", "..", "petc.properties");
    const candidate = configuredPath
        || (fs.existsSync(installedPath) ? installedPath : "")
        || (!electron_1.app.isPackaged && fs.existsSync(devPath) ? devPath : "");
    if (candidate)
        return (0, commissioning_1.loadCommissioningFile)(candidate, electron_1.app.isPackaged);
    if (!electron_1.app.isPackaged)
        return null;
    await electron_1.dialog.showMessageBox({
        type: "info",
        title: "Commission PETC Desktop",
        message: "A commissioning file is required",
        detail: "Download the center-specific petc.properties file from the PETC portal, then select it in the next window.",
    });
    return chooseAndInstallCommissioningFile();
}
function killSidecar() {
    if (sidecarProcess) {
        sidecarProcess.kill();
        sidecarProcess = null;
    }
}
// ── window ─────────────────────────────────────────────────────────────────
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    }
    else {
        // electron-builder places renderer/dist at the root of the packaged app.
        // app.getAppPath() remains correct regardless of the compiled main.js path.
        mainWindow.loadFile(path.join(electron_1.app.getAppPath(), "index.html"));
    }
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
// ── IPC handlers ───────────────────────────────────────────────────────────
/** Renderer asks for the sidecar base URL */
electron_1.ipcMain.handle("sidecar:url", () => `http://127.0.0.1:${SIDECAR_PORT}`);
/** Renderer asks for the app data directory (for DB file path display) */
electron_1.ipcMain.handle("app:userData", () => electron_1.app.getPath("userData"));
/** Renderer asks to open a file in the OS file manager */
electron_1.ipcMain.handle("shell:openPath", (_e, filePath) => electron_1.shell.openPath(filePath));
/** Renderer reports a fatal error it cannot recover from */
electron_1.ipcMain.on("renderer:fatal", (_e, msg) => {
    electron_log_1.default.error("Renderer fatal:", msg);
});
/** Replace the center commissioning file and restart with the new identity. */
electron_1.ipcMain.handle("commissioning:import", async () => {
    try {
        const imported = await chooseAndInstallCommissioningFile();
        if (!imported)
            return { imported: false, message: "Import cancelled." };
        setTimeout(() => {
            electron_1.app.relaunch();
            electron_1.app.exit(0);
        }, 250);
        return { imported: true, message: "Commissioning updated. Restarting…" };
    }
    catch (error) {
        electron_log_1.default.error("Commissioning import failed", error);
        return {
            imported: false,
            message: error instanceof Error ? error.message : String(error),
        };
    }
});
// ── auto-updater ───────────────────────────────────────────────────────────
function setupAutoUpdater() {
    if (!autoUpdater)
        return; // disabled in dev
    if (!commissioningConfig?.updateUrl) {
        electron_log_1.default.warn("Automatic updates disabled: no update URL is configured");
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
    electron_1.ipcMain.on("update:install", () => autoUpdater.quitAndInstall());
}
// ── app lifecycle ──────────────────────────────────────────────────────────
electron_1.app.whenReady().then(async () => {
    try {
        commissioningConfig = await loadOrCommission();
    }
    catch (error) {
        electron_log_1.default.error("Invalid commissioning configuration", error);
        await electron_1.dialog.showMessageBox({
            type: "error",
            title: "PETC commissioning error",
            message: error instanceof Error ? error.message : String(error),
            detail: "Replace the commissioning file or set PETC_CONFIG_FILE to a valid file, then restart the application.",
        });
        electron_1.app.quit();
        return;
    }
    if (electron_1.app.isPackaged && !commissioningConfig) {
        electron_1.app.quit();
        return;
    }
    spawnSidecar();
    createWindow();
    if (!isDev) {
        setupAutoUpdater();
    }
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("before-quit", () => {
    electron_1.app.isQuitting = true;
    killSidecar();
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
