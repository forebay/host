import type { PluginManifest } from "@weivel/typescript";
import type { HostIdentity } from "../identity.js";
import type { HostPlaces } from "./places.js";

export type PluginScope = {
  home: string;
  portable: string;
  plugin: string;
  config: { [key: string]: unknown };
};

/** The arguments `config.*` and `log.write` share, rebuilt per call so a service never sees a shared object. */
export function scopeOf(host: HostIdentity, places: HostPlaces, manifest: PluginManifest): PluginScope {
  return { home: host.home, portable: places.portable, plugin: manifest.id, config: { ...manifest.config } };
}
