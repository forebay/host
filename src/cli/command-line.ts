import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CommandLineOutput } from "./output.js";

/** A command line that names no command, or gives one the wrong arguments. */
export class UsageError extends Error {}

/** Why a command was refused, and what would make it run. */
export interface Refusal {
  detail: string;
  fix: string;
}

/** Runs one command; a command answering a number exits with it, any other with 0. */
export type Dispatch = (argv: string[], output: CommandLineOutput) => Promise<number | void> | number | void;

function isUsage(error: unknown): boolean {
  return error instanceof UsageError || ((error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS") ?? false);
}

function exitCodeOf(error: unknown, output: CommandLineOutput, usage: string, refusalOf: (error: unknown) => Refusal | undefined): number {
  const refusal = refusalOf(error);
  if (refusal !== undefined) {
    output.error(`${refusal.detail}\nfix: ${refusal.fix}`);
    return 1;
  }
  if (isUsage(error)) {
    output.error(`${(error as Error).message}\n${usage}`);
    return 2;
  }
  throw error;
}

/** Runs one command, answering the process exit code: 0 done, 1 refused, 2 misused. */
export async function runCommands(
  argv: string[],
  output: CommandLineOutput,
  dispatch: Dispatch,
  usage: string,
  refusalOf: (error: unknown) => Refusal | undefined,
): Promise<number> {
  try {
    const code = await dispatch(argv, output);
    return typeof code === "number" ? code : 0;
  } catch (error) {
    return exitCodeOf(error, output, usage, refusalOf);
  }
}

/** @implNote Compared by real path, because npm links a `bin` entry to the file it names. */
export function isRunDirectly(moduleUrl: string): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
