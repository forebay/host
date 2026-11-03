import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findOnPath } from "./on-path.js";

describe("findOnPath", () => {
  let base: string;
  let first: string;
  let second: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "on-path-"));
    first = join(base, "first");
    second = join(base, "second");
    mkdirSync(first);
    mkdirSync(second);
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const touch = (directory: string, name: string, mode: number) => {
    const path = join(directory, name);
    writeFileSync(path, "");
    chmodSync(path, mode);
    return path;
  };
  const posixPath = () => `${first}:${second}`;
  const windowsPath = () => `${first};${second}`;

  describe("on POSIX", () => {
    it.skipIf(process.platform === "win32")("finds an executable file", () => {
      const binary = touch(second, "claude", 0o755);
      expect(findOnPath("claude", { PATH: posixPath() }, "linux")).toBe(binary);
    });

    it.skipIf(process.platform === "win32")("skips a same-named file without an execute bit", () => {
      touch(first, "claude", 0o644);
      const executable = touch(second, "claude", 0o755);
      expect(findOnPath("claude", { PATH: posixPath() }, "linux")).toBe(executable);
    });

    it.skipIf(process.platform === "win32")("answers undefined when only a non-executable file matches", () => {
      touch(first, "claude", 0o644);
      expect(findOnPath("claude", { PATH: posixPath() }, "linux")).toBeUndefined();
    });

    it("does not treat a directory as an executable", () => {
      mkdirSync(join(first, "claude"));
      expect(findOnPath("claude", { PATH: posixPath() }, "linux")).toBeUndefined();
    });

    it("ignores a PATH entry that does not exist", () => {
      expect(findOnPath("claude", { PATH: join(base, "missing") }, "linux")).toBeUndefined();
    });
  });

  describe("on Windows", () => {
    it("finds claude.cmd through PATHEXT", () => {
      const binary = touch(first, "claude.cmd", 0o644);
      expect(findOnPath("claude", { Path: windowsPath(), PATHEXT: ".EXE;.CMD" }, "win32")).toBe(binary);
    });

    it("matches the name and the extension case-insensitively", () => {
      const binary = touch(first, "CLAUDE.Exe", 0o644);
      expect(findOnPath("claude", { PATH: windowsPath(), PATHEXT: ".exe" }, "win32")).toBe(binary);
    });

    it("defaults PATHEXT when it is unset", () => {
      const binary = touch(second, "claude.bat", 0o644);
      expect(findOnPath("claude", { PATH: windowsPath() }, "win32")).toBe(binary);
    });

    it("does not take an extension PATHEXT does not list", () => {
      touch(first, "claude.ps1", 0o644);
      expect(findOnPath("claude", { PATH: windowsPath(), PATHEXT: ".EXE;.CMD" }, "win32")).toBeUndefined();
    });

    it("takes the bare name too", () => {
      const binary = touch(first, "claude", 0o644);
      expect(findOnPath("claude", { PATH: windowsPath() }, "win32")).toBe(binary);
    });
  });
});
