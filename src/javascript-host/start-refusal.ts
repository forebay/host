import { isPluginError } from "@weivel/typescript/engine";
import { HostRefusal } from "../host-refusal.js";
import { REINSTALL_FIX } from "./cached-layer.js";

/** Why a start failed and what fixes it, from a host refusal and a weivel plugin error alike; anything else is fixed by installing again. */
export function startRefusalOf(error: unknown): { detail: string; fix: string } {
  const refusal = error instanceof HostRefusal || isPluginError(error) ? error : undefined;
  return { detail: refusal?.detail ?? (error instanceof Error ? error.message : String(error)), fix: refusal?.fix ?? REINSTALL_FIX };
}
