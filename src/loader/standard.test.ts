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
});
