import { callCapability, checkInstallMethodAnswer, DEFAULT_CALL_TIMEOUT_MS, DEFAULT_INVOKE_TIMEOUT_MS } from "@weivel/typescript/host";
import type { InstallMethodDefinition } from "@weivel/typescript/host";
import type { RunningHost } from "../start.js";
import { implementationOf } from "./providers.js";
import type { MethodProvider } from "./providers.js";

export type Verb = "detect" | "install" | "update" | "remove";

export type Asked<Answer> = { ok: true; answer: Answer } | { ok: false; refused: string };

const DEFINITION_OF: Record<Verb, InstallMethodDefinition> = {
  detect: "detectAnswer",
  install: "operationAnswer",
  update: "operationAnswer",
  remove: "operationAnswer",
};

function timeoutOf(verb: Verb): number {
  return verb === "detect" ? DEFAULT_CALL_TIMEOUT_MS : DEFAULT_INVOKE_TIMEOUT_MS;
}

function invoke(implementation: Record<string, unknown>, verb: Verb, request: object): Promise<unknown> {
  const method = implementation[verb];
  if (typeof method !== "function") return Promise.reject(new Error(`has no ${verb} method`));
  return Promise.resolve(method.call(implementation, request));
}

function pathsOf(issues: readonly { path: string }[]): string {
  return issues.map((issue) => issue.path || "(answer)").join(", ");
}

/**
 * Asks one provider and checks what it answered, so a throw, a hang and a malformed answer all come back as a refusal naming the provider.
 *
 * @implNote A provider takes one JSON request, `{ package, options? }`, so the call is expressible over a wire protocol.
 */
export async function askProvider<Answer>(
  running: RunningHost,
  provider: MethodProvider,
  verb: Verb,
  request: { package: string; options?: object },
): Promise<Asked<Answer>> {
  const found = implementationOf(running, provider);
  if (!found.ok) return { ok: false, refused: `${provider.plugin}: ${found.detail}` };
  const called = await callCapability(provider.plugin, `${provider.serviceId}.${verb}`, timeoutOf(verb), () => invoke(found.implementation, verb, request), running.loaded.scheduler);
  if (!called.ok) return { ok: false, refused: `${provider.plugin}: ${called.error.message}` };
  const issues = checkInstallMethodAnswer(DEFINITION_OF[verb], called.value);
  if (issues.length > 0) return { ok: false, refused: `${provider.plugin} answered ${verb} against the install-method schema wrongly at ${pathsOf(issues)}` };
  return { ok: true, answer: called.value as Answer };
}
