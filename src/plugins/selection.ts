import type { BundleEntry, BundleSource } from "./bundle-source.js";
import { withDefaults } from "./defaults.js";
import { enabledPlugins } from "./enabled.js";
import { resolveEnabled } from "./resolve.js";
import type { MissingPlugin } from "./resolve.js";

export interface PluginSelection {
  bundles: BundleEntry[];
  missing: MissingPlugin[];
}

/** The bundles to start: the enabled ones the source holds at their pins, then the host's defaults for what they leave unprovided. */
export function selectPlugins(
  settings: Record<string, unknown>,
  source: BundleSource,
  consumes: string[],
  defaults: Record<string, string>,
): PluginSelection {
  const { found, missing } = resolveEnabled(enabledPlugins(settings), source);
  const chosen = withDefaults(
    found.map((entry) => entry.id),
    source,
    consumes,
    defaults,
  );
  const byId = new Map(found.map((entry) => [entry.id, entry]));
  const bundles = chosen.flatMap((id) => byId.get(id) ?? source.locate(id) ?? []);
  return { bundles, missing };
}
