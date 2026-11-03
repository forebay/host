import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdBackgroundHost, releaseBackgroundHost } from "./background.js";
import { holdersFile, isProcessAlive, NO_HOLDERS, readHolders, writeHolders } from "./holders.js";

const HOST = "background-fixture";

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

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "host-background-"));
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

describe("holdBackgroundHost and releaseBackgroundHost", () => {
  it("starts one process for two holders and stamps it alive", async () => {
    const starter = countingStarter();
    const other = sleeper().pid as number;
    const before = Date.now();

    const first = await holdBackgroundHost(state, HOST, starter.start, process.pid);
    const second = await holdBackgroundHost(state, HOST, starter.start, other);

    expect(second).toBe(first);
    expect(starter.count()).toBe(1);
    const record = readHolders(state, HOST);
    expect(record).toMatchObject({ pid: first, checkMilliseconds: null, holders: [process.pid, other] });
    expect(record.aliveAt).toBeGreaterThanOrEqual(before);
  });

  it("only drops the holder on release and never signals the host, even when it was the last", async () => {
    const starter = countingStarter();
    const other = sleeper().pid as number;
    const pid = await holdBackgroundHost(state, HOST, starter.start, process.pid);
    await holdBackgroundHost(state, HOST, starter.start, other);

    await releaseBackgroundHost(state, HOST, process.pid);
    expect(readHolders(state, HOST)).toMatchObject({ pid, holders: [other] });

    await releaseBackgroundHost(state, HOST, other);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(isProcessAlive(pid)).toBe(true);
    expect(readHolders(state, HOST)).toMatchObject({ pid, holders: [] });
  });

  it("starts a new process when the recorded one is dead", async () => {
    const dead = sleeper();
    dead.kill("SIGKILL");
    await exited(dead);
    writeHolders(state, HOST, { pid: dead.pid as number, aliveAt: Date.now(), checkMilliseconds: 200, holders: [] });
    const starter = countingStarter();

    const pid = await holdBackgroundHost(state, HOST, starter.start, process.pid);

    expect(starter.count()).toBe(1);
    expect(pid).not.toBe(dead.pid);
    expect(readHolders(state, HOST)).toMatchObject({ pid, holders: [process.pid] });
  });

  it("starts a fresh host when the recorded pid is alive but its stamp is older than three checks", async () => {
    const unrelated = sleeper().pid as number;
    writeHolders(state, HOST, { pid: unrelated, aliveAt: Date.now() - 2000, checkMilliseconds: 200, holders: [] });
    const starter = countingStarter();

    const pid = await holdBackgroundHost(state, HOST, starter.start, process.pid);

    expect(starter.count()).toBe(1);
    expect(pid).not.toBe(unrelated);
    expect(isProcessAlive(unrelated)).toBe(true);
  });

  it("keeps a host whose stamp is fresh", async () => {
    const running = sleeper().pid as number;
    writeHolders(state, HOST, { pid: running, aliveAt: Date.now(), checkMilliseconds: 200, holders: [] });
    const starter = countingStarter();

    expect(await holdBackgroundHost(state, HOST, starter.start, process.pid)).toBe(running);
    expect(starter.count()).toBe(0);
  });

  it("holds once however often the same holder asks, and leaves no file once nothing is recorded", async () => {
    const starter = countingStarter();
    await holdBackgroundHost(state, HOST, starter.start, process.pid);
    const pid = await holdBackgroundHost(state, HOST, starter.start, process.pid);
    expect(readHolders(state, HOST)).toMatchObject({ pid, holders: [process.pid] });
    writeHolders(state, HOST, NO_HOLDERS);
    expect(existsSync(holdersFile(state, HOST))).toBe(false);
  });
});
