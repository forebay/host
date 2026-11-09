import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { IrStreamEvent } from "../contracts/index.js";
import type { ContractChecks } from "./contracts.js";
import { relayStream } from "./stream.js";
import type { RelayOutcome, StreamRelay } from "./stream.js";

const EVENT_COUNT = 3;

/** A response whose socket buffer is always full, the state a client that has stopped reading leaves it in. */
class FullResponse extends EventEmitter {
  readonly chunks: string[] = [];
  ended = false;

  writeHead(): this {
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return false;
  }

  end(): void {
    this.ended = true;
  }
}

interface Relaying {
  response: FullResponse;
  pulled: () => number;
  controller: AbortController;
  outcome: Promise<RelayOutcome>;
}

function afterPendingWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function startRelay(): Relaying {
  let pulled = 0;
  async function* events(): AsyncGenerator<IrStreamEvent> {
    for (let index = 0; index < EVENT_COUNT; index++) {
      pulled++;
      yield { event: "content_block_stop", index };
    }
  }
  const response = new FullResponse();
  const controller = new AbortController();
  const relay: StreamRelay = {
    frontDoor: { encodeEvent: async (event) => [JSON.stringify(event)] },
    checks: { check: <Value>(_name: string, value: unknown) => value as Value } as unknown as ContractChecks,
    response: response as unknown as ServerResponse,
    signal: controller.signal,
    onMidStreamFailure: () => undefined,
  };
  return { response, pulled: () => pulled, controller, outcome: relayStream(events(), relay) };
}

describe("relaying to a client that has stopped reading", () => {
  it("pulls no further event until the response drains", async () => {
    const relaying = startRelay();
    await afterPendingWork();
    expect(relaying.pulled()).toBe(1);
    expect(relaying.response.chunks).toHaveLength(1);
    relaying.response.emit("drain");
    await afterPendingWork();
    expect(relaying.pulled()).toBe(2);
    expect(relaying.response.chunks).toHaveLength(2);
    relaying.controller.abort();
  });

  it("finishes the stream once every write has drained", async () => {
    const relaying = startRelay();
    for (let index = 0; index < EVENT_COUNT; index++) {
      await afterPendingWork();
      relaying.response.emit("drain");
    }
    expect(await relaying.outcome).toEqual({ kind: "relayed" });
    expect(relaying.response.ended).toBe(true);
  });

  it("stops waiting when the client goes away", async () => {
    const relaying = startRelay();
    await afterPendingWork();
    relaying.controller.abort();
    expect(await relaying.outcome).toEqual({ kind: "aborted" });
    expect(relaying.pulled()).toBe(1);
  });
});
