#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BuildRefusal } from "../build/build-refusal.js";
import { bundleCommand } from "./commands/bundle.js";
import { catalogBuildCommand } from "./commands/catalog-build.js";
import type { LibraryArgument } from "./commands/catalog-build.js";
import { PROCESS_OUTPUT } from "./output.js";
import type { CommandLineOutput } from "./output.js";

const USAGE = [
  "usage:",
  "  forebay-host bundle <repository> --out <directory>",
  "  forebay-host catalog build [--plugin <directory>]... [--host <directory>]... [--library <id>=<directory>@<platform>]... --out <directory>",
].join("\n");

const LIBRARY_ARGUMENT = /^([^=]+)=(.+)@([^@]+)$/;

class UsageError extends Error {}

function requiredOut(out: string | undefined): string {
  if (out === undefined) throw new UsageError("--out <directory> is required");
  return out;
}

function libraryArgument(text: string): LibraryArgument {
  const match = LIBRARY_ARGUMENT.exec(text);
  if (match === null) throw new UsageError(`--library ${text} is not <id>=<directory>@<platform>`);
  return { id: match[1] as string, directory: match[2] as string, platform: match[3] as string };
}

async function runBundle(rest: string[], output: CommandLineOutput): Promise<void> {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { out: { type: "string" } } });
  if (positionals.length !== 1) throw new UsageError("bundle takes exactly one repository");
  await bundleCommand(positionals[0] as string, requiredOut(values.out), output);
}

function runCatalogBuild(rest: string[], output: CommandLineOutput): void {
  const { values } = parseArgs({
    args: rest,
    options: { plugin: { type: "string", multiple: true }, host: { type: "string", multiple: true }, library: { type: "string", multiple: true }, out: { type: "string" } },
  });
  const libraries = (values.library ?? []).map(libraryArgument);
  catalogBuildCommand({ plugins: values.plugin ?? [], hosts: values.host ?? [], libraries, outDirectory: requiredOut(values.out) }, output);
}

async function dispatch(argv: string[], output: CommandLineOutput): Promise<void> {
  const [command, subcommand, ...rest] = argv;
  if (command === "bundle") return runBundle(argv.slice(1), output);
  if (command === "catalog" && subcommand === "build") return runCatalogBuild(rest, output);
  throw new UsageError(`unknown command: ${argv.join(" ") || "(none)"}`);
}

function exitCodeOf(error: unknown, output: CommandLineOutput): number {
  if (error instanceof BuildRefusal) {
    output.error(`${error.detail}\nfix: ${error.fix}`);
    return 1;
  }
  if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
    output.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  throw error;
}

/** Runs one `forebay-host` command, answering the process exit code: 0 done, 1 refused, 2 misused. */
export async function runCommandLine(argv: string[], output: CommandLineOutput = PROCESS_OUTPUT): Promise<number> {
  try {
    await dispatch(argv, output);
    return 0;
  } catch (error) {
    return exitCodeOf(error, output);
  }
}

/** @implNote Compared by real path, because npm links the `bin` entry to this file. */
function isRunDirectly(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export type { CommandLineOutput };

if (isRunDirectly()) process.exitCode = await runCommandLine(process.argv.slice(2));
