/**
 * Preload script — runs in the renderer's context but with access to Node IPC.
 * Exposes a minimal, typed API surface via contextBridge so the renderer
 * never needs nodeIntegration=true.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("petcBridge", {
  // ── sidecar ──────────────────────────────────────────────────────────────
  getSidecarUrl: (): Promise<string> => ipcRenderer.invoke("sidecar:url"),

  // ── app ──────────────────────────────────────────────────────────────────
  getUserDataPath: (): Promise<string> => ipcRenderer.invoke("app:userData"),
  openPath: (filePath: string): Promise<string> =>
    ipcRenderer.invoke("shell:openPath", filePath),

  // ── auto-updater events (renderer listens, main pushes) ──────────────────
  onUpdateAvailable: (cb: () => void) => {
    ipcRenderer.on("update:available", cb);
    return () => ipcRenderer.removeListener("update:available", cb);
  },
  onUpdateReady: (cb: () => void) => {
    ipcRenderer.on("update:ready", cb);
    return () => ipcRenderer.removeListener("update:ready", cb);
  },
  installUpdate: () => ipcRenderer.send("update:install"),

  // ── error reporting ───────────────────────────────────────────────────────
  reportFatal: (message: string) => ipcRenderer.send("renderer:fatal", message),
});
