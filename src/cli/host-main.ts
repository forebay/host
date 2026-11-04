#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CacheRefusal } from "../cache/cache-refusal.js";
import { processEnvironment } from "../process-environment.js";
import { CommandRefusal } from "./command-refusal.js";
import { isRunDirectly, runCommands, UsageError } from "./command-line.js";
import type { Refusal } from "./command-line.js";
import { launchCommand } from "../launch/launch.js";
import { sessionHostCommand } from "../launch/session-host.js";
import type { SessionHost } from "../launch/session-host.js";
import { backgroundCommand } from "./commands/background.js";
import { hookCommand } from "./commands/hook.js";
import { installCommand } from "./commands/install.js";
import { statusCommand } from "./commands/status.js";
import { PROCESS_OUTPUT } from "./output.js";
import type { CommandLineOutput } from "./output.js";

const USAGE = [
  "usage:",
  "  forebay-host install --catalog <path or url> [--plugin <id>]... [--application <id>=<method|skip>]...",
  "  forebay-host status",
  "  forebay-host launch <loader-id> [arguments for the application]...",
  "  forebay-host background <host-id>",
  "  forebay-host hook <loader-id> <event>",
].join("\n");

function runInstall(rest: string[], output: CommandLineOutput): Promise<void> {
  const { values } = parseArgs({ args: rest, options: { catalog: { type: "string" }, plugin: { type: "string", multiple: true }, application: { type: "string", multiple: true } } });
  if (values.catalog === undefined) throw new UsageError("--catalog <path or url> is required");
  return installCommand({ catalog: values.catalog, plugins: values.plugin ?? [], applications: values.application ?? [] }, fileURLToPath(import.meta.url), processEnvironment(), output);
}

function runStatus(rest: string[], output: CommandLineOutput): Promise<void> {
  parseArgs({ args: rest, options: {} });
  return statusCommand(fileURLToPath(import.meta.url), processEnvironment(), output);
}

/** @implNote Read by hand, never by `parseArgs`, since every argument after the loader id is the application's, flags and a leading `--` included. */
function runLaunch(rest: string[]): Promise<number> {
  const [loaderId, ...applicationArguments] = rest;
  if (loaderId === undefined || loaderId === "") throw new UsageError("launch needs the loader id");
  return launchCommand({ loaderId, applicationArguments }, fileURLToPath(import.meta.url), processEnvironment());
}

function runBackground(rest: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true });
  const [hostId] = positionals;
  if (hostId === undefined || positionals.length !== 1) throw new UsageError("background needs exactly one host id");
  return backgroundCommand(hostId, fileURLToPath(import.meta.url), processEnvironment());
}

function runHook(rest: string[], output: CommandLineOutput): Promise<void> {
  const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true });
  const [loaderId, event] = positionals;
  if (loaderId === undefined || event === undefined || positionals.length !== 2) throw new UsageError("hook needs exactly a loader id and an event");
  return hookCommand({ loaderId, event }, fileURLToPath(import.meta.url), processEnvironment(), (text) => output.error(text.trimEnd()));
}

function dispatch(argv: string[], output: CommandLineOutput): Promise<number | void> {
  const [command, ...rest] = argv;
  if (command === "install") return runInstall(rest, output);
  if (command === "status") return runStatus(rest, output);
  if (command === "launch") return runLaunch(rest);
  if (command === "background") return runBackground(rest);
  if (command === "hook") return runHook(rest, output);
  throw new UsageError(`unknown command: ${argv.join(" ") || "(none)"}`);
}

function refusalOf(error: unknown): Refusal | undefined {
  return error instanceof CommandRefusal || error instanceof CacheRefusal ? error : undefined;
}

/** Runs one command of the installed host, answering the process exit code: 0 done, 1 refused, 2 misused. */
export function runHostCommandLine(argv: string[], output: CommandLineOutput = PROCESS_OUTPUT): Promise<number> {
  return runCommands(argv, output, dispatch, USAGE, refusalOf);
}

/** Starts loader `loaderId`'s host in this process for the session of the application this process is, answering how to stop it. */
export function runSessionHost(loaderId: string): Promise<SessionHost> {
  return sessionHostCommand(loaderId, fileURLToPath(import.meta.url), processEnvironment());
}

if (isRunDirectly(import.meta.url)) process.exitCode = await runHostCommandLine(process.argv.slice(2));
