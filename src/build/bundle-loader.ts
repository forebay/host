import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptsItemId } from "../catalog/accepts.js";
import type { LoaderStandard } from "../loader/standard.js";
import { BuildRefusal } from "./build-refusal.js";
import { parsedManifest, versionOf } from "./bundle-manifest.js";
import type { BundleOutput } from "./bundle-plugin.js";
import { writeFile } from "./esbuild-bundle.js";
import { requireLoaderStandard } from "./loader-standard-check.js";

const PACKAGE_FILE = "package.json";
const HOST_MANIFEST = "host.json";
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
 * Writes the bundle of a loader repository, which is data only: one `host.json` naming the loader
 * by its package name and version and carrying the `standard` its package's main module exports.
 *
 * @remarks The loader runs no code of its own: its commands and entries start the shared host,
 * which reads this `host.json` from the cache. The id and version are written after the standard,
 * so a standard carrying either cannot rename the bundle. A standard that `checkLoaderStandard`
 * refuses is refused before anything is written.
 */
export async function bundleLoader(repositoryRoot: string, outDirectory: string): Promise<BundleOutput> {
  const root = resolve(repositoryRoot);
  const path = join(root, PACKAGE_FILE);
  if (!existsSync(path)) throw new BuildRefusal(`${root} has no ${PACKAGE_FILE}`, "give the loader repository a package.json naming it, its version and its main module");
  const manifest = parsedManifest(path);
  const standard = await standardOf(mainModuleOf(manifest, root, path));
  const id = loaderIdOf(manifest, path);
  const version = versionOf(manifest, path);
  requireLoaderStandard(standard, `the standard of ${id}`);
  const file = join(resolve(outDirectory), HOST_MANIFEST);
  writeFile(file, `${JSON.stringify({ ...standard, id, version }, null, 2)}\n`);
  return { id, version, files: { [HOST_MANIFEST]: file }, application: standard.application };
}
