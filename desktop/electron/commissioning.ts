import * as fs from "fs";
import * as path from "path";

export interface CommissioningConfig {
  profile: "dev" | "accreditation-demo" | "production";
  cloudUrl: string;
  cloudKey: string;
  centerId: string;
  updateUrl: string;
  analyzer?: string;
  analyzerPort?: string;
  analyzerBaud?: string;
  camera?: string;
  printer?: string;
  enforceHardware?: string;
}

const PROFILE_UPDATE_URLS: Record<CommissioningConfig["profile"], string> = {
  dev: "",
  "accreditation-demo": "https://uat-app.petc.siiportal.com/downloads/desktop/uat",
  production: "https://petc.siiportal.com/downloads/desktop/stable",
};

export function parseProperties(contents: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const separator = line.search(/[=:]/);
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    properties[key] = value;
  }
  return properties;
}

export function parseCommissioningFile(contents: string, packaged: boolean): CommissioningConfig {
  const properties = parseProperties(contents);
  const profile = (properties["petc.profile"] || (packaged ? "production" : "dev")) as CommissioningConfig["profile"];
  if (!Object.prototype.hasOwnProperty.call(PROFILE_UPDATE_URLS, profile)) {
    throw new Error("petc.profile must be dev, accreditation-demo, or production");
  }

  const cloudUrl = properties["petc.cloud.url"] || "";
  const cloudKey = properties["petc.cloud.key"] || "";
  const centerId = properties["petc.center.id"] || properties["petc.expected.center"] || "";
  const updateUrl = properties["petc.update.url"] || PROFILE_UPDATE_URLS[profile];

  if (packaged || profile !== "dev") {
    validateHttpsUrl("petc.cloud.url", cloudUrl);
    if (!cloudKey || ["dev-insecure-key", "changeme", "placeholder"].includes(cloudKey.toLowerCase())) {
      throw new Error("petc.cloud.key must be an issued center key");
    }
    if (!centerId || ["dev-center", "mock-center"].includes(centerId.toLowerCase())) {
      throw new Error("petc.center.id must be an issued center UUID");
    }
    validateHttpsUrl("petc.update.url", updateUrl);
  }

  return {
    profile,
    cloudUrl,
    cloudKey,
    centerId,
    updateUrl,
    analyzer: properties["petc.analyzer"],
    analyzerPort: properties["petc.analyzer.port"],
    analyzerBaud: properties["petc.analyzer.baud"],
    camera: properties["petc.camera"],
    printer: properties["petc.printer"],
    enforceHardware: properties["petc.enforce.hardware"],
  };
}

export function loadCommissioningFile(filePath: string, packaged: boolean): CommissioningConfig {
  return parseCommissioningFile(fs.readFileSync(filePath, "utf8"), packaged);
}

export function installCommissioningFile(sourcePath: string, userDataPath: string, packaged: boolean): CommissioningConfig {
  const contents = fs.readFileSync(sourcePath, "utf8");
  const config = parseCommissioningFile(contents, packaged);
  fs.mkdirSync(userDataPath, { recursive: true });
  const destination = path.join(userDataPath, "petc.properties");
  fs.writeFileSync(destination, contents, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(destination, 0o600);
  } catch {
    // Windows does not implement POSIX modes; the per-user app-data directory
    // still provides the normal account boundary.
  }
  return config;
}

function validateHttpsUrl(name: string, value: string): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
}
