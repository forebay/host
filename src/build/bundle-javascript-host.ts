import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BundleOutput } from "./bundle-plugin.js";
import { bundleSource, checkImports, writeEntry, writeFile } from "./esbuild-bundle.js";
import type { Built } from "./esbuild-bundle.js";

const LAYER_ID = "javascript-host";
const HOST_ENTRY = "host.js";
const WORKER_ENTRY = "runtime-worker.js";
const MANIFEST_FILE = "host.json";
const RUNTIME = "javascript";

/** @internal The bundle with every source file inlined into it and every module it still imports; not part of the package entry. */
export interface BundledJavascriptHost {
  output: BundleOutput;
  inputs: string[];
  imports: string[];
}

/** @implNote Run from `src` the sources are `.ts`, run from `dist` they are `.js`; either way they sit beside this module. */
function sourceOf(...segments: string[]): string {
  const here = fileURLToPath(import.meta.url);
  const last = segments.pop() as string;
  return resolve(here, "..", "..", ...segments, `${last}${extname(here)}`);
}

function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(resolve(fileURLToPath(import.meta.url), "..", "..", "..", "package.json"), "utf8")) as { version: string };
  return manifest.version;
}

/** @implNote koffi is replaced, not left external, so the bundle never resolves it from a `node_modules` the user lacks. */
async function bundleEntry(source: string, outfile: string): Promise<Built> {
  const built = await bundleSource(source, outfile, { external: [], replaced: { koffi: sourceOf("runtime", "cached-koffi") } });
  checkImports(LAYER_ID, built, []);
  return built;
}

/** @internal {@link bundleJavascriptHost} answering what went into the bundle too, for a test; not part of the package entry. */
export async function bundledJavascriptHost(outDirectory: string): Promise<BundledJavascriptHost> {
  const out = resolve(outDirectory);
  const host = await bundleEntry(sourceOf("javascript-host", "main"), join(out, HOST_ENTRY));
  const worker = await bundleEntry(sourceOf("context", "runtime-worker"), join(out, WORKER_ENTRY));
  const version = packageVersion();
  const files = { ...writeEntry(out, HOST_ENTRY, host), ...writeEntry(out, WORKER_ENTRY, worker), [MANIFEST_FILE]: join(out, MANIFEST_FILE) };
  writeFile(files[MANIFEST_FILE], `${JSON.stringify({ id: LAYER_ID, version, entry: HOST_ENTRY, runtime: RUNTIME }, null, 2)}\n`);
  const imports = [...new Set([...host.imports, ...worker.imports].map((entry) => entry.path))].sort();
  return { output: { id: LAYER_ID, version, files }, inputs: [...new Set([...host.inputs, ...worker.inputs])].sort(), imports };
}

/**
 * Bundles the javascript-host: `host.js`, which a launcher starts as `<runtime executable> host.js
 * <host id>` and OpenCode's entry imports for `runSessionHost`, `runtime-worker.js` beside it,
 * which it starts by path, and a `host.json` naming its id, version, entry and `javascript` runtime.
 *
 * @remarks Neither entry carries esbuild or the build code. `koffi` is loaded at run time from the
 * cache the bundle is installed in.
 */
export async function bundleJavascriptHost(outDirectory: string): Promise<BundleOutput> {
  return (await bundledJavascriptHost(outDirectory)).output;
}
