const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/** Stamp the generated PETC icon onto the Windows application executable. */
exports.default = async function stampWindowsIcon(context) {
  if (context.electronPlatformName !== "win32") return;

  const desktopDir = path.resolve(__dirname, "..");
  const icon = path.join(desktopDir, "build", "PETC.ico");
  const executable = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );

  for (const requiredPath of [icon, executable]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Cannot stamp PETC application icon; file not found: ${requiredPath}`);
    }
  }

  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || "",
    "electron-builder",
    "Cache",
    "winCodeSign",
  );
  const resourceEditor = fs.existsSync(cacheRoot)
    ? fs.readdirSync(cacheRoot, { recursive: true })
      .map((entry) => path.join(cacheRoot, entry))
      .find((entry) => entry.endsWith("rcedit-x64.exe"))
    : undefined;

  if (!resourceEditor) {
    throw new Error("Cannot stamp PETC application icon; rcedit-x64.exe is not available in the electron-builder cache.");
  }

  execFileSync(resourceEditor, [executable, "--set-icon", icon], { stdio: "inherit" });
};
