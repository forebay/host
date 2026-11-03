import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import { createInterface } from "node:readline";

export interface TerminalPaths {
  input: string;
  output: string;
}

export type AskQuestion = (question: string) => Promise<string | undefined>;

const POSIX_TERMINAL: TerminalPaths = { input: "/dev/tty", output: "/dev/tty" };
const WINDOWS_TERMINAL: TerminalPaths = { input: "\\\\.\\CONIN$", output: "\\\\.\\CONOUT$" };

export function controllingTerminal(platform: NodeJS.Platform = process.platform): TerminalPaths {
  return platform === "win32" ? WINDOWS_TERMINAL : POSIX_TERMINAL;
}

interface OpenTerminal {
  input: number;
  output: number;
}

function openTerminal(paths: TerminalPaths): OpenTerminal | undefined {
  let input: number | undefined;
  try {
    input = openSync(paths.input, "r");
    return { input, output: openSync(paths.output, "r+") };
  } catch {
    if (input !== undefined) closeSync(input);
    return undefined;
  }
}

function readLine(terminal: OpenTerminal): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = createReadStream("", { fd: terminal.input });
    const lines = createInterface({ input, terminal: false });
    const finish = (answer: string | undefined): void => {
      resolve(answer);
      lines.close();
      input.destroy();
    };
    lines.once("line", (line) => finish(line.trim()));
    lines.once("close", () => finish(undefined));
    input.once("error", () => finish(undefined));
  });
}

/**
 * Asks on the controlling terminal and answers the first line typed, or `undefined` when there is
 * no terminal or it ends first.
 *
 * @implNote Never reads standard input: under `curl | sh` that is the script itself. Each call
 * opens and closes the terminal, so nothing is held between questions; the read stream closes the input.
 */
export async function askOnTerminal(question: string, paths: TerminalPaths = controllingTerminal()): Promise<string | undefined> {
  const terminal = openTerminal(paths);
  if (terminal === undefined) return undefined;
  try {
    writeSync(terminal.output, question);
  } catch {
    closeSync(terminal.input);
    closeSync(terminal.output);
    return undefined;
  }
  try {
    return await readLine(terminal);
  } finally {
    closeSync(terminal.output);
  }
}
