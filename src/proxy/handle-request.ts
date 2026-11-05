import type { IncomingMessage, ServerResponse } from "node:http";
import type { IrRequest, ModelsAnswer, Profile } from "../contracts/index.js";
import type { Assignment, ModelMap, ModelsArgument, RoutingService } from "../forebay-library/types.js";
import { bufferedRequest, flatHeaders } from "./buffered-request.js";
import type { BufferedRequest } from "./buffered-request.js";
import type { ContractChecks } from "./contracts.js";
import type { FrontDoorCalls } from "./front-door.js";
import { isModelsPath, writeModels } from "./model-listing.js";
import { passThrough } from "./pass-through.js";
import type { ProviderAnswer, ProviderCalls } from "./providers.js";
import { writeProxyError, writeReply } from "./replies.js";
import { relayStream } from "./stream.js";

const HEALTH_PATH = "/health";
const BAD_GATEWAY = 502;
const INTERNAL_ERROR = 500;

/** Where the session host writes what it decided, its log only. */
export interface ProxyLog {
  info(message: string): void;
  warn(message: string): void;
}

/** What routing a request reads: the models the providers answered and the model map derived from them, as of the last refresh. */
export interface RoutingSnapshot {
  models: ModelsArgument;
  answers: Map<string, ModelsAnswer>;
  map: ModelMap;
}

export interface ProxyState {
  frontDoor: FrontDoorCalls;
  providers: Map<string, ProviderCalls>;
  routing: Pick<RoutingService, "resolve" | "outcome">;
  profile: Profile;
  checks: ContractChecks;
  snapshot(): RoutingSnapshot;
  log: ProxyLog;
  now(): number;
  timeZone: string;
}

interface RateLimited {
  headers: Record<string, string>;
  resetAt?: number;
}

/** What walking the chain has found so far: the last rate-limited answer, and the last failure that let the walk go on. */
interface ChainWalk {
  limited?: RateLimited;
  failure?: unknown;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pathOf(url: string): string {
  return new URL(url, "http://127.0.0.1").pathname;
}

/** @implNote `close` on the response fires both when it is finished and when the client goes away; only the second aborts. */
function abortOnDisconnect(response: ServerResponse): AbortController {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) controller.abort();
  });
  return controller;
}

function isFailure(decoded: unknown): decoded is { status: number } {
  return typeof decoded === "object" && decoded !== null && "status" in decoded;
}

/** @implNote Only a failure is asked about: `routing.outcome` reads a status and headers, which a whole response has neither of. */
async function answered(state: ProxyState, answer: ProviderAnswer, response: ServerResponse, signal: AbortSignal, walk: ChainWalk): Promise<boolean> {
  if (answer.kind === "response") {
    writeReply(response, await state.frontDoor.encodeResponse(answer.response));
    return true;
  }
  if (answer.kind === "failure") {
    const outcome = state.routing.outcome({ status: answer.failure.status, headers: answer.failure.headers, now: state.now() });
    if (!outcome.rateLimited) {
      writeReply(response, answer.failure);
      return true;
    }
    walk.limited = { headers: answer.failure.headers, ...(outcome.resetAt === undefined ? {} : { resetAt: outcome.resetAt }) };
    return false;
  }
  const relayed = await relayStream(answer.events, { frontDoor: state.frontDoor, checks: state.checks, response, signal, onMidStreamFailure: (error) => state.log.warn(`a stream failed after its first event: ${messageOf(error)}`) });
  if (relayed.kind !== "failed-before-bytes") return true;
  walk.failure = relayed.error;
  state.log.warn(`a stream failed on its first event, so the next chain entry serves it: ${messageOf(relayed.error)}`);
  return false;
}

