import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdersFile, readHolders, writeHolders } from "./holders.js";
import { selfExitWhenUnheld } from "./self-exit.js";

const HOST = "background-fixture";
const INTERVAL = 200;

let state: string;
let started: ChildProcess[];

function sleeper(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  started.push(child);
  return child;
}

async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

function settled(promise: Promise<unknown>): () => boolean {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  return () => done;
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "host-self-exit-"));
  started = [];
});

afterEach(async () => {
  for (const child of started) child.kill("SIGKILL");
  await Promise.all(started.map(exited));
  rmSync(state, { recursive: true, force: true });
});

describe("selfExitWhenUnheld", () => {
  it("keeps running while a holder lives, and ends within two intervals of the last one dying", async () => {
    const holder = sleeper();
    writeHolders(state, HOST, { pid: process.pid, holders: [holder.pid as number] });
    const done = settled(selfExitWhenUnheld(state, HOST, INTERVAL));

    await waitFor(INTERVAL * 3);
    expect(done()).toBe(false);

    holder.kill("SIGKILL");
    await exited(holder);
    await waitFor(INTERVAL * 2 + 100);

    expect(done()).toBe(true);
    expect(existsSync(holdersFile(state, HOST))).toBe(false);
  });

  it("prunes a dead holder and keeps the live ones", async () => {
    const living = sleeper();
    const dying = sleeper();
    writeHolders(state, HOST, { pid: process.pid, holders: [living.pid as number, dying.pid as number] });
    const controller = new AbortController();
    const running = selfExitWhenUnheld(state, HOST, INTERVAL, controller.signal);

    dying.kill("SIGKILL");
    await exited(dying);
    await waitFor(INTERVAL * 2 + 100);

    expect(readHolders(state, HOST)).toEqual({ pid: process.pid, holders: [living.pid] });
    controller.abort();
    await running;
  });

  it("ends when it is aborted, leaving the record as it was", async () => {
    const holder = sleeper();
    writeHolders(state, HOST, { pid: process.pid, holders: [holder.pid as number] });
    const controller = new AbortController();
    const running = selfExitWhenUnheld(state, HOST, INTERVAL, controller.signal);
    controller.abort();
    await running;
    expect(readHolders(state, HOST)).toEqual({ pid: process.pid, holders: [holder.pid] });
  });

  it("ends at once when nothing holds it", async () => {
    const started = Date.now();
    await selfExitWhenUnheld(state, HOST, INTERVAL);
    expect(Date.now() - started).toBeLessThan(INTERVAL * 2 + 500);
  });
});
