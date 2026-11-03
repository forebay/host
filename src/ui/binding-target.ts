import type { PluginError, PluginManifest } from "@weivel/typescript";
import { pluginError } from "@weivel/typescript/engine";
import type { RunningHost } from "../start.js";

export type BindingTarget =
  | { state: "callable"; implementation: Record<string, unknown> }
  | { state: "unavailable"; error: PluginError }
  | { state: "refused"; error: PluginError };

export function providesService(manifest: PluginManifest, service: string): boolean {
  return (manifest.services?.provides ?? []).some((offer) => (typeof offer === "string" ? offer : offer.id) === service);
}

/** The manifest of a plugin the host deployed, whether or not it started. */
export function deployedManifest(running: RunningHost, plugin: string): PluginManifest | undefined {
  return running.loaded.deployed.find((deployed) => deployed.manifest.id === plugin)?.manifest;
}

/** @implNote Read from the ledger rather than `loaded.started`, which still lists a plugin quarantined after it started. */
export function isActive(running: RunningHost, plugin: string): boolean {
  return running.loaded.host.ledger.entry(plugin)?.status === "active";
}

function activeProvidersOf(running: RunningHost, service: string): string[] {
  return running.loaded.deployed
    .filter((deployed) => providesService(deployed.manifest, service) && isActive(running, deployed.manifest.id))
    .map((deployed) => deployed.manifest.id);
}

function refused(plugin: string, detail: string, fix: string): BindingTarget {
  return { state: "refused", error: pluginError(plugin, detail, fix) };
}

function unavailable(plugin: string, service: string): BindingTarget {
  return { state: "unavailable", error: pluginError(plugin, `${plugin} is not running, so ${service} has no implementation of its own`, `start ${plugin}, or fix why it was quarantined`) };
}

/**
 * Finds the implementation a binding of `plugin` reaches: the bound plugin's OWN implementation of
 * `service`, never another plugin's.
 *
 * @implNote The engine's `Host.service` answers one implementation per id with no owner, so the owner
 * is proven instead: the bound plugin must be active and the only active plugin whose manifest
 * provides the id. A shared id with two active providers is refused rather than guessed.
 */
export function bindingTarget(running: RunningHost, plugin: string, service: string): BindingTarget {
  const manifest = deployedManifest(running, plugin);
  if (manifest === undefined) return refused(plugin, `${plugin} is not deployed in this host`, `install and enable ${plugin}`);
  if (!providesService(manifest, service)) {
    return refused(plugin, `${plugin} binds ${service}, which it does not provide`, `bind a service ${plugin} lists under services.provides`);
  }
  if (!isActive(running, plugin)) return unavailable(plugin, service);
  const others = activeProvidersOf(running, service).filter((provider) => provider !== plugin);
  if (others.length > 0) {
    return refused(plugin, `${service} is also provided by ${others.join(", ")}, so ${plugin}'s own implementation cannot be told apart`, `disable all but one plugin providing ${service}`);
  }
  const implementation = running.loaded.host.service(service);
  if (implementation === undefined || implementation === null) return unavailable(plugin, service);
  return { state: "callable", implementation: implementation as Record<string, unknown> };
}