/** Tries one chain entry, answering whether it ended the request. */
async function triedEntry(state: ProxyState, request: IrRequest, entry: Assignment, response: ServerResponse, signal: AbortSignal, walk: ChainWalk): Promise<boolean> {
  const provider = state.providers.get(entry.provider);
  if (provider === undefined) {
    walk.failure = new Error(`no running plugin provides ${entry.provider}, which the model map names for ${entry.model}`);
    state.log.warn(messageOf(walk.failure));
    return false;
  }
  let answer: ProviderAnswer;
  try {
    answer = await provider.handleIr({ ...request, model: entry.model }, signal);
  } catch (error) {
    if (signal.aborted) return true;
    walk.failure = error;
    state.log.warn(`${entry.provider} failed ${entry.model}, so the next chain entry serves it: ${messageOf(error)}`);
    return false;
  }
  if (signal.aborted) return true;
  return answered(state, answer, response, signal, walk);
}

async function exhausted(state: ProxyState, response: ServerResponse, walk: ChainWalk): Promise<void> {
  if (walk.limited === undefined) {
    writeProxyError(response, BAD_GATEWAY, `no chain entry could serve the request: ${messageOf(walk.failure)}`);
    return;
  }
  const { headers, resetAt } = walk.limited;
  writeReply(response, await state.frontDoor.rateLimitReply({ upstreamHeaders: headers, ...(resetAt === undefined ? {} : { resetAt }), now: state.now(), timeZone: state.timeZone }));
}

/** Each entry's provider in order; a rate-limited answer or a failure before any byte moves to the next, and a client gone away ends the walk silently. */
async function servedByChain(state: ProxyState, request: IrRequest, chain: Assignment[], response: ServerResponse, signal: AbortSignal): Promise<void> {
  const walk: ChainWalk = {};
  for (const entry of chain) {
    if (signal.aborted || (await triedEntry(state, request, entry, response, signal, walk))) return;
  }
  if (!signal.aborted) await exhausted(state, response, walk);
}

function chainFor(state: ProxyState, request: IrRequest, snapshot: RoutingSnapshot): Assignment[] {
  const resolved = state.routing.resolve({ profile: state.profile, map: snapshot.map, models: snapshot.models, requestedModel: request.model });
  if (resolved.refused !== undefined) throw new Error(`${resolved.refused}; ${resolved.fix ?? ""}`);
  for (const notice of resolved.notices ?? []) state.log.info(`routing ${request.model}: ${notice}`);
  return resolved.chain ?? [];
}

/** @implNote With no provider running every chain is empty, so the request goes upstream undecoded, whatever its path. */
async function routed(state: ProxyState, request: BufferedRequest, response: ServerResponse, signal: AbortSignal): Promise<void> {
  if (state.providers.size === 0) return passThrough(request, state.profile.upstream, response, signal);
  const decoded = await state.frontDoor.decodeRequest({ method: request.method, path: request.url, headers: flatHeaders(request.headers), body: request.body.toString("utf8") });
  if (isFailure(decoded)) {
    writeReply(response, decoded);
    return;
  }
  const chain = chainFor(state, decoded, state.snapshot());
  if (chain.length === 0) return passThrough(request, state.profile.upstream, response, signal);
  return servedByChain(state, decoded, chain, response, signal);
}

/**
 * Answers one request to the proxy: `/health`, the providers' models on `/v1/models`, and every
 * other request decoded by the front door, routed by `routing.resolve` and served by the chain.
 */
export async function handleRequest(state: ProxyState, incoming: IncomingMessage, response: ServerResponse): Promise<void> {
  const disconnect = abortOnDisconnect(response);
  try {
    const path = pathOf(incoming.url ?? "/");
    if (path === HEALTH_PATH) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    if (state.providers.size > 0 && isModelsPath(incoming.method ?? "GET", path)) {
      writeModels(response, path, state.snapshot().answers, state.profile);
      return;
    }
    await routed(state, await bufferedRequest(incoming), response, disconnect.signal);
  } catch (error) {
    if (disconnect.signal.aborted) return;
    state.log.warn(`a request failed: ${messageOf(error)}`);
    writeProxyError(response, INTERNAL_ERROR, messageOf(error));
  }
}
