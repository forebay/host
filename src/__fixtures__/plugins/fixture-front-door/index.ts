import type { Plugin } from "@weivel/typescript";
import type { FrontDoor, IrResponse, WireRequest } from "../../../contracts/index.js";

const TIERS = ["plain", "limited", "exhausted", "firstfail", "thirdfail", "hanging"];
const JSON_HEADERS = { "content-type": "application/json" };
/** Matches no provider model, so the tiers are the fallback and the stored model map decides every chain. */
const TIER_PATTERN_MATCHING_NO_MODEL = "^tier-([a-z]+)-\\d";

function decodeRequest(request: WireRequest) {
  try {
    const wire = JSON.parse(request.body) as { model: string; text: string; stream?: boolean };
    return { model: wire.model, stream: wire.stream === true, messages: [{ role: "user", content: [{ kind: "text" as const, text: wire.text }] }] };
  } catch {
    return { status: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "not json" }) };
  }
}

function encodeResponse(response: IrResponse) {
  const text = response.content.map((block) => (block.kind === "text" ? block.text : "")).join("");
  return { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ id: response.id, model: response.model, text }) };
}

const frontDoor: FrontDoor = {
  profile: () => ({
    tierSourceProvider: "provider-a",
    tierOrder: TIERS,
    tierFallback: TIERS,
    tierRegex: TIER_PATTERN_MATCHING_NO_MODEL,
    envPrefix: "FIXTURE",
    nativeModelPattern: null,
    defaultContext: 1000,
    defaultOutput: 100,
    upstream: process.env.FIXTURE_UPSTREAM ?? "http://127.0.0.1:1",
  }),
  decodeRequest,
  encodeResponse,
  encodeEvent: (event) => ({ chunks: [`event: ${event.event}\n`, `data: ${JSON.stringify(event)}\n\n`] }),
  rateLimitReply: (argument) => ({ status: 429, headers: JSON_HEADERS, body: JSON.stringify({ limited: true, resetAt: argument.resetAt ?? null, retryAfter: argument.upstreamHeaders["retry-after"] ?? null }) }),
};

const plugin: Plugin = {
  activate(context) {
    context.provide(context.capability<FrontDoor>("front-door"), frontDoor);
  },
  deactivate() {},
};

export default plugin;
