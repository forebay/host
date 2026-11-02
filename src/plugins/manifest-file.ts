import { readFileSync } from "node:fs";
import { isRecord } from "./is-record.js";

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
