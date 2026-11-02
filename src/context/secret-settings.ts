import type { PluginManifest } from "@weivel/typescript";
import type { Runtime } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";

/** A plugin's secret store as its secret settings read and write it, synchronously like the rest of `config`. */
export interface SecretSettingStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export function secretSettingStore(runtime: Runtime, places: HostPlaces, pluginId: string): SecretSettingStore {
  const scope = { places, plugin: pluginId };
  return {
    get: (key) => runtime.secrets.get({ ...scope, name: key }).value,
    set: (key, value) => {
      runtime.secrets.set({ ...scope, name: key, value });
    },
    delete: (key) => {
      runtime.secrets.delete({ ...scope, name: key });
    },
  };
}

export function isSecretSetting(manifest: PluginManifest, key: string): boolean {
  return manifest.settings !== undefined && Object.hasOwn(manifest.settings, key) && manifest.settings[key]?.type === "secret";
}

export function withoutSecretSettings(manifest: PluginManifest, values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !isSecretSetting(manifest, key)));
}

/** @implNote `null` clears the secret, as it clears any other setting; anything but text or null is refused. */
export function writeSecretSetting(store: SecretSettingStore | undefined, key: string, value: unknown): void {
  if (store === undefined) throw new Error(`config.set("${key}"): the setting is a secret and this host has no secret store`);
  if (value === null) return store.delete(key);
  if (typeof value !== "string") throw new Error(`config.set("${key}"): a secret setting takes text or null`);
  store.set(key, value);
}
