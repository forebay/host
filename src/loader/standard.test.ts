import { describe, expect, it } from "vitest";
import { checkLoaderStandard } from "./standard.js";

function validStandard() {
  return {
    application: {
      id: "claude-code",
      label: "Claude Code",
      binary: "claude",
      home: { envOverride: "CLAUDE_CONFIG_DIR", candidates: ["~/.claude"] },
      packages: { npm: "@anthropic-ai/claude-code", winget: { name: "Anthropic.ClaudeCode", source: "winget" } },
    },
    pathCommands: { requested: ["claude"], minimum: 0 },
    background: ["forebay-host"],
  };
}

function pathsOf(value: unknown): string[] {
  return checkLoaderStandard(value).map((found) => found.path);
}

describe("checkLoaderStandard", () => {
  it("accepts a complete standard", () => {
    expect(checkLoaderStandard(validStandard())).toEqual([]);
  });

  it("refuses an application with no binary, naming the member", () => {
    const standard = validStandard();
    Reflect.deleteProperty(standard.application, "binary");
    expect(pathsOf(standard)).toEqual(["/application/binary"]);
  });

  it("refuses a candidate that is neither ~/-rooted nor absolute, naming its index", () => {
    const standard = validStandard();
    standard.application.home.candidates = ["~/.claude", "relative/dir"];
    const [found] = checkLoaderStandard(standard);
    expect(found?.path).toBe("/application/home/candidates/1");
    expect(found?.fix).toContain("~/");
  });

  it("accepts an absolute candidate", () => {
    const standard = validStandard();
    standard.application.home.candidates = ["C:/Users/someone/.claude", "/opt/claude"];
    expect(checkLoaderStandard(standard)).toEqual([]);
  });

  it("accepts an xdgSubdir that is one portable name", () => {
    const standard = validStandard();
    Object.assign(standard.application.home, { xdgSubdir: "opencode" });
    expect(checkLoaderStandard(standard)).toEqual([]);
  });

  it.each(["", "../x", "a/b", 7])("refuses the xdgSubdir %j", (xdgSubdir) => {
    const standard = validStandard();
    Object.assign(standard.application.home, { xdgSubdir });
    expect(pathsOf(standard)).toEqual(["/application/home/xdgSubdir"]);
  });

  it("refuses a package that is neither a name nor an object with a name, naming its method", () => {
    const standard = validStandard();
    Object.assign(standard.application.packages, { brew: 7, scoop: { source: "x" } });
    expect(pathsOf(standard)).toEqual(["/application/packages/brew", "/application/packages/scoop"]);
  });

  it("refuses a pathCommands minimum outside 0 and 1 and a background that is not a list", () => {
    const standard = { ...validStandard(), pathCommands: { requested: ["claude"], minimum: 2 }, background: "forebay-host" };
    expect(pathsOf(standard)).toEqual(["/pathCommands/minimum", "/background"]);
  });

  it("refuses a value that is not an object", () => {
    expect(checkLoaderStandard(null)).toHaveLength(1);
  });

  it("accepts a package object with an options object and with extra members", () => {
    const standard = validStandard();
    Object.assign(standard.application.packages, { brew: { name: "claude", options: { tap: "x" } }, scoop: { name: "claude", bucket: "extras" } });
    expect(checkLoaderStandard(standard)).toEqual([]);
  });

  it("refuses package options that are not an object, naming the method", () => {
    const standard = validStandard();
    Object.assign(standard.application.packages, { brew: { name: "claude", options: "x" } });
    expect(pathsOf(standard)).toEqual(["/application/packages/brew"]);
  });

  it("refuses a method id that is not a portable id", () => {
    const standard = validStandard();
    Object.assign(standard.application.packages, { "": "x", "a b": "y" });
    expect(pathsOf(standard)).toEqual(["/application/packages/", "/application/packages/a b"]);
  });

  it.each(["../x", "a/b", "", "-x", "a b"])("refuses the binary %j", (binary) => {
    const standard = validStandard();
    standard.application.binary = binary;
    expect(pathsOf(standard)).toEqual(["/application/binary"]);
  });

  it.each([["../x"], ["a/b"], ["claude", "claude"], [""]])("refuses requested commands %j", (...requested) => {
    const standard = validStandard();
    standard.pathCommands.requested = requested;
    expect(pathsOf(standard)).toEqual(["/pathCommands/requested"]);
  });
});
