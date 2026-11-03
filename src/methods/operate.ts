import type { InstallMethodOperationAnswer } from "@weivel/typescript/host";
import type { RunningHost } from "../start.js";
import { askProvider } from "./ask.js";
import { installMethodProviders } from "./providers.js";

export type Operation = "install" | "update" | "remove";

function refusal(detail: string, fix: string): InstallMethodOperationAnswer {
  return { ok: false, detail, fix };
}

/** Drives one operation through the provider serving `method`, answering the checked success or refusal. */
export async function operate(
  running: RunningHost,
  method: string,
  operation: Operation,
  packageName: string,
  options?: object,
): Promise<InstallMethodOperationAnswer> {
  const provider = installMethodProviders(running).find((candidate) => candidate.method === method && candidate.shadowedBy === undefined);
  if (provider === undefined) return refusal(`no installed plugin provides the ${method} install method`, `install and enable a plugin whose installMethod is ${method}`);
  const request = { package: packageName, ...(options === undefined ? {} : { options }) };
  const asked = await askProvider<InstallMethodOperationAnswer>(running, provider, operation, request);
  if (!asked.ok) return refusal(asked.refused, `fix ${provider.plugin}, or use another install method`);
  return asked.answer;
}
