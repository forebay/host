import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCodeEntry } from "../entries/claude-code.js";
import type { HostPlaces } from "../context/places.js";
import { commandTarget } from "../install/loader-identity.js";
import { backgroundHostCommand } from "../processes/background.js";
import { bootExecutable, recordBootExecutable } from "./boot-executable.js";

const RECORDED = join(tmpdir(), "recorded-runtime", "node");
const APPLICATION_EXECUTABLE = join(tmpdir(), "an-application", "opencode");

let base: string;
let cache: string;
let originalExecPath: string;

function runInsideApplication(): void {
  Object.defineProperty(process, "execPath", { value: APPLICATION_EXECUTABLE, configurable: true, writable: true });
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-boot-executable-"));
  cache = join(base, "cache");
  originalExecPath = process.execPath;
});

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true, writable: true });
  rmSync(base, { recursive: true, force: true });
});

describe("the JavaScript runtime install records", () => {
  it("is what a command, the background spawn and the Claude Code hook run, whatever executable the starting process is", () => {
    recordBootExecutable(cache, RECORDED);
    runInsideApplication();

    const places = { cache, state: join(base, "state") } as HostPlaces;
    const hookFile = claudeCodeEntry(places, { id: "loader", application: { id: "app", label: "App", binary: "app", home: { candidates: [] }, packages: {} }, home: join(base, "home") } as never).find(
      (change) => change.kind === "file" && typeof change.path === "string" && change.path.endsWith("hooks.json"),
    );

    expect(commandTarget(cache, "loader").target).toBe(RECORDED);
    expect(backgroundHostCommand({ cache, directory: base, hostId: "helper", environment: {} }).command).toBe(RECORDED);
    expect(JSON.parse(String((hookFile as { content?: string } | undefined)?.content)).hooks.SessionStart[0].hooks[0].command).toBe(RECORDED);
  });

  it("is refused with the reinstall fix when install never recorded one", () => {
    expect(() => bootExecutable(cache)).toThrow(expect.objectContaining({ fix: expect.stringContaining("install") }));
  });
});
