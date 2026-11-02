import type { ConfigSetOptions, PluginConfig, PluginManifest, SettingsLayer } from "@weivel/typescript";
import type { HostIdentity } from "../identity.js";
import type { Runtime } from "../runtime/open.js";
import type { ActivityPublisher } from "./activity.js";
import type { HostPlaces } from "./places.js";
import { scopeOf } from "./scope.js";

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
