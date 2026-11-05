import { join, resolve } from "node:path";
import type { LoaderApplication } from "../loader-standard.js";
import { readBundleManifest } from "./bundle-manifest.js";
import type { BundleManifest } from "./bundle-manifest.js";
import { bundleSource, checkImports, writeEntry, writeFile } from "./esbuild-bundle.js";
import type { Built } from "./esbuild-bundle.js";

/** @implNote koffi carries a native module per platform, which is delivered as a library rather than inlined. */
const EXTERNAL = ["koffi"];

const RUNTIME = "javascript";

/** A built item: its id, its version and each of its files, by relative path with `/` separators, as an absolute path. */
export interface BundleOutput {
  id: string;
  version: string;
  files: Record<string, string>;
  /** Set for a loader host, whose `host.json` declares the application it loads into. */
  application?: LoaderApplication;
  /** Set for a plugin whose manifest names an `installMethod`, so the catalog lists it as that method's provider. */
  installMethod?: string;
}

/** @internal A bundle and every module it still imports at run time, as esbuild's metafile lists them. */
export interface BundledPlugin {
  output: BundleOutput;
  imports: string[];
}

function writeBundle(manifest: BundleManifest, out: string, built: Built): BundleOutput {
  const files = { ...writeEntry(out, manifest.entry, built), "plugin.json": join(out, "plugin.json") };
  writeFile(files["plugin.json"], `${JSON.stringify({ ...manifest.fields, runtime: RUNTIME }, null, 2)}
`);
  return { id: manifest.id, version: manifest.version, files, ...(manifest.installMethod === undefined ? {} : { installMethod: manifest.installMethod }) };
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
 * Bundles a plugin repository into one ESM file at its manifest's `entry`, beside its `plugin.json`
 * naming the `javascript` runtime, every dependency inlined except `koffi`.
 *
 * @remarks The source is the manifest's `bundle.entry` when it names one, else `src/index.ts`. The
 * catalog build writes the `package.json` marking a `.js` entry as ESM, so the bundle carries none.
 * A manifest with no id, version or entry inside the bundle, or a bundle that would import
 * anything but `koffi` and Node's builtins at run time, is refused before anything is written.
 */
export async function bundlePlugin(repositoryRoot: string, outDirectory: string): Promise<BundleOutput> {
  return (await bundlePluginWith(repositoryRoot, outDirectory, EXTERNAL)).output;
}
