import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FOREBAY_HOST_ID } from "../install/forebay-host.js";
import type { LoaderStandard } from "../loader/standard.js";
import type { BundleOutput } from "./bundle-plugin.js";
import { bundleSource, checkImports, writeEntry, writeFile } from "./esbuild-bundle.js";
import type { Built } from "./esbuild-bundle.js";
import { requireLoaderStandard } from "./loader-standard-check.js";

const HOST_ENTRY = "host.js";
const WORKER_ENTRY = "reconcile-worker.js";
const BOOT_ENTRY = "boot.js";
const MANIFEST_FILE = "host.json";

/** @internal The host bundle with every source file inlined into it and every module it still imports; not part of the package entry. */
export interface BundledHost {
  output: BundleOutput;
  inputs: string[];
  imports: string[];
}

/** @implNote Run from `src` the sources are `.ts`, run from `dist` they are `.js`; either way they sit beside this module. */
function sourceOf(...segments: string[]): string {
  const here = fileURLToPath(import.meta.url);
  const extension = extname(here);
  const last = segments.pop() as string;
  return resolve(here, "..", "..", ...segments, `${last}${extension}`);
}

function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(resolve(fileURLToPath(import.meta.url), "..", "..", "..", "package.json"), "utf8")) as { version: string };
  return manifest.version;
}

/** @implNote koffi is replaced, not left external, so the bundle never resolves it from a `node_modules` the user lacks. */
async function bundleEntry(source: string, outfile: string): Promise<Built> {
  const built = await bundleSource(source, outfile, { external: [], replaced: { koffi: sourceOf("runtime", "cached-koffi") } });
  checkImports(FOREBAY_HOST_ID, built, []);
  return built;
}

/** @internal {@link bundleHost} answering what went into the bundle too, for a test; not part of the package entry. */
export async function bundledHost(outDirectory: string, standard?: LoaderStandard): Promise<BundledHost> {
  if (standard !== undefined) requireLoaderStandard(standard, "the loader standard");
  const out = resolve(outDirectory);
  const host = await bundleEntry(sourceOf("cli", "host-main"), join(out, HOST_ENTRY));
  const worker = await bundleEntry(sourceOf("context", "reconcile-worker"), join(out, WORKER_ENTRY));
  const boot = await bundleEntry(sourceOf("boot", "boot-entry"), join(out, BOOT_ENTRY));
  const version = packageVersion();
  const files = { ...writeEntry(out, HOST_ENTRY, host), ...writeEntry(out, WORKER_ENTRY, worker), ...writeEntry(out, BOOT_ENTRY, boot), [MANIFEST_FILE]: join(out, MANIFEST_FILE) };
  writeFile(files[MANIFEST_FILE], `${JSON.stringify({ id: FOREBAY_HOST_ID, version, entry: HOST_ENTRY, ...standard }, null, 2)}\n`);
  const imports = [...new Set([...host.imports, ...worker.imports, ...boot.imports].map((entry) => entry.path))].sort();
  return { output: { id: FOREBAY_HOST_ID, version, files }, inputs: [...new Set([...host.inputs, ...worker.inputs, ...boot.inputs])].sort(), imports };
}

/**
 * Bundles the user-facing host into `host.js`, with `reconcile-worker.js` beside it as its own
 * entry, since the host starts it by its path, `boot.js`, the versionless entry the cache copies
 * out of the installed bundle, and a `host.json` naming the host's id and version.
 * A loader passes its `standard`, which `host.json` then carries as `application`, `pathCommands`
 * and `background`; a plain host passes none and its `host.json` is unchanged.
 *
 * @remarks Neither entry carries esbuild or the build code: the host's CLI is a separate entry from
 * the developer's. `koffi` is loaded at run time from the cache the bundle is installed in.
 */
export async function bundleHost(outDirectory: string, standard?: LoaderStandard): Promise<BundleOutput> {
  return (await bundledHost(outDirectory, standard)).output;
}
