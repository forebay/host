import type { UiBinding } from "@weivel/typescript";
import { pluginError } from "@weivel/typescript/engine";
import { callCapability, DEFAULT_CALL_TIMEOUT_MS, DEFAULT_INVOKE_TIMEOUT_MS } from "@weivel/typescript/host";
import type { CapabilityCall } from "@weivel/typescript/host";
import type { RunningHost } from "../start.js";
import { bindingTarget, deployedManifest } from "./binding-target.js";

/** What a row or a selection adds to a binding's declared argument, and the only keys it may set. */
export interface RowArgument {
  item?: string;
  items?: string[];
}

function rowKeysOf(row: RowArgument): RowArgument {
  return {
    ...(row.item === undefined ? {} : { item: row.item }),
    ...(row.items === undefined ? {} : { items: row.items }),
  };
}

function labelOf(binding: UiBinding): string {
  return `${binding.service}.${binding.method}`;
}

function invoke(implementation: Record<string, unknown>, plugin: string, binding: UiBinding, argument: Record<string, unknown>): Promise<unknown> {
  const method = implementation[binding.method];
  if (typeof method !== "function") {
    throw pluginError(plugin, `${labelOf(binding)} is not a method the running ${binding.service} has`, `bind a method ${binding.service} registers`);
  }
  return Promise.resolve(method.call(implementation, argument));
}

async function call(running: RunningHost, plugin: string, binding: UiBinding, row: RowArgument, timeoutMs: number, input: Record<string, unknown> = {}): Promise<CapabilityCall<unknown>> {
  const target = bindingTarget(running, plugin, binding.service);
  if (target.state !== "callable") return { ok: false, error: target.error };
  const argument = { ...binding.argument, ...input, ...rowKeysOf(row) };
  return callCapability(plugin, labelOf(binding), timeoutMs, () => invoke(target.implementation, plugin, binding, argument), running.loaded.scheduler);
}

/**
 * Calls a view node's binding under the read deadline, with the row's `item` or `items` merged over
 * its declared argument.
 *
 * @implNote A binding DECLARED in a manifest to a service the plugin does not provide is already
 * refused at load, by V3 in `assertManifest` when the bundle is scanned; it is refused again here
 * because this also takes a binding from its caller, which no scan has seen.
 */
export function callBinding(running: RunningHost, plugin: string, binding: UiBinding, row: RowArgument = {}): Promise<CapabilityCall<unknown>> {
  return call(running, plugin, binding, row, DEFAULT_CALL_TIMEOUT_MS);
}

/**
 * Runs one of a plugin's declared actions under the invoke deadline, `input` laid over its declared
 * argument; a row passes `{ item: <id> }`, which no input overrides.
 */
export async function runAction(running: RunningHost, plugin: string, actionId: string, row: RowArgument = {}, input: Record<string, unknown> = {}): Promise<CapabilityCall<unknown>> {
  const action = deployedManifest(running, plugin)?.actions?.[actionId];
  if (action === undefined) {
    return { ok: false, error: pluginError(plugin, `${plugin} declares no action ${actionId}`, `run an action ${plugin} lists under actions`) };
  }
  return call(running, plugin, action.call, row, DEFAULT_INVOKE_TIMEOUT_MS, input);
}
