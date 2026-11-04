import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeApplicationStart, installFakeApplication, releaseFakeApplication, SIGNALS_VARIABLE, windowsSystemVariables } from "../__fixtures__/fake-application.js";
import { findOnPath } from "../loader/on-path.js";
import { isProcessAlive } from "../processes/holders.js";
import { relayStopSignals, runApplication } from "./child.js";
import { commandShellInvocation } from "./windows-command.js";

const BINARY = "fixture-app";

let base: string;
let signals: string;
let environment: Record<string, string>;
let binary: string;

async function startedWithin(tag: string, milliseconds: number) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const started = fakeApplicationStart(signals, tag);
    if (started !== undefined) return started;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`the fake application ${tag} did not start`);
}

function killIfAlive(pid: number): void {
  if (isProcessAlive(pid)) process.kill(pid, "SIGKILL");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-child-"));
  signals = join(base, "signals");
  mkdirSync(signals);
  installFakeApplication(join(base, "bin"), BINARY);
  environment = { PATH: join(base, "bin"), [SIGNALS_VARIABLE]: signals, ...windowsSystemVariables() };
  binary = findOnPath(BINARY, environment) as string;
});

afterEach(() => {
  for (const tag of ["passes", "vectors"]) {
    const started = fakeApplicationStart(signals, tag);
    if (started !== undefined) killIfAlive(started.pid);
  }
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("runApplication", () => {
  it("answers the application's exit code", async () => {
    expect(await runApplication(binary, [], environment)).toBe(0);
    expect(await runApplication(binary, ["", "3"], environment)).toBe(3);
  });

  it("passes every argument through unchanged, spaces, quotes and shell characters included", async () => {
    const given = ["passes", "5", "two words", "a&b", 'say "hi"', "(x|y)", "back\\slash\\"];
    const running = runApplication(binary, given, environment);
    const started = await startedWithin("passes", 20000);
    releaseFakeApplication(signals, "passes");
    expect(await running).toBe(5);
    expect(started.argv).toEqual(given);
  });

  it("hands a batch shim each argument byte-identical and runs nothing an argument names", async () => {
    const marker = join(signals, "injected");
    const given = ["vectors", "0", `x" & echo INJECTED> ${marker} & "y`, '"x" & y', `"%PATH%" ^ ! & echo INJECTED> ${marker}`];
    const running = runApplication(binary, given, environment);
    const started = await startedWithin("vectors", 20000);
    releaseFakeApplication(signals, "vectors");
    expect(await running).toBe(0);
    expect(started.argv).toEqual(given);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses an application that cannot be started, with what to do", async () => {
    await expect(runApplication(join(base, "absent", process.platform === "win32" ? "missing-app.exe" : "missing-app"), [], environment)).rejects.toMatchObject({ fix: expect.stringContaining("install") });
  });
});

describe("relayStopSignals", () => {
  it("passes on SIGTERM alone on POSIX, holding SIGINT and SIGHUP the application already receives from its terminal", () => {
    const forwarded: string[] = [];
    const remove = relayStopSignals((signal) => forwarded.push(signal), "linux");
    try {
      for (const signal of ["SIGINT", "SIGHUP", "SIGTERM"] as const) process.emit(signal, signal);
    } finally {
      remove();
    }
    expect(forwarded).toEqual(["SIGTERM"]);
  });

  it("passes nothing on on Windows, whose console signals every attached process itself", () => {
    const forwarded: string[] = [];
    const remove = relayStopSignals((signal) => forwarded.push(signal), "win32");
    try {
      for (const signal of ["SIGINT", "SIGHUP", "SIGTERM"] as const) process.emit(signal, signal);
    } finally {
      remove();
    }
    expect(forwarded).toEqual([]);
  });
});

describe("commandShellInvocation", () => {
  it("runs a batch file through the command shell with every argument quoted and its shell characters escaped for both parses", () => {
    expect(commandShellInvocation("C:\\bin\\app.cmd", ["a b", "x&y"], "C:\\Windows\\cmd.exe")).toEqual({
      command: "C:\\Windows\\cmd.exe",
      arguments: ["/d", "/s", "/c", '"C:\\bin\\app.cmd ^^^"a^^^ b^^^" ^^^"x^^^&y^^^""'],
    });
  });
});
