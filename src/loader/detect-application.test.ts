import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MethodDetection } from "../methods/detection.js";
import { detectApplication } from "./detect-application.js";
import type { LoaderApplication } from "./standard.js";

const spawned = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  spawn: spawned,
  spawnSync: spawned,
  exec: spawned,
  execSync: spawned,
  execFile: spawned,
  execFileSync: spawned,
  fork: spawned,
}));

const application: LoaderApplication = { id: "claude", label: "Claude", binary: "claude", home: { candidates: ["~/.claude"] }, packages: {} };

describe("detectApplication", () => {
  let directory: string;
  let environment: Record<string, string>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "detect-application-"));
    environment = { PATH: directory, PATHEXT: ".CMD" };
    spawned.mockClear();
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  const answer = (item: string, installed: boolean): MethodDetection => ({ method: "npm", item, package: "@x/claude", answer: { installed } });

  it("detects a binary on PATH without launching anything", () => {
    const path = join(directory, "claude.cmd");
    writeFileSync(path, "");
    chmodSync(path, 0o755);
    expect(detectApplication(application, environment, [], "win32")).toBe(true);
    expect(spawned).not.toHaveBeenCalled();
  });

  it("detects an application whose package a method reports installed", () => {
    expect(detectApplication(application, environment, [answer("claude", true)], "win32")).toBe(true);
  });

  it("ignores a method answer about another item or reporting not installed", () => {
    expect(detectApplication(application, environment, [answer("other", true), answer("claude", false)], "win32")).toBe(false);
  });

  it("never detects from a refused method", () => {
    const refused: MethodDetection = { method: "npm", item: "claude", refused: "npm is not installed" };
    expect(detectApplication(application, environment, [refused], "win32")).toBe(false);
  });
});
