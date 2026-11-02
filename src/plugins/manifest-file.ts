import { readFileSync } from "node:fs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readManifestFile(manifestPath: string): unknown {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function readManifestFileOrNull(manifestPath: string): Record<string, unknown> | null {
  try {
    const manifest = readManifestFile(manifestPath);
    return isRecord(manifest) ? manifest : null;
  } catch {
    return null;
  }
}
