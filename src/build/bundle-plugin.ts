import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readBundleManifest } from "./bundle-manifest.js";
import type { BundleManifest } from "./bundle-manifest.js";
import { bundleSource, checkImports, writeEntry } from "./esbuild-bundle.js";
import type { Built } from "./esbuild-bundle.js";

/** @implNote koffi carries a native module per platform, which is delivered as a library rather than inlined. */
const EXTERNAL = ["koffi"];

/** A built item: its id, its version and each of its files, by relative path with `/` separators, as an absolute path. */
export interface BundleOutput {
  id: string;
  version: string;
  files: Record<string, string>;
}

/** @internal A bundle and every module it still imports at run time, as esbuild's metafile lists them. */
export interface BundledPlugin {
  output: BundleOutput;
  imports: string[];
}

function writeBundle(manifest: BundleManifest, out: string, built: Built): BundleOutput {
  const files = { ...writeEntry(out, manifest.entry, built), "plugin.json": join(out, "plugin.json") };
  copyFileSync(manifest.path, files["plugin.json"]);
  return { id: manifest.id, version: manifest.version, files };
}

/** @internal `bundlePlugin` with the modules left external given, so a test can make one escape; not part of the package entry. */
export async function bundlePluginWith(repositoryRoot: string, outDirectory: string, external: string[]): Promise<BundledPlugin> {
  const manifest = readBundleManifest(resolve(repositoryRoot));
  const out = resolve(outDirectory);
  const built = await bundleSource(resolve(repositoryRoot, manifest.source), join(out, manifest.entry), { external });
  const imports = checkImports(manifest.id, built, EXTERNAL);
  return { output: writeBundle(manifest, out, built), imports };
}

/**
 * Bundles a plugin repository into one ESM file at its manifest's `entry`, beside a copy of its
 * `plugin.json`, every dependency inlined except `koffi`.
 *
 * @remarks The source is the manifest's `bundle.entry` when it names one, else `src/index.ts`. A
 * `.js` entry gets a `package.json` of `{ "type": "module" }` beside it, listed among the files.
 * A manifest a catalog would refuse, or a bundle that would import anything but `koffi` and Node's
 * builtins at run time, is refused before anything is written.
 */
export async function bundlePlugin(repositoryRoot: string, outDirectory: string): Promise<BundleOutput> {
  return (await bundlePluginWith(repositoryRoot, outDirectory, EXTERNAL)).output;
}
