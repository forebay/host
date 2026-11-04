import { spawn } from "node:child_process";
import { constants } from "node:os";
import { CommandRefusal } from "../cli/command-refusal.js";
import { commandShellInvocation, needsCommandShell } from "./windows-command.js";
import type { Invocation } from "./windows-command.js";

const HELD_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGHUP"];
const FORWARDED_SIGNAL: NodeJS.Signals = "SIGTERM";
const SIGNAL_EXIT_BASE = 128;
const DEFAULT_COMMAND_SHELL = "cmd.exe";

function commandShellOf(environment: Record<string, string>): string {
  const key = Object.keys(environment).find((name) => name.toLowerCase() === "comspec");
  return key === undefined ? DEFAULT_COMMAND_SHELL : (environment[key] as string);
}

function invocationOf(binary: string, givenArguments: readonly string[], environment: Record<string, string>): Invocation & { verbatim: boolean } {
  if (process.platform === "win32" && needsCommandShell(binary)) return { ...commandShellInvocation(binary, givenArguments, commandShellOf(environment)), verbatim: true };
  return { command: binary, arguments: [...givenArguments], verbatim: false };
}

function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  return SIGNAL_EXIT_BASE + (signal === null ? 0 : constants.signals[signal]);
}

/**
 * Keeps this process alive through the stop signals until the application exits, passing on the one
 * the application would not otherwise see.
 *
 * @implNote SIGINT and SIGHUP come from the terminal, which sends them to its whole foreground
 * process group, the application included, so passing them on would deliver each twice; only a
 * SIGTERM is sent to this process alone. On Windows the console delivers Ctrl+C to every process
 * attached to it, so nothing is passed on there.
 */
export function relayStopSignals(forward: (signal: NodeJS.Signals) => void, platform: NodeJS.Platform = process.platform): () => void {
  const handlers = [...HELD_SIGNALS, FORWARDED_SIGNAL].map((signal) => {
    const handler = () => {
      if (platform !== "win32" && signal === FORWARDED_SIGNAL) forward(signal);
    };
    process.on(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of handlers) process.off(signal, handler);
  };
}

/**
 * Runs `binary` with `givenArguments` as this process's child, sharing its terminal and given
 * `environment`, and answers its exit code: 128 plus the signal number when a signal ended it.
 * `started` is told the child's pid once it is spawned.
 *
 * @remarks A SIGTERM sent to this process is passed on to the application.
 */
export function runApplication(binary: string, givenArguments: readonly string[], environment: Record<string, string>, started: (pid: number) => void = () => {}): Promise<number> {
  const invocation = invocationOf(binary, givenArguments, environment);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.arguments, { stdio: "inherit", env: environment, windowsVerbatimArguments: invocation.verbatim });
    const removeHandlers = relayStopSignals((signal) => child.kill(signal));
    child.once("spawn", () => {
      if (child.pid !== undefined) started(child.pid);
    });
    child.once("error", (error) => {
      removeHandlers();
      reject(new CommandRefusal(`${binary} could not be started: ${error.message}`, "install the application again, or run forebay-host install"));
    });
    child.once("exit", (code, signal) => {
      removeHandlers();
      resolve(exitCodeOf(code, signal));
    });
  });
}
