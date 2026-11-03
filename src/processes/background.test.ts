import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdBackgroundHost, releaseBackgroundHost } from "./background.js";
import { holdersFile, isProcessAlive, readHolders, writeHolders } from "./holders.js";

const HOST = "background-fixture";
const GONE_WITHIN_MILLISECONDS = 5000;

let state: string;
let started: ChildProcess[];

function sleeper(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  started.push(child);
  return child;
}

function countingStarter(): { start: () => number; count: () => number } {
  let count = 0;
  return {
    start: () => {
      count += 1;
      return sleeper().pid as number;
    },
    count: () => count,
  };
}

async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

async function goneWithin(pid: number, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessAlive(pid);
}

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "host-background-"));
  started = [];
});

afterEach(async () => {
  for (const child of started) child.kill("SIGKILL");
  await Promise.all(started.map(exited));
  rmSync(state, { recursive: true, force: true });
});

describe("holdBackgroundHost and releaseBackgroundHost", () => {
  it("starts one process for two holders, keeps it for the second, and stops it with the last", async () => {
    const starter = countingStarter();
    const other = sleeper().pid as number;

    const first = await holdBackgroundHost(state, HOST, starter.start, process.pid);
    const second = await holdBackgroundHost(state, HOST, starter.start, other);

    expect(second).toBe(first);
    expect(starter.count()).toBe(1);
    expect(readHolders(state, HOST)).toEqual({ pid: first, holders: [process.pid, other] });

    await releaseBackgroundHost(state, HOST, process.pid);
    expect(isProcessAlive(first)).toBe(true);
    expect(readHolders(state, HOST)).toEqual({ pid: first, holders: [other] });

    await releaseBackgroundHost(state, HOST, other);
    expect(await goneWithin(first, GONE_WITHIN_MILLISECONDS)).toBe(true);
    expect(existsSync(holdersFile(state, HOST))).toBe(false);
  });

  it("starts a new process when the recorded one is dead", async () => {
    const dead = sleeper();
    dead.kill("SIGKILL");
    await exited(dead);
    writeHolders(state, HOST, { pid: dead.pid as number, holders: [] });
    const starter = countingStarter();

    const pid = await holdBackgroundHost(state, HOST, starter.start, process.pid);

    expect(starter.count()).toBe(1);
    expect(pid).not.toBe(dead.pid);
    expect(readHolders(state, HOST)).toEqual({ pid, holders: [process.pid] });
  });

  it("stops the process when every holder left is dead", async () => {
    const starter = countingStarter();
    const crashed = sleeper();
    const pid = await holdBackgroundHost(state, HOST, starter.start, crashed.pid as number);
    await holdBackgroundHost(state, HOST, starter.start, process.pid);
    crashed.kill("SIGKILL");
    await exited(crashed);

    await releaseBackgroundHost(state, HOST, process.pid);

    expect(await goneWithin(pid, GONE_WITHIN_MILLISECONDS)).toBe(true);
    expect(existsSync(holdersFile(state, HOST))).toBe(false);
  });

  it("holds once however often the same holder asks", async () => {
    const starter = countingStarter();
    await holdBackgroundHost(state, HOST, starter.start, process.pid);
    const pid = await holdBackgroundHost(state, HOST, starter.start, process.pid);
    expect(readHolders(state, HOST)).toEqual({ pid, holders: [process.pid] });
  });
});
