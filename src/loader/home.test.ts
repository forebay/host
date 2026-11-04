import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HomeRefusal } from "./home-refusal.js";
import { resolveApplicationHome } from "./home.js";

describe("resolveApplicationHome", () => {
  let base: string;
  let userHome: string;
  let environment: Record<string, string>;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "application-home-"));
    userHome = join(base, "user");
    mkdirSync(userHome);
    environment = { HOME: userHome, USERPROFILE: userHome };
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const standard = { envOverride: "HUB_CLAUDE_DIR", nativeEnv: "CLAUDE_CONFIG_DIR", candidates: ["~/.claude", "~/.config/claude"] };

  it("takes the override variable first", () => {
    const override = join(base, "override");
    const native = join(base, "native");
    expect(resolveApplicationHome(standard, { ...environment, HUB_CLAUDE_DIR: override, CLAUDE_CONFIG_DIR: native })).toEqual({ home: override, source: "override" });
  });

  it("takes the native variable when there is no override", () => {
    const native = join(base, "native");
    expect(resolveApplicationHome(standard, { ...environment, CLAUDE_CONFIG_DIR: native })).toEqual({ home: native, source: "native" });
  });

  it("treats an empty variable as unset", () => {
    const native = join(base, "native");
    expect(resolveApplicationHome(standard, { ...environment, HUB_CLAUDE_DIR: "", CLAUDE_CONFIG_DIR: native })).toEqual({ home: native, source: "native" });
  });

  it("takes the first candidate that exists as a directory, with ~ expanded from the user's home", () => {
    mkdirSync(join(userHome, ".config", "claude"), { recursive: true });
    expect(resolveApplicationHome(standard, environment)).toEqual({ home: join(userHome, ".config", "claude"), source: "candidate" });
  });

  it("falls back to the first candidate when none exists yet", () => {
    expect(resolveApplicationHome(standard, environment)).toEqual({ home: join(userHome, ".claude"), source: "default" });
  });

  it("refuses a relative override and names the variable and its value", () => {
    const attempt = () => resolveApplicationHome(standard, { ...environment, HUB_CLAUDE_DIR: "relative/dir" });
    expect(attempt).toThrow(HomeRefusal);
    try {
      attempt();
    } catch (error) {
      expect((error as HomeRefusal).detail).toContain("HUB_CLAUDE_DIR");
      expect((error as HomeRefusal).detail).toContain("relative/dir");
      expect((error as HomeRefusal).fix).not.toBe("");
    }
  });

  describe("under XDG_CONFIG_HOME", () => {
    const xdgStandard = { envOverride: "HUB_OPENCODE_DIR", nativeEnv: "OPENCODE_CONFIG_DIR", xdgSubdir: "opencode", candidates: ["~/.config/opencode", "~/.opencode"] };

    it("takes the subdirectory of an absolute XDG_CONFIG_HOME after the native variable and before the candidates", () => {
      const xdg = join(base, "xdg");
      mkdirSync(join(userHome, ".opencode"), { recursive: true });
      expect(resolveApplicationHome(xdgStandard, { ...environment, XDG_CONFIG_HOME: xdg })).toEqual({ home: join(xdg, "opencode"), source: "xdg" });
    });

    it("lets the native variable win over XDG_CONFIG_HOME", () => {
      const native = join(base, "native");
      expect(resolveApplicationHome(xdgStandard, { ...environment, XDG_CONFIG_HOME: join(base, "xdg"), OPENCODE_CONFIG_DIR: native })).toEqual({ home: native, source: "native" });
    });

    it("ignores a relative or empty XDG_CONFIG_HOME, as the XDG specification does", () => {
      expect(resolveApplicationHome(xdgStandard, { ...environment, XDG_CONFIG_HOME: "relative" })).toEqual({ home: join(userHome, ".config", "opencode"), source: "default" });
      expect(resolveApplicationHome(xdgStandard, { ...environment, XDG_CONFIG_HOME: "" })).toEqual({ home: join(userHome, ".config", "opencode"), source: "default" });
    });

    it("ignores XDG_CONFIG_HOME for a home with no xdgSubdir", () => {
      expect(resolveApplicationHome(standard, { ...environment, XDG_CONFIG_HOME: join(base, "xdg") })).toEqual({ home: join(userHome, ".claude"), source: "default" });
    });
  });

  it("refuses a relative native variable", () => {
    expect(() => resolveApplicationHome(standard, { ...environment, CLAUDE_CONFIG_DIR: "x" })).toThrow(HomeRefusal);
  });
});
