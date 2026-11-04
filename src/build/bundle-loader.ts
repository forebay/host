import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptsItemId } from "../catalog/accepts.js";
import type { LoaderStandard } from "../loader/standard.js";
import { bundleHost } from "./bundle-host.js";
import { BuildRefusal } from "./build-refusal.js";
import { parsedManifest, versionOf } from "./bundle-manifest.js";
import type { BundleOutput } from "./bundle-plugin.js";

const PACKAGE_FILE = "package.json";
const STANDARD_EXPORT = "standard";

function loaderIdOf(manifest: Record<string, unknown>, path: string): string {
  const name = manifest.name;
  if (typeof name === "string" && acceptsItemId(name)) return name;
  throw new BuildRefusal(`${path} names the package ${JSON.stringify(name)}, which a catalog refuses as a loader id`, "name the loader package with lowercase letters and digits joined by single hyphens, with no scope");
}

function mainModuleOf(manifest: Record<string, unknown>, repositoryRoot: string, path: string): string {
  const main = manifest.main;
  if (typeof main !== "string" || main === "") throw new BuildRefusal(`${path} names no main module`, `name the module that exports the loader's ${STANDARD_EXPORT} as "main"`);
  const module = join(repositoryRoot, main);
  if (existsSync(module)) return module;
  throw new BuildRefusal(`${module}, the main module ${path} names, does not exist`, "build the loader before bundling it");
}

async function standardOf(module: string): Promise<LoaderStandard> {
  const exported = ((await import(pathToFileURL(module).href)) as Record<string, unknown>)[STANDARD_EXPORT];
  if (exported !== undefined) return exported as LoaderStandard;
  throw new BuildRefusal(`${module} exports no ${STANDARD_EXPORT}`, `export the loader's LoaderStandard as "${STANDARD_EXPORT}" from the package's main module`);
}

/**
 * Bundles the host for a loader repository: under its package name and version, with the
 * `standard` its package's main module exports, which the bundle's `host.json` then carries.
 *
 * @remarks A standard that `checkLoaderStandard` refuses is refused before anything is written.
 */
export async function bundleLoader(repositoryRoot: string, outDirectory: string): Promise<BundleOutput> {
  const root = resolve(repositoryRoot);
  const path = join(root, PACKAGE_FILE);
  if (!existsSync(path)) throw new BuildRefusal(`${root} has no ${PACKAGE_FILE}`, "give the loader repository a package.json naming it, its version and its main module");
  const manifest = parsedManifest(path);
  const standard = await standardOf(mainModuleOf(manifest, root, path));
  return bundleHost(outDirectory, { id: loaderIdOf(manifest, path), version: versionOf(manifest, path), standard });
}
