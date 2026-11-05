import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_INVOKE_TIMEOUT_MS } from "@weivel/typescript/host";
import type { Scheduler } from "@weivel/typescript";
import type { IrFailure, IrRequest, IrResponse, IrStreamEvent, ModelsAnswer, Provider } from "../contracts/index.js";
import type { ContractChecks } from "./contracts.js";
import { calledPlugin } from "./plugin-call.js";

export const PROVIDER_CAPABILITY = "provider";

/** What one `handleIr` answered once checked: a whole answer, a failure, or events still to pull. */
export type ProviderAnswer =
  | { kind: "response"; response: IrResponse }
  | { kind: "failure"; failure: IrFailure }
  | { kind: "stream"; events: AsyncIterable<IrStreamEvent> };

/** A provider's two functions, its id being its plugin id. */
export interface ProviderCalls {
  id: string;
  models(): Promise<ModelsAnswer>;
  handleIr(request: IrRequest, signal: AbortSignal): Promise<ProviderAnswer>;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && typeof (value as Record<symbol, unknown>)[Symbol.asyncIterator] === "function";
}

async function* eventsOf(source: Iterable<unknown> | AsyncIterable<unknown>): AsyncGenerator<unknown> {
  yield* source;
}

/** @implNote Each streamed event is checked as it is pulled, by the relay, so a bad event mid-stream is a mid-stream failure. */
function answerOf(id: string, answer: unknown, checks: ContractChecks): ProviderAnswer {
  if (isAsyncIterable(answer) || Array.isArray(answer)) return { kind: "stream", events: eventsOf(answer) as AsyncIterable<IrStreamEvent> };
  if (checks.matches("IrFailure", answer)) return { kind: "failure", failure: answer as IrFailure };
  return { kind: "response", response: checks.check<IrResponse>("IrResponse", answer, `${id}'s handleIr answer`) };
}

export function providerCalls(id: string, provider: Provider, checks: ContractChecks, scheduler: Scheduler): ProviderCalls {
  return {
    id,
    models: async () => checks.check<ModelsAnswer>("ModelsAnswer", await calledPlugin(id, `${PROVIDER_CAPABILITY}.models`, DEFAULT_CALL_TIMEOUT_MS, () => provider.models(), scheduler), `${id}'s models answer`),
    handleIr: async (request, signal) => answerOf(id, await calledPlugin(id, `${PROVIDER_CAPABILITY}.handleIr`, DEFAULT_INVOKE_TIMEOUT_MS, () => provider.handleIr(request, signal), scheduler), checks),
  };
}
