import { hostDirectoryOutput, libraryDirectoryOutput, pluginDirectoryOutput } from "../../build/built-directory.js";
import { buildLocalCatalog } from "../../build/local-catalog.js";
import type { CatalogInput } from "../../build/local-catalog.js";
import type { CommandLineOutput } from "../output.js";

export interface LibraryArgument {
  id: string;
  directory: string;
  platform: string;
}

export interface CatalogBuildArguments {
  plugins: string[];
  hosts: string[];
  libraries: LibraryArgument[];
  outDirectory: string;
}

function inputsOf(given: CatalogBuildArguments): CatalogInput[] {
  return [
    ...given.plugins.map((directory) => ({ kind: "plugin" as const, output: pluginDirectoryOutput(directory) })),
    ...given.hosts.map((directory) => ({ kind: "host" as const, output: hostDirectoryOutput(directory) })),
    ...given.libraries.map(({ id, directory, platform }) => ({ kind: "library" as const, output: libraryDirectoryOutput(id, directory), platform })),
  ];
}

export function catalogBuildCommand(given: CatalogBuildArguments, output: CommandLineOutput): void {
  const inputs = inputsOf(given);
  output.out(`wrote ${buildLocalCatalog(inputs, given.outDirectory)} listing ${inputs.length} build${inputs.length === 1 ? "" : "s"}`);
}
