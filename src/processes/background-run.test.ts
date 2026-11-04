import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdersFile, NO_HOLDERS, readHolders, writeHolders } from "./holders.js";
import { runUntilUnheld } from "./background-run.js";

const HOST = "background-fixture";
const INTERVAL = 200;
const ALLOWANCE = 1000;

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

function withinMilliseconds<T>(work: Promise<T>, milliseconds: number): Promise<T | "timed out"> {
  return Promise.race([work, new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), milliseconds))]);
}

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "host-background-run-"));
  started = [];
});

afterEach(async () => {
  try {
    for (const child of started) child.kill("SIGKILL");
    await Promise.all(started.map(exited));
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

describe("runUntilUnheld", () => {
  it("stamps itself alive while its start hangs, and abandons the start once no holder is alive", async () => {
    const holder = sleeper();
    writeHolders(state, HOST, { ...NO_HOLDERS, pid: process.pid, holders: [holder.pid as number] });
    const controller = new AbortController();
    const ending = runUntilUnheld({ state, hostId: HOST, intervalMs: INTERVAL, signal: controller.signal, start: () => new Promise(() => {}) });

    await new Promise((resolve) => setTimeout(resolve, INTERVAL * 2));
    expect(readHolders(state, HOST)).toMatchObject({ pid: process.pid, checkMilliseconds: INTERVAL, aliveAt: expect.any(Number) });

    holder.kill("SIGKILL");
    await exited(holder);
    const end = await withinMilliseconds(ending, INTERVAL * 2 + ALLOWANCE);
    controller.abort();

    expect(end).toBe("abandoned");
    expect(existsSync(holdersFile(state, HOST))).toBe(false);
  });

  it("stops a host that did start once no holder is alive", async () => {
    const holder = sleeper();
    writeHolders(state, HOST, { ...NO_HOLDERS, pid: process.pid, holders: [holder.pid as number] });
    let stopped = false;
    const ending = runUntilUnheld({ state, hostId: HOST, intervalMs: INTERVAL, signal: new AbortController().signal, start: async () => ({ stop: async () => void (stopped = true) }) });

    holder.kill("SIGKILL");
    await exited(holder);

    expect(await withinMilliseconds(ending, INTERVAL * 2 + ALLOWANCE)).toBe("stopped");
    expect(stopped).toBe(true);
  });

  it("stops the host its start gives back late, after the start was abandoned", async () => {
    const holder = sleeper();
    writeHolders(state, HOST, { ...NO_HOLDERS, pid: process.pid, holders: [holder.pid as number] });
    let finishStart: (host: { stop(): Promise<void> }) => void = () => {};
    let stopped = false;
    const ending = runUntilUnheld({ state, hostId: HOST, intervalMs: INTERVAL, signal: new AbortController().signal, start: () => new Promise((resolve) => (finishStart = resolve)) });

    holder.kill("SIGKILL");
    await exited(holder);
    expect(await withinMilliseconds(ending, INTERVAL * 2 + ALLOWANCE)).toBe("abandoned");

    finishStart({ stop: async () => void (stopped = true) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stopped).toBe(true);
  });
});
