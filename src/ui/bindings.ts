import type { PluginManifest, UiBinding } from "@weivel/typescript";
import { pluginError } from "@weivel/typescript/engine";
import { callCapability, DEFAULT_CALL_TIMEOUT_MS, DEFAULT_INVOKE_TIMEOUT_MS } from "@weivel/typescript/host";
import type { CapabilityCall } from "@weivel/typescript/host";
import type { RunningHost } from "../start.js";

function refused<T>(plugin: string, detail: string, fix: string): CapabilityCall<T> {
  return { ok: false, error: pluginError(plugin, detail, fix) };
}

function labelOf(binding: UiBinding): string {
  return `${binding.service}.${binding.method}`;
}

function invoke(running: RunningHost, plugin: string, binding: UiBinding, argument: Record<string, unknown>): Promise<unknown> {
  const service = running.loaded.host.service(binding.service) as Record<string, unknown> | undefined;
  const method = service?.[binding.method];
  if (typeof method !== "function") {
    throw pluginError(plugin, `${labelOf(binding)} is not a method the running ${binding.service} has`, `bind a method ${binding.service} registers, or start ${plugin}`);
  }
  return Promise.resolve(method.call(service, argument));
}

async function call(running: RunningHost, plugin: string, binding: UiBinding, extra: Record<string, unknown>, timeoutMs: number): Promise<CapabilityCall<unknown>> {
  const manifest = deployedManifest(running, plugin);
  if (manifest === undefined) {
    return refused(plugin, `${plugin} is not deployed in this host`, `install and enable ${plugin}`);
  }
  if (!providesService(manifest, binding.service)) {
    return refused(plugin, `${plugin} binds ${binding.service}, which it does not provide`, `bind a service ${plugin} lists under services.provides`);
  }
  const argument = { ...binding.argument, ...extra };
  return callCapability(plugin, labelOf(binding), timeoutMs, () => invoke(running, plugin, binding, argument), running.loaded.scheduler);
}

export function providesService(manifest: PluginManifest, service: string): boolean {
  return (manifest.services?.provides ?? []).some((offer) => (typeof offer === "string" ? offer : offer.id) === service);
}

/** The manifest of a plugin the host deployed, whether or not it started. */
export function deployedManifest(running: RunningHost, plugin: string): PluginManifest | undefined {
  return running.loaded.deployed.find((deployed) => deployed.manifest.id === plugin)?.manifest;
}

/**
 * Calls a view node's binding under the read deadline, with `extra` merged over its declared argument.
 *
 * @implNote A binding to a service the plugin does not itself provide is refused here as well as at
 * load, because a binding also arrives at run time from a caller rather than from a validated manifest.
 */
export function callBinding(running: RunningHost, plugin: string, binding: UiBinding, extra: Record<string, unknown> = {}): Promise<CapabilityCall<unknown>> {
  return call(running, plugin, binding, extra, DEFAULT_CALL_TIMEOUT_MS);
}

/** Runs one of a plugin's declared actions under the invoke deadline; a row passes `{ item: <id> }` as `extra`. */
export async function runAction(running: RunningHost, plugin: string, actionId: string, extra: Record<string, unknown> = {}): Promise<CapabilityCall<unknown>> {
  const action = deployedManifest(running, plugin)?.actions?.[actionId];
  if (action === undefined) {
    return refused(plugin, `${plugin} declares no action ${actionId}`, `run an action ${plugin} lists under actions`);
  }
  return call(running, plugin, action.call, extra, DEFAULT_INVOKE_TIMEOUT_MS);
}
