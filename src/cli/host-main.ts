#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CacheRefusal } from "../cache/cache-refusal.js";
import { processEnvironment } from "../process-environment.js";
import { CommandRefusal } from "./command-refusal.js";
import { isRunDirectly, runCommands, UsageError } from "./command-line.js";
import type { Refusal } from "./command-line.js";
import { installCommand } from "./commands/install.js";
import { statusCommand } from "./commands/status.js";
import { PROCESS_OUTPUT } from "./output.js";
import type { CommandLineOutput } from "./output.js";

const USAGE = ["usage:", "  forebay-host install --catalog <path or url> [--plugin <id>]...", "  forebay-host status"].join("\n");

function runInstall(rest: string[], output: CommandLineOutput): Promise<void> {
  const { values } = parseArgs({ args: rest, options: { catalog: { type: "string" }, plugin: { type: "string", multiple: true } } });
  if (values.catalog === undefined) throw new UsageError("--catalog <path or url> is required");
  return installCommand({ catalog: values.catalog, plugins: values.plugin ?? [] }, fileURLToPath(import.meta.url), processEnvironment(), output);
}

function runStatus(rest: string[], output: CommandLineOutput): Promise<void> {
  parseArgs({ args: rest, options: {} });
  return statusCommand(fileURLToPath(import.meta.url), processEnvironment(), output);
}

function dispatch(argv: string[], output: CommandLineOutput): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "install") return runInstall(rest, output);
  if (command === "status") return runStatus(rest, output);
  throw new UsageError(`unknown command: ${argv.join(" ") || "(none)"}`);
}

function refusalOf(error: unknown): Refusal | undefined {
  return error instanceof CommandRefusal || error instanceof CacheRefusal ? error : undefined;
}

/** Runs one command of the installed host, answering the process exit code: 0 done, 1 refused, 2 misused. */
export function runHostCommandLine(argv: string[], output: CommandLineOutput = PROCESS_OUTPUT): Promise<number> {
  return runCommands(argv, output, dispatch, USAGE, refusalOf);
}

if (isRunDirectly(import.meta.url)) process.exitCode = await runHostCommandLine(process.argv.slice(2));
