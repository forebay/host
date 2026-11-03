import { catalogKeyPatterns, withRenderedPatterns } from "./install-script-patterns.js";
import { withRenderedPins } from "./install-script-pins.js";
import type { InstallScriptKind } from "./install-script-sections.js";
import type { PinnedRuntime } from "./runtime-pin.js";

/** `script` with its runtime pins rendered from `pin` and its catalog patterns from `schema`, the catalog schema document. */
export function renderInstallScript(script: string, kind: InstallScriptKind, pin: PinnedRuntime, compatibleMajor: number, schema: unknown): string {
  return withRenderedPatterns(withRenderedPins(script, kind, pin, compatibleMajor), kind, catalogKeyPatterns(schema));
}

export { COMPATIBLE_RUNTIME_MAJOR, RUNTIME_PIN } from "./runtime-pin.js";
export type { InstallScriptKind };
