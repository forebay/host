import type { ServerResponse } from "node:http";
import type { ErrorEvent, IrStreamEvent } from "../contracts/index.js";
import type { ContractChecks } from "./contracts.js";
import type { FrontDoorCalls } from "./front-door.js";

const STREAM_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache" };
const MID_STREAM_ERROR_TYPE = "api_error";

/** How a relayed stream ended: failed before a byte was written, so the next chain entry may serve it; relayed; or abandoned by the client. */
export type RelayOutcome = { kind: "failed-before-bytes"; error: unknown } | { kind: "relayed" } | { kind: "aborted" };

export interface StreamRelay {
  frontDoor: Pick<FrontDoorCalls, "encodeEvent">;
  checks: ContractChecks;
  response: ServerResponse;
  signal: AbortSignal;
  onMidStreamFailure(error: unknown): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stopQuietly(iterator: AsyncIterator<IrStreamEvent>): void {
  void Promise.resolve(iterator.return?.()).catch(() => undefined);
}

async function pulled(iterator: AsyncIterator<IrStreamEvent>, checks: ContractChecks): Promise<IrStreamEvent | undefined> {
  const next = await iterator.next();
  return next.done === true ? undefined : checks.check<IrStreamEvent>("IrStreamEvent", next.value, "a streamed event");
}

async function written(relay: StreamRelay, event: IrStreamEvent): Promise<void> {
  for (const chunk of await relay.frontDoor.encodeEvent(event)) relay.response.write(chunk);
}

/** @implNote The error event's own encoding may fail too; the stream is ended either way, never left open. */
async function endWithError(relay: StreamRelay, error: unknown): Promise<void> {
  relay.onMidStreamFailure(error);
  const event: ErrorEvent = { event: "error", errorType: MID_STREAM_ERROR_TYPE, message: messageOf(error) };
  try {
    await written(relay, event);
  } finally {
    relay.response.end();
  }
}

async function firstEvent(iterator: AsyncIterator<IrStreamEvent>, checks: ContractChecks): Promise<IrStreamEvent> {
  const first = await pulled(iterator, checks);
  if (first === undefined) throw new Error("the stream ended before its first event");
  return first;
}

async function relayRest(iterator: AsyncIterator<IrStreamEvent>, relay: StreamRelay): Promise<RelayOutcome> {
  for (;;) {
    let event: IrStreamEvent | undefined;
    try {
      event = await pulled(iterator, relay.checks);
      if (relay.signal.aborted) break;
      if (event === undefined) {
        relay.response.end();
        return { kind: "relayed" };
      }
      await written(relay, event);
    } catch (error) {
      if (relay.signal.aborted) break;
      await endWithError(relay, error);
      return { kind: "relayed" };
    }
  }
  stopQuietly(iterator);
  return { kind: "aborted" };
}

/**
 * Relays a provider's events through the front door's encoding. The first event is pulled and
 * encoded before any byte is written, so a stream that fails on it can still fall over; once bytes
 * are written, a failure ends the stream with an encoded IR `error` event.
 */
export async function relayStream(events: AsyncIterable<IrStreamEvent>, relay: StreamRelay): Promise<RelayOutcome> {
  const iterator = events[Symbol.asyncIterator]();
  let chunks: string[];
  try {
    const first = await firstEvent(iterator, relay.checks);
    chunks = await relay.frontDoor.encodeEvent(first);
  } catch (error) {
    stopQuietly(iterator);
    return relay.signal.aborted ? { kind: "aborted" } : { kind: "failed-before-bytes", error };
  }
  if (relay.signal.aborted) {
    stopQuietly(iterator);
    return { kind: "aborted" };
  }
  relay.response.writeHead(200, STREAM_HEADERS);
  for (const chunk of chunks) relay.response.write(chunk);
  return relayRest(iterator, relay);
}
