import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askOnTerminal, controllingTerminal } from "./terminal-question.js";

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-terminal-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function terminalFiles(typed: string): { input: string; output: string } {
  const input = join(base, "in");
  const output = join(base, "out");
  writeFileSync(input, typed);
  writeFileSync(output, "");
  return { input, output };
}

describe("askOnTerminal", () => {
  it("writes the question to the terminal and answers the first line typed", async () => {
    const terminal = terminalFiles("2\nignored\n");

    expect(await askOnTerminal("Choose: ", terminal)).toBe("2");
    expect(readFileSync(terminal.output, "utf8")).toBe("Choose: ");
  });

  it("answers undefined when the terminal ends before a line is typed", async () => {
    expect(await askOnTerminal("Choose: ", terminalFiles(""))).toBeUndefined();
  });

  it("answers undefined when there is no terminal to open", async () => {
    const missing = { input: join(base, "no", "such", "in"), output: join(base, "no", "such", "out") };

    expect(await askOnTerminal("Choose: ", missing)).toBeUndefined();
  });

  it("names the controlling terminal of this operating system", () => {
    const named = controllingTerminal("win32");

    expect(named).toEqual({ input: "\\\\.\\CONIN$", output: "\\\\.\\CONOUT$" });
    expect(controllingTerminal("linux")).toEqual({ input: "/dev/tty", output: "/dev/tty" });
  });
});
