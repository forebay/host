import { spawn } from "node:child_process";
import { constants } from "node:os";
import { CommandRefusal } from "../cli/command-refusal.js";
import { commandShellInvocation, needsCommandShell } from "./windows-command.js";
import type { Invocation } from "./windows-command.js";

const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
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
 * @implNote On Windows the console delivers Ctrl+C to every process attached to it, the application
 * included, so the launcher only stays alive until the application exits; on POSIX a signal reaches
 * the launcher alone and is passed on.
 */
function signalHandlers(forward: (signal: NodeJS.Signals) => void): () => void {
  const handlers = FORWARDED_SIGNALS.map((signal) => {
    const handler = () => {
      if (process.platform !== "win32") forward(signal);
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
 *
 * @remarks SIGINT, SIGTERM and SIGHUP sent to this process are passed on to the application.
 */
export function runApplication(binary: string, givenArguments: readonly string[], environment: Record<string, string>): Promise<number> {
  const invocation = invocationOf(binary, givenArguments, environment);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.arguments, { stdio: "inherit", env: environment, windowsVerbatimArguments: invocation.verbatim });
    const removeHandlers = signalHandlers((signal) => child.kill(signal));
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
