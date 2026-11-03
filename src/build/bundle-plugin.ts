import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { BuildRefusal } from "./build-refusal.js";
import { readBundleManifest } from "./bundle-manifest.js";
import type { BundleManifest } from "./bundle-manifest.js";

/**
 * Gives inlined CommonJS a working `require`, which esbuild's ESM output otherwise replaces with a
 * stub that throws; aliased so it cannot collide with a `createRequire` the plugin imports itself.
 */
const REQUIRE_BANNER = 'import { createRequire as __bundleCreateRequire } from "node:module";\nconst require = __bundleCreateRequire(import.meta.url);';

/** @implNote koffi carries a native module per platform, which is delivered as a library rather than inlined. */
const EXTERNAL = ["koffi"];

/** A built item: its id, its version and each of its files, by relative path with `/` separators, as an absolute path. */
export interface BundleOutput {
  id: string;
  version: string;
  files: Record<string, string>;
}

interface EsbuildFailure {
  errors?: Array<{ text: string; location?: { file: string; line: number } | null }>;
}

function failureDetail(error: unknown): string {
  const first = (error as EsbuildFailure).errors?.[0];
  if (first === undefined) return (error as Error).message;
  return first.location ? `${first.location.file}:${first.location.line}: ${first.text}` : first.text;
}

/** @implNote esbuild is imported here, not at the top, so nothing but the developer commands ever loads it. */
async function bundleSource(source: string, outfile: string): Promise<void> {
  const { build } = await import("esbuild");
  try {
    await build({ entryPoints: [source], outfile, bundle: true, format: "esm", platform: "node", target: "node20", external: EXTERNAL, banner: { js: REQUIRE_BANNER }, logLevel: "silent" });
  } catch (error) {
    throw new BuildRefusal(`${source} could not be bundled: ${failureDetail(error)}`, "correct the source esbuild names, or install the dependency it cannot resolve");
  }
}

function outputOf(manifest: BundleManifest, outDirectory: string): BundleOutput {
  return { id: manifest.id, version: manifest.version, files: { [manifest.entry]: join(outDirectory, manifest.entry), "plugin.json": join(outDirectory, "plugin.json") } };
}

/**
 * Bundles a plugin repository into one ESM file at its manifest's `entry`, beside a copy of its
 * `plugin.json`, every dependency inlined except `koffi`.
 *
 * @remarks The source is the manifest's `bundle.entry` when it names one, else `src/index.ts`. A
 * manifest with no version, or one a catalog would refuse, is refused before anything is written.
 */
export async function bundlePlugin(repositoryRoot: string, outDirectory: string): Promise<BundleOutput> {
  const manifest = readBundleManifest(resolve(repositoryRoot));
  const out = resolve(outDirectory);
  await bundleSource(resolve(repositoryRoot, manifest.source), join(out, manifest.entry));
  mkdirSync(out, { recursive: true });
  copyFileSync(manifest.path, join(out, "plugin.json"));
  return outputOf(manifest, out);
}
