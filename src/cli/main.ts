#!/usr/bin/env node
import { parseArgs } from "node:util";
import { BuildRefusal } from "../build/build-refusal.js";
import { bundleCommand, bundleLoaderCommand } from "./commands/bundle.js";
import { isRunDirectly, runCommands, UsageError } from "./command-line.js";
import type { Refusal } from "./command-line.js";
import { catalogBuildCommand } from "./commands/catalog-build.js";
import type { LibraryArgument } from "./commands/catalog-build.js";
import { PROCESS_OUTPUT } from "./output.js";
import type { CommandLineOutput } from "./output.js";

const USAGE = [
  "usage:",
  "  forebay-host bundle <repository> --out <directory>",
  "  forebay-host bundle-loader <repository> --out <directory>",
  "  forebay-host catalog build [--plugin <directory>]... [--host <directory>]... [--library <id>=<directory>@<platform>]... --out <directory>",
].join("\n");

const LIBRARY_ARGUMENT = /^([^=]+)=(.+)@([^@]+)$/;

function requiredOut(out: string | undefined): string {
  if (out === undefined) throw new UsageError("--out <directory> is required");
  return out;
}

function libraryArgument(text: string): LibraryArgument {
  const match = LIBRARY_ARGUMENT.exec(text);
  if (match === null) throw new UsageError(`--library ${text} is not <id>=<directory>@<platform>`);
  return { id: match[1] as string, directory: match[2] as string, platform: match[3] as string };
}

function repositoryAndOut(command: string, rest: string[]): { repository: string; out: string } {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { out: { type: "string" } } });
  if (positionals.length !== 1) throw new UsageError(`${command} takes exactly one repository`);
  return { repository: positionals[0] as string, out: requiredOut(values.out) };
}

async function runBundle(rest: string[], output: CommandLineOutput): Promise<void> {
  const { repository, out } = repositoryAndOut("bundle", rest);
  await bundleCommand(repository, out, output);
}

async function runBundleLoader(rest: string[], output: CommandLineOutput): Promise<void> {
  const { repository, out } = repositoryAndOut("bundle-loader", rest);
  await bundleLoaderCommand(repository, out, output);
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
  if (command === "bundle-loader") return runBundleLoader(argv.slice(1), output);
  if (command === "catalog" && subcommand === "build") return runCatalogBuild(rest, output);
  throw new UsageError(`unknown command: ${argv.join(" ") || "(none)"}`);
}

function refusalOf(error: unknown): Refusal | undefined {
  return error instanceof BuildRefusal ? error : undefined;
}

/** Runs one `forebay-host` command, answering the process exit code: 0 done, 1 refused, 2 misused. */
export function runCommandLine(argv: string[], output: CommandLineOutput = PROCESS_OUTPUT): Promise<number> {
  return runCommands(argv, output, dispatch, USAGE, refusalOf);
}

export type { CommandLineOutput };

if (isRunDirectly(import.meta.url)) process.exitCode = await runCommandLine(process.argv.slice(2));
