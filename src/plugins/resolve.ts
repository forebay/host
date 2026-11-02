import type { BundleEntry, BundleSource } from "./bundle-source.js";
import type { EnabledPlugin } from "./enabled.js";

export interface MissingPlugin {
  id: string;
  fix: string;
}

export interface ResolvedPlugins {
  found: BundleEntry[];
  missing: MissingPlugin[];
}

function missingFix({ id, pin }: EnabledPlugin, located: BundleEntry | null): string | null {
  if (located === null) return `install ${id}, or disable it`;
  if (pin !== undefined && located.version !== pin) return `install ${id} ${pin}, or change plugins.${id}.pin`;
  return null;
}

export function resolveEnabled(enabled: readonly EnabledPlugin[], source: BundleSource): ResolvedPlugins {
  const resolved: ResolvedPlugins = { found: [], missing: [] };
  for (const plugin of enabled) {
    const located = source.locate(plugin.id);
    const fix = missingFix(plugin, located);
    if (fix !== null) resolved.missing.push({ id: plugin.id, fix });
    else if (located !== null) resolved.found.push(located);
  }
  return resolved;
}
