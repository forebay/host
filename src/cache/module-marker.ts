import { posix } from "node:path";

const MODULE_MARKER_NAME = "package.json";

export const MODULE_MARKER_CONTENT = `${JSON.stringify({ type: "module" })}\n`;

/**
 * Where a bundle whose entry is `entry` keeps the `package.json` marking it as ESM, or undefined
 * when the entry's own extension already says so.
 *
 * @implNote A `.js` entry sits in the cache with no `package.json` above it, so without the marker
 * Node would load it as ESM only through syntax detection, which Node 20 before 20.19 lacks.
 */
export function moduleMarkerKey(entry: string): string | undefined {
  if (!entry.endsWith(".js")) return undefined;
  const directory = posix.dirname(entry);
  return directory === "." ? MODULE_MARKER_NAME : `${directory}/${MODULE_MARKER_NAME}`;
}

export function isModuleMarkerName(key: string): boolean {
  return posix.basename(key).toLowerCase() === MODULE_MARKER_NAME;
}
