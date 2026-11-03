import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { bundleHost } from "../build/bundle-host.js";
import { libraryDirectoryOutput } from "../build/built-directory.js";
import { bundlePlugin } from "../build/bundle-plugin.js";
import { koffiLibraryOutput } from "../build/koffi-library.js";
import { buildLocalCatalog } from "../build/local-catalog.js";
import type { CatalogInput } from "../build/local-catalog.js";
import { runtimeBinaryName } from "../runtime/cached-runtime.js";
import { siblingRuntime } from "../runtime/open.js";
import { REPOSITORY_ROOT } from "./context.js";
import { pluginRepository } from "./plugin-repository.js";

/** A platform no runner is, so an item built only for it has no build for this one. */
export const ELSEWHERE_PLATFORM = "aix-ppc64";

export const RUNTIME_VERSION = "0.1.0";
export const OLDER_RUNTIME_VERSION = "0.0.9";

export interface EcosystemCatalog {
  path: string;
  hostVersion: string;
}

async function pluginInput(workspace: string, id: string, platform?: string): Promise<CatalogInput> {
  const output = await bundlePlugin(pluginRepository(join(workspace, "repositories", id), id), join(workspace, "bundled", id));
  return platform === undefined ? { kind: "plugin", output } : { kind: "plugin", output, platform };
}

/**
 * The sibling runtime build, its declaration naming `version`.
 *
 * @implNote Only this machine's sibling build exists, so the catalog lists the runtime for this platform alone.
 */
function runtimeInput(workspace: string, version: string): CatalogInput {
  const platform = currentPlatformKey();
  const source = siblingRuntime(REPOSITORY_ROOT);
  const directory = join(workspace, "runtime", version, platform);
  mkdirSync(directory, { recursive: true });
  copyFileSync(source.binaryPath, join(directory, runtimeBinaryName(platform)));
  const declaration = { ...JSON.parse(readFileSync(source.declarationPath, "utf8")), version };
  writeFileSync(join(directory, basename(source.declarationPath)), JSON.stringify(declaration, null, 2));
  return { kind: "library", output: libraryDirectoryOutput("runtime", directory), platform };
}

function koffiInput(workspace: string): CatalogInput {
  const platform = currentPlatformKey();
  const output = koffiLibraryOutput(join(REPOSITORY_ROOT, "node_modules", "koffi"), platform, join(workspace, "koffi", platform));
  return { kind: "library", output, platform };
}

/**
 * A local catalog of the host bundle, the runtime at two versions and koffi for this platform, the `announcer` and
 * `viewer` fixture plugins, `rival` built for {@link ELSEWHERE_PLATFORM} only, and every `extra` input.
 */
export async function ecosystemCatalog(workspace: string, extra: readonly CatalogInput[] = []): Promise<EcosystemCatalog> {
  const host = await bundleHost(join(workspace, "host"));
  const inputs: CatalogInput[] = [
    { kind: "host", output: host },
    runtimeInput(workspace, RUNTIME_VERSION),
    runtimeInput(workspace, OLDER_RUNTIME_VERSION),
    koffiInput(workspace),
    await pluginInput(workspace, "viewer"),
    await pluginInput(workspace, "announcer"),
    await pluginInput(workspace, "rival", ELSEWHERE_PLATFORM),
    ...extra,
  ];
  return { path: buildLocalCatalog(inputs, join(workspace, "catalog")), hostVersion: host.version };
}

/** A controlled environment whose four places, and the user's home, all sit under `base`. */
export function placesEnvironment(base: string): Record<string, string> {
  return {
    HOME: join(base, "user"),
    USERPROFILE: join(base, "user"),
    SPISOR_HOME: join(base, "portable"),
    SPISOR_STATE: join(base, "state"),
    SPISOR_CACHE: join(base, "cache"),
    SPISOR_SECRETS: join(base, "secrets"),
  };
}
