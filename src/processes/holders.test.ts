import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holdersFile, isHostRunning, isProcessAlive, NO_HOLDERS, readHolders, withHoldersLock, writeHolders } from "./holders.js";

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
    expect(readHolders(state, HOST)).toEqual(NO_HOLDERS);
    const record = { pid: 41, aliveAt: 1000, checkMilliseconds: 200, holders: [7, 9] };
    writeHolders(state, HOST, record);
    expect(readHolders(state, HOST)).toEqual(record);
    expect(JSON.parse(readFileSync(holdersFile(state, HOST), "utf8"))).toEqual(record);
  });

  it("removes the file once it records neither a process nor a holder", () => {
    writeHolders(state, HOST, { ...NO_HOLDERS, pid: 41 });
    writeHolders(state, HOST, NO_HOLDERS);
    expect(existsSync(holdersFile(state, HOST))).toBe(false);
  });

  it("reads a file that is not a holders record as empty", () => {
    mkdirSync(join(state, "processes"), { recursive: true });
    writeFileSync(holdersFile(state, HOST), "{ not json");
    expect(readHolders(state, HOST)).toEqual(NO_HOLDERS);
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

  it("leaves a lock that is no longer its own", async () => {
    await withHoldersLock(state, HOST, () => {
      writeFileSync(lockFile(), `${process.pid} another-locker`);
    });
    expect(readFileSync(lockFile(), "utf8")).toBe(`${process.pid} another-locker`);
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

describe("isHostRunning", () => {
  const now = 100000;

  it("answers true for a live pid that stamped itself within three of its checks", () => {
    expect(isHostRunning({ pid: process.pid, aliveAt: now - 550, checkMilliseconds: 200, holders: [] }, now)).toBe(true);
  });

  it("answers false for a live pid whose stamp is older than three checks, as when the pid was reused", () => {
    expect(isHostRunning({ pid: process.pid, aliveAt: now - 650, checkMilliseconds: 200, holders: [] }, now)).toBe(false);
  });

  it("answers false for a dead pid, and for a record that was never stamped", () => {
    expect(isHostRunning({ pid: exitedPid(), aliveAt: now, checkMilliseconds: 200, holders: [] }, now)).toBe(false);
    expect(isHostRunning({ pid: process.pid, aliveAt: null, checkMilliseconds: null, holders: [] }, now)).toBe(false);
  });

  it("judges a host that has not checked yet by the default interval", () => {
    expect(isHostRunning({ pid: process.pid, aliveAt: now - 14000, checkMilliseconds: null, holders: [] }, now)).toBe(true);
  });
});

describe("isProcessAlive", () => {
  it("answers true for this process and false for one that exited", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(exitedPid())).toBe(false);
  });
});
