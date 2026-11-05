import { callCapability } from "@weivel/typescript/host";
import type { Scheduler } from "@weivel/typescript";

/** Calls into a plugin under a deadline, answering its value or throwing the plugin error `callCapability` answered. */
export async function calledPlugin<T>(pluginId: string, label: string, timeoutMilliseconds: number, call: () => T | Promise<T>, scheduler: Scheduler): Promise<T> {
  const answer = await callCapability(pluginId, label, timeoutMilliseconds, async () => call(), scheduler);
  if (!answer.ok) throw answer.error;
  return answer.value;
}
