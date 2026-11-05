import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin, PluginContext } from "@weivel/typescript";
import type { IrRequest, IrStreamEvent, Provider } from "../../../contracts/index.js";
import type { AccountsService } from "../../../forebay-library/types.js";

const SCENARIOS = ["ok", "429", "first-fails", "third-fails", "stream", "hangs"];

function record(provider: string, model: string, event: string): void {
  const log = process.env.FIXTURE_PROVIDER_LOG;
  if (log !== undefined) appendFileSync(log, `${JSON.stringify({ provider, model, event })}\n`);
}

function textOf(request: IrRequest): string {
  return request.messages.flatMap((message) => message.content).map((block) => (block.kind === "text" ? block.text : "")).join("");
}

function events(model: string, text: string): IrStreamEvent[] {
  return [
    { event: "message_start", id: "msg_1", model, role: "assistant" },
    { event: "content_block_start", index: 0, blockKind: "text" },
    { event: "text_delta", index: 0, text },
    { event: "content_block_stop", index: 0 },
    { event: "message_delta", stopReason: "end_turn" },
    { event: "message_stop" },
  ];
}

async function* failingAfter(model: string, delivered: number): AsyncGenerator<IrStreamEvent> {
  const all = events(model, "partial");
  for (let index = 0; index < delivered; index++) yield all[index] as IrStreamEvent;
  throw new Error(`upstream of ${model} broke after ${delivered} events`);
}

function untilAborted(provider: string, model: string, signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      record(provider, model, "aborted");
      reject(new Error("aborted"));
    });
  });
}

function providerFor(id: string): Provider {
  return {
    models: () => ({ models: SCENARIOS.map((scenario) => ({ id: `${id}-${scenario}`, name: `${id} ${scenario}`, context: 1000, output: 100 })), defaultModelId: `${id}-ok` }),
    handleIr: (request, signal) => {
      record(id, request.model, "handled");
      const scenario = request.model.slice(id.length + 1);
      if (scenario === "429") return { status: 429, headers: { "retry-after": "30" }, body: "limited" };
      if (scenario === "first-fails") return failingAfter(request.model, 0);
      if (scenario === "third-fails") return failingAfter(request.model, 2);
      if (scenario === "hangs") return untilAborted(id, request.model, signal);
      const text = `served ${request.model}: ${textOf(request)}`;
      if (scenario === "stream" || request.stream) return events(request.model, text);
      return { id: "msg_1", model: request.model, stopReason: "end_turn", content: [{ kind: "text", text }] };
    },
  };
}

function loginService(context: PluginContext) {
  return {
    login: (argument: { label: string }) => {
      const accounts = context.services.get(context.service<AccountsService>("accounts"));
      if (accounts === undefined) throw new Error("no accounts service");
      mkdirSync(context.paths.plugin, { recursive: true });
      const store = join(context.paths.plugin, "accounts.json");
      const { outcome } = accounts.upsert({ store, account: { id: argument.label, label: argument.label } });
      return { outcome, accounts: (accounts.list({ store }).accounts ?? []).map((account) => account.id) };
    },
  };
}

const plugin: Plugin = {
  activate(context) {
    const id = context.manifest.id;
    context.provide(context.capability<Provider>("provider"), providerFor(id));
    context.services.register(context.service(`${id}:accounts`), loginService(context));
  },
  deactivate() {},
};

export default plugin;
