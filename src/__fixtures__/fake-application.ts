import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The variable naming the directory the fake application reports to and is released through. */
export const SIGNALS_VARIABLE = "FAKE_APPLICATION_SIGNALS";

const APPLICATION_SOURCE = `import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const argv = process.argv.slice(2);
const [tag, code = "0"] = argv;
const signals = process.env.${SIGNALS_VARIABLE};
if (!tag || !signals) process.exit(Number(code));
writeFileSync(join(signals, tag + ".started"), JSON.stringify({ pid: process.pid, parent: process.ppid, argv }));
const timer = setInterval(() => {
  if (!existsSync(join(signals, tag + ".release"))) return;
  clearInterval(timer);
  process.exit(Number(code));
}, 50);
`;

export interface FakeApplicationStart {
  pid: number;
  /** The process that started it: the launcher, or on Windows the command shell running its wrapper. */
  parent: number;
  argv: string[];
}

function windowsWrapper(script: string): string {
  return `@"${process.execPath}" "${script}" %*\r\n`;
}

function posixWrapper(script: string): string {
  return `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`;
}

/**
 * Writes an application named `binary` into `directory`, a node script behind a wrapper the PATH
 * finds (`<binary>.cmd` on Windows). Run as `<binary> <tag> <exit code> [arguments...]`, it records
 * its pid and arguments as `<tag>.started` in the signals directory, waits for `<tag>.release`, and
 * exits with the code; with no tag it exits at once.
 */
export function installFakeApplication(directory: string, binary: string): void {
  mkdirSync(directory, { recursive: true });
  const script = join(directory, `${binary}.mjs`);
  writeFileSync(script, APPLICATION_SOURCE);
  if (process.platform === "win32") {
    writeFileSync(join(directory, `${binary}.cmd`), windowsWrapper(script));
    return;
  }
  const wrapper = join(directory, binary);
  writeFileSync(wrapper, posixWrapper(script));
  chmodSync(wrapper, 0o755);
}

/** What the fake application tagged `tag` recorded when it started, or undefined before it has. */
export function fakeApplicationStart(signals: string, tag: string): FakeApplicationStart | undefined {
  const file = join(signals, `${tag}.started`);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as FakeApplicationStart;
  } catch {
    return undefined;
  }
}

/** The variables Windows needs to start a node or a batch file, which a test environment with its own PATH would otherwise lack. */
export function windowsSystemVariables(): Record<string, string> {
  return Object.fromEntries(["SystemRoot", "ComSpec"].flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name] as string]])));
}

/** Lets the fake application tagged `tag` exit. */
export function releaseFakeApplication(signals: string, tag: string): void {
  writeFileSync(join(signals, `${tag}.release`), "");
}
