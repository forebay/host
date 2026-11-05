import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin, PluginContext } from "@weivel/typescript";
import type { HandleIrResult, IrRequest, IrStreamEvent, ModelsAnswer, Provider } from "../../../contracts/index.js";
import type { AccountsService } from "../../../forebay-library/types.js";

const SCENARIOS = ["ok", "429", "429-milliseconds", "400", "first-fails", "third-fails", "stream", "hangs", "stalls"];
const FAILURE_HEADERS = {
  "content-encoding": "gzip",
  "content-length": "999",
  connection: "x-hop",
  "x-hop": "1",
  "keep-alive": "timeout=77",
  "proxy-authenticate": "Basic",
  "x-kept": "yes",
};

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

async function* stallingAfterTwo(provider: string, model: string, signal: AbortSignal): AsyncGenerator<IrStreamEvent> {
  const all = events(model, "partial");
  yield all[0] as IrStreamEvent;
  yield all[1] as IrStreamEvent;
  await untilAborted(provider, model, signal);
}

function untilAborted(provider: string, model: string, signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      record(provider, model, "aborted");
      reject(new Error("aborted"));
    });
  });
}

const SLOW_MODELS_MILLISECONDS = 8000;

function accountStore(context: PluginContext): string {
  return join(context.paths.plugin, "accounts.json");
}

/** Under `FIXTURE_MODELS_AFTER_LOGIN`, a provider offers no model until its login action has stored an account. */
function isLoggedOut(context: PluginContext): boolean {
  return process.env.FIXTURE_MODELS_AFTER_LOGIN === "1" && !existsSync(accountStore(context));
}

/** Under `FIXTURE_SLOW_MODELS=<id>`, that provider answers its models only after a while. */
async function modelsOf(id: string, context: PluginContext): Promise<ModelsAnswer> {
  if (process.env.FIXTURE_SLOW_MODELS === id) await new Promise((resolve) => setTimeout(resolve, SLOW_MODELS_MILLISECONDS));
  if (isLoggedOut(context)) return { models: [] };
  return { models: SCENARIOS.map((scenario) => ({ id: `${id}-${scenario}`, name: `${id} ${scenario}`, context: 1000, output: 100 })), defaultModelId: `${id}-ok` };
}

function providerFor(id: string, context: PluginContext): Provider {
  return {
    models: () => modelsOf(id, context),
    handleIr: (request, signal): HandleIrResult | Promise<HandleIrResult> => {
      record(id, request.model, "handled");
      const scenario = request.model.slice(id.length + 1);
      if (scenario === "429") return { status: 429, headers: { "retry-after": "30" }, body: "limited" };
      if (scenario === "429-milliseconds") return { status: 429, headers: {}, body: "limited", retryAfterMilliseconds: 60000 };
      if (scenario === "400") return { status: 400, headers: FAILURE_HEADERS, body: "bad request" };
      if (scenario === "stalls") return stallingAfterTwo(id, request.model, signal);
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
    wait: (argument: { milliseconds: number }) => new Promise((resolve) => setTimeout(() => resolve({ waited: argument.milliseconds }), argument.milliseconds)),
    login: (argument: { label: string }) => {
      const accounts = context.services.get(context.service<AccountsService>("accounts"));
      if (accounts === undefined) throw new Error("no accounts service");
      mkdirSync(context.paths.plugin, { recursive: true });
      const store = accountStore(context);
      const { outcome } = accounts.upsert({ store, account: { id: argument.label, label: argument.label } });
      return { outcome, accounts: (accounts.list({ store }).accounts ?? []).map((account) => account.id) };
    },
  };
}

const plugin: Plugin = {
  activate(context) {
    const id = context.manifest.id;
    context.provide(context.capability<Provider>("provider"), providerFor(id, context));
    context.services.register(context.service(`${id}:accounts`), loginService(context));
  },
  deactivate() {},
};

export default plugin;
