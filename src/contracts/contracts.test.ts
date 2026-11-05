import { Ajv } from "ajv";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  DecodeRequestAnswer, EncodeEventAnswer, EncodeResponseAnswer, Extensions, HandleIrAnswer, ImageBlock, IrBlock,
  IrEventStream, IrFailure, IrMessage, IrRequest, IrResponse, IrStopReason, IrStreamEvent, IrThinking, IrTool,
  IrToolChoice, IrUsage, ModelEntry, ModelsAnswer, PassThrough, Profile, ProfileAnswer, RateLimitReplyAnswer, TextBlock, ThinkingBlock,
  ToolResultBlock, ToolUseBlock, UnknownBlock, WireReply,
} from "./index.js";

const libraryFolder = join(import.meta.dirname, "..", "..", "siblings", "forebay-library");
const contractsFolder = join(libraryFolder, "contracts");
const vectorsFolder = join(libraryFolder, "test", "vectors", "ir");
const SCHEMA_FILES = ["ir.schema.json", "front-door.schema.json", "provider.schema.json"];

interface Vector {
  definition: string;
  valid: boolean;
  value: unknown;
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function buildValidators(): { ajv: Ajv; definitionReferences: Map<string, string> } {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const definitionReferences = new Map<string, string>();
  for (const file of SCHEMA_FILES) {
    const schema = readJson(join(contractsFolder, file));
    ajv.addSchema(schema);
    for (const name of Object.keys(schema.definitions)) definitionReferences.set(name, `${schema.$id}#/definitions/${name}`);
  }
  return { ajv, definitionReferences };
}

const text: TextBlock = { kind: "text", text: "hello", cacheControl: "ephemeral", extensions: { vendor: 1 } };
const image: ImageBlock = { kind: "image", mediaType: "image/png", data: "AAAA", url: null };
const toolUse: ToolUseBlock = { kind: "tool_use", id: "toolu_1", name: "lookup", input: { query: "x" } };
const toolResult: ToolResultBlock = { kind: "tool_result", toolUseId: "toolu_1", content: [text], isError: false };
const thinking: ThinkingBlock = { kind: "thinking", text: "hm", signature: "sig" };
const unknown: UnknownBlock = { kind: "unknown", raw: { type: "future" } };
const usage: IrUsage = { inputTokens: 1, outputTokens: 2, totalTokens: 3, cacheReadInputTokens: null };
const message: IrMessage = { role: "user", content: [text, image, toolUse, toolResult, thinking] };
const failure: IrFailure = { status: 429, headers: { "retry-after": "3" }, body: "slow down", retryAfterMilliseconds: 3000 };
const request: IrRequest = {
  model: "m", messages: [message], stream: false, system: [text], maxTokens: 10, temperature: 0.5, topP: 0.9, topK: 4,
  stopSequences: ["x"], metadata: { user: "u" }, thinking: { enabled: true, budgetTokens: 1024 },
  toolChoice: { type: "tool", name: "lookup" }, tools: [{ name: "lookup", inputSchema: { type: "object" }, description: null }],
};
const response: IrResponse = { id: "msg_1", model: "m", stopReason: "end_turn", content: [text], usage };
const profile: Profile = {
  defaultContext: 200000, defaultOutput: 8192, envPrefix: "ANTHROPIC", tierFallback: ["sonnet"], tierOrder: ["opus", "sonnet"],
  tierRegex: "^claude", tierSourceProvider: "anthropic", upstream: "https://example.test", nativeModelPattern: null,
};
const reply: WireReply = { status: 200, headers: { "content-type": "application/json" }, body: "{}" };
const modelEntry: ModelEntry = { id: "m", name: "M", context: 1, output: 1 };
const events: IrStreamEvent[] = [
  { event: "message_start", id: "msg_1", model: "m", role: "assistant", usage },
  { event: "content_block_start", index: 0, blockKind: "text" },
  { event: "text_delta", index: 0, text: "a" },
  { event: "thinking_delta", index: 1, text: "b" },
  { event: "thinking_signature", index: 1, signature: "s" },
  { event: "tool_input_delta", index: 2, partialJson: "{" },
  { event: "content_block_stop", index: 0 },
  { event: "message_delta", stopReason: "end_turn", usage },
  { event: "message_stop" },
  { event: "error", errorType: "overloaded_error", message: "again" },
];
const eventStream: IrEventStream = events;
const extensions: Extensions = { a: 1 };
const stopReason: IrStopReason = "end_turn";
const tool: IrTool = { name: "t", inputSchema: {} };
const toolChoice: IrToolChoice = { type: "auto" };
const thinkingOption: IrThinking = { enabled: false };
const anyBlock: IrBlock = unknown;
const decoded: DecodeRequestAnswer = request;
const encoded: EncodeResponseAnswer = reply;
const eventAnswer: EncodeEventAnswer = { chunks: ["a"] };
const rateLimit: RateLimitReplyAnswer = reply;
const models: ModelsAnswer = { models: [modelEntry], defaultModelId: "m" };
const handled: HandleIrAnswer = response;
const passThrough: PassThrough = { passThrough: true };
const profileAnswer: ProfileAnswer = profile;
const passedThrough: DecodeRequestAnswer = passThrough;

const typedLiterals: Record<string, unknown> = {
  Extensions: extensions, NullableString: null, NullableCount: 0, BlockIndex: 0, IrStopReason: stopReason, IrUsage: usage,
  IrTool: tool, IrToolChoice: toolChoice, IrThinking: thinkingOption, IrMessage: message, TextBlock: text, ImageBlock: image,
  ToolUseBlock: toolUse, ToolResultBlock: toolResult, ThinkingBlock: thinking, UnknownBlock: unknown, IrBlock: anyBlock,
  IrRequest: request, IrResponse: response, MessageStartEvent: events[0], ContentBlockStartEvent: events[1],
  TextDeltaEvent: events[2], ThinkingDeltaEvent: events[3], ThinkingSignatureEvent: events[4], ToolInputDeltaEvent: events[5],
  ContentBlockStopEvent: events[6], MessageDeltaEvent: events[7], MessageStopEvent: events[8], ErrorEvent: events[9],
  IrStreamEvent: events[2], IrFailure: failure, Profile: profile, WireReply: reply, DecodeRequestAnswer: decoded,
  EncodeResponseAnswer: encoded, EncodeEventAnswer: eventAnswer, RateLimitReplyAnswer: rateLimit, ModelEntry: modelEntry,
  ModelsAnswer: models, IrEventStream: eventStream, HandleIrAnswer: handled, PassThrough: passThrough, ProfileAnswer: profileAnswer,
};

describe("forebay contract types", () => {
  const { ajv, definitionReferences } = buildValidators();

  it("has a typed literal for every definition the schemas declare", () => {
    expect([...definitionReferences.keys()].filter((name) => !(name in typedLiterals))).toEqual([]);
  });

  it("accepts every typed literal under its own schema definition", () => {
    for (const [name, reference] of definitionReferences) {
      const validate = ajv.getSchema(reference);
      expect(validate, name).toBeDefined();
      expect(validate!(typedLiterals[name]), `${name}: ${ajv.errorsText(validate!.errors)}`).toBe(true);
    }
  });

  it("accepts a pass-through as a decodeRequest answer", () => {
    const validate = ajv.getSchema(definitionReferences.get("DecodeRequestAnswer")!)!;
    expect(validate(passedThrough), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("accepts every typed event literal under the stream event union", () => {
    const validate = ajv.getSchema(definitionReferences.get("IrStreamEvent")!)!;
    for (const event of events) expect(validate(event), JSON.stringify(event)).toBe(true);
  });

  const vectorFiles = readdirSync(vectorsFolder).filter((file) => file.endsWith(".json"));

  it("reads the library's IR vectors", () => {
    expect(vectorFiles.length).toBeGreaterThan(20);
  });

  it.each(vectorFiles)("agrees with the library vector %s", (file) => {
    const vector: Vector = readJson(join(vectorsFolder, file));
    const validate = ajv.getSchema(definitionReferences.get(vector.definition)!)!;
    expect(validate(vector.value), ajv.errorsText(validate.errors)).toBe(vector.valid);
  });
});
