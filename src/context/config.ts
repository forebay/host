import type { ConfigSetOptions, PluginConfig, PluginManifest, SettingsLayer } from "@weivel/typescript";
import type { HostIdentity } from "../identity.js";
import type { Runtime } from "../runtime/open.js";
import type { ActivityPublisher } from "./activity.js";
import type { HostPlaces } from "./places.js";
import { scopeOf } from "./scope.js";

function carriesAsJson(value: unknown): boolean {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

/** A declared setting goes where its manifest says (portable by default); anything undeclared stays in the application. */
function layerFor(manifest: PluginManifest, key: string): SettingsLayer {
  const declared = manifest.settings !== undefined && Object.hasOwn(manifest.settings, key);
  return declared ? (manifest.settings?.[key]?.layer ?? "portable") : "application";
}

export function buildConfig(
  runtime: Runtime,
  places: HostPlaces,
  host: HostIdentity,
  manifest: PluginManifest,
  publish: ActivityPublisher,
): PluginConfig {
  const scope = () => scopeOf(host, places, manifest);
  async function set(key: string, value: unknown, options?: ConfigSetOptions): Promise<void> {
    if (!carriesAsJson(value)) throw new Error(`config.set("${key}"): the value cannot be carried as JSON`);
    const layer = options?.layer ?? layerFor(manifest, key);
    const { previous } = runtime.config.set({ ...scope(), key, value, layer });
    publish("config.set", { key, from: previous, to: value });
  }
  return {
    all: () => runtime.config.all(scope()).values,
    get: <T>(key: string) => runtime.config.get({ ...scope(), key }).value as T | undefined,
    set,
  };
}
