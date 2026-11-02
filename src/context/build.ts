import type { PluginManifest, PluginPaths } from "@weivel/typescript";
import type { PluginRuntime, RuntimeEvents } from "@weivel/typescript/engine";
import type { HostIdentity } from "../identity.js";
import type { Runtime } from "../runtime/open.js";
import { activityPublisher } from "./activity.js";
import { buildConfig } from "./config.js";
import { buildLogger } from "./log.js";
import type { HostPlaces } from "./places.js";
import { buildSecrets } from "./secrets.js";

/** @implNote `cache` is the plugin's folder in the cache place, as the home-layout design moves it, not the per-application cache. */
function buildPaths(runtime: Runtime, places: HostPlaces, host: HostIdentity, pluginId: string): PluginPaths {
  const resolved = runtime.paths.resolve({
    home: host.home,
    plugin: pluginId,
    places: { portable: places.portable, cache: places.cache },
  });
  const { pluginCache, ...paths } = resolved;
  if (pluginCache === undefined) throw new Error(`paths.resolve answered no plugin cache folder for "${pluginId}"`);
  return { ...paths, cache: pluginCache };
}

export function buildRuntime(
  runtime: Runtime,
  places: HostPlaces,
  host: HostIdentity,
  manifest: PluginManifest,
  activity: RuntimeEvents,
  startedAt: string,
): PluginRuntime {
  const publish = activityPublisher(activity, manifest.id);
  return {
    config: buildConfig(runtime, places, host, manifest, publish),
    log: buildLogger(runtime, places, host, manifest, startedAt, publish),
    paths: buildPaths(runtime, places, host, manifest.id),
    events: activity,
    secrets: buildSecrets(runtime, places, manifest.id),
  };
}
