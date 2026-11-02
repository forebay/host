import type { ConfigSetOptions, PluginConfig, PluginManifest, SettingsLayer } from "@weivel/typescript";
import type { HostIdentity } from "../identity.js";
import type { Runtime } from "../runtime/open.js";
import type { ActivityPublisher } from "./activity.js";
import type { HostPlaces } from "./places.js";
import { scopeOf } from "./scope.js";
import { isSecretSetting, withoutSecretSettings, writeSecretSetting } from "./secret-settings.js";
import type { SecretSettingStore } from "./secret-settings.js";

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDense(array: unknown[]): boolean {
  return Object.keys(array).length === array.length;
}

/** True only when a JSON round trip hands back exactly what was put in: no cycles, holes, or non-JSON values. */
function carriesAsJson(value: unknown, ancestors: ReadonlySet<object> = new Set()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const path = new Set(ancestors).add(value);
  const carries = (member: unknown) => carriesAsJson(member, path);
  if (Array.isArray(value)) return isDense(value) && value.every(carries);
  return isPlainObject(value) && Object.values(value).every(carries);
}

/** A declared setting goes where its manifest says (portable by default); anything undeclared stays in the application. */
function layerFor(manifest: PluginManifest, key: string): SettingsLayer {
  const declared = manifest.settings !== undefined && Object.hasOwn(manifest.settings, key);
  return declared ? (manifest.settings?.[key]?.layer ?? "portable") : "application";
}

/** @implNote The value is already persisted here, so a failing publish must not turn that into a rejected `set`. */
function publishQuietly(publish: ActivityPublisher, detail: Record<string, unknown>): void {
  try {
    publish("config.set", detail);
  } catch {
    return;
  }
}

/**
 * A plugin's `config`. A setting its manifest declares `secret` goes to `secrets`, never to a
 * settings file: it reads back through `get`, is left out of `all`, and its activity names only the
 * key. Without a secret store, setting one is refused.
 */
export function buildConfig(
  runtime: Runtime,
  places: HostPlaces,
  host: HostIdentity,
  manifest: PluginManifest,
  publish: ActivityPublisher,
  secrets: SecretSettingStore | undefined,
): PluginConfig {
  const scope = () => scopeOf(host, places, manifest);
  async function set(key: string, value: unknown, options?: ConfigSetOptions): Promise<void> {
    if (isSecretSetting(manifest, key)) {
      writeSecretSetting(secrets, key, value);
      return publishQuietly(publish, { key, secret: true });
    }
    if (!carriesAsJson(value)) throw new Error(`config.set("${key}"): the value cannot be carried as JSON`);
    const layer = options?.layer ?? layerFor(manifest, key);
    const { previous } = runtime.config.set({ ...scope(), key, value, layer });
    publishQuietly(publish, { key, from: previous, to: value });
  }
  function get<T>(key: string): T | undefined {
    if (isSecretSetting(manifest, key)) return secrets?.get(key) as T | undefined;
    return runtime.config.get({ ...scope(), key }).value as T | undefined;
  }
  return {
    all: () => withoutSecretSettings(manifest, runtime.config.all(scope()).values),
    get,
    set,
  };
}
