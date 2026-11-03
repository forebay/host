import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdersFile, isProcessAlive, readHolders, withHoldersLock, writeHolders } from "./holders.js";

const HOST = "background-fixture";

let state: string;

function lockFile(): string {
  return join(state, "processes", `${HOST}.lock`);
}

function writeLock(pid: number, ageMilliseconds = 0): void {
  mkdirSync(join(state, "processes"), { recursive: true });
  writeFileSync(lockFile(), String(pid));
  const at = new Date(Date.now() - ageMilliseconds);
  utimesSync(lockFile(), at, at);
}

function exitedPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid as number;
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "host-holders-"));
});

afterEach(() => {
  rmSync(state, { recursive: true, force: true });
});

describe("the holders file", () => {
  it("reads back what was written, and reads as empty when there is none", () => {
    expect(readHolders(state, HOST)).toEqual({ pid: null, holders: [] });
    writeHolders(state, HOST, { pid: 41, holders: [7, 9] });
    expect(readHolders(state, HOST)).toEqual({ pid: 41, holders: [7, 9] });
    expect(JSON.parse(readFileSync(holdersFile(state, HOST), "utf8"))).toEqual({ pid: 41, holders: [7, 9] });
  });

  it("removes the file once it records neither a process nor a holder", () => {
    writeHolders(state, HOST, { pid: 41, holders: [] });
    writeHolders(state, HOST, { pid: null, holders: [] });
    expect(existsSync(holdersFile(state, HOST))).toBe(false);
  });

  it("reads a file that is not a holders record as empty", () => {
    mkdirSync(join(state, "processes"), { recursive: true });
    writeFileSync(holdersFile(state, HOST), "{ not json");
    expect(readHolders(state, HOST)).toEqual({ pid: null, holders: [] });
  });

  it("refuses a host id that would place the file outside the processes folder", () => {
    expect(() => readHolders(state, "../escape")).toThrow(/plain file name/);
  });
});

describe("withHoldersLock", () => {
  it("runs one holder of the lock at a time and removes the lock afterwards", async () => {
    const events: string[] = [];
    const first = withHoldersLock(state, HOST, async () => {
      events.push("first in");
      await waitFor(200);
      events.push("first out");
    });
    const second = withHoldersLock(state, HOST, () => {
      events.push("second in");
    });
    await Promise.all([first, second]);
    expect(events).toEqual(["first in", "first out", "second in"]);
    expect(existsSync(lockFile())).toBe(false);
  });

  it("takes a lock whose process is dead", async () => {
    writeLock(exitedPid());
    const started = Date.now();
    await withHoldersLock(state, HOST, () => undefined);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("takes a lock older than ten seconds even when its process is alive", async () => {
    writeLock(process.pid, 20000);
    const started = Date.now();
    await withHoldersLock(state, HOST, () => undefined);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("waits for a fresh lock a live process holds", async () => {
    writeLock(process.pid);
    let entered = false;
    const waiting = withHoldersLock(state, HOST, () => {
      entered = true;
    });
    await waitFor(300);
    expect(entered).toBe(false);
    rmSync(lockFile());
    await waiting;
    expect(entered).toBe(true);
  });
});

describe("isProcessAlive", () => {
  it("answers true for this process and false for one that exited", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(exitedPid())).toBe(false);
  });
});
