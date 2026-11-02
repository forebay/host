import type { BundleEntry, BundleSource } from "./bundle-source.js";
import { withDefaults } from "./defaults.js";
import { disabledPlugins, enabledPlugins, pinnedVersions } from "./enabled.js";
import { resolveEnabled } from "./resolve.js";
import type { MissingPlugin } from "./resolve.js";

export interface PluginSelection {
  bundles: BundleEntry[];
  missing: MissingPlugin[];
}

function pinnedChoice(id: string, pins: Record<string, string>): { id: string; pin?: string } {
  return Object.hasOwn(pins, id) ? { id, pin: pins[id] } : { id };
}

/**
 * The bundles to start: the enabled ones the source holds at their pins, then the host's defaults
 * for what they leave unprovided, each default held to its own pin the same way.
 */
export function selectPlugins(
  settings: Record<string, unknown>,
  source: BundleSource,
  consumes: string[],
  defaults: Record<string, string>,
): PluginSelection {
  const enabled = resolveEnabled(enabledPlugins(settings), source);
  const enabledIds = enabled.found.map((entry) => entry.id);
  const added = withDefaults(enabledIds, source, consumes, defaults, disabledPlugins(settings)).slice(enabledIds.length);
  const pins = pinnedVersions(settings);
  const fromDefaults = resolveEnabled(added.map((id) => pinnedChoice(id, pins)), source);
  return {
    bundles: [...enabled.found, ...fromDefaults.found],
    missing: [...enabled.missing, ...fromDefaults.missing],
  };
}
