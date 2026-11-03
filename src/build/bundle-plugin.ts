import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";
import { BuildRefusal } from "./build-refusal.js";
import { readBundleManifest } from "./bundle-manifest.js";
import type { BundleManifest } from "./bundle-manifest.js";
import { MODULE_MARKER_CONTENT, moduleMarkerKey } from "./module-marker.js";

/**
 * Gives inlined CommonJS a working `require`, which esbuild's ESM output otherwise replaces with a
 * stub that throws.
 *
 * @implNote esbuild's require shim reads the free name `require`, and esbuild renames any top-level
 * `require` a plugin declares itself, so this binding never collides with the plugin's own.
 */
const REQUIRE_BANNER = 'import { createRequire as __forebayHostCreateRequire } from "node:module";\nconst require = __forebayHostCreateRequire(import.meta.url);\n';

/** @implNote koffi carries a native module per platform, which is delivered as a library rather than inlined. */
const EXTERNAL = ["koffi"];

const REQUIRE_SHIM = 'typeof require !== "undefined"';

const RUNTIME_REQUIRE_KINDS = new Set(["require-call", "require-resolve"]);

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

interface EsbuildFailure {
  errors?: Array<{ text: string; location?: { file: string; line: number } | null }>;
}

interface MetafileImport {
  path: string;
  kind: string;
  external?: boolean;
}

interface Built {
  text: string;
  imports: MetafileImport[];
}

function failureDetail(error: unknown): string {
  const first = (error as EsbuildFailure).errors?.[0];
  if (first === undefined) return (error as Error).message;
  return first.location ? `${first.location.file}:${first.location.line}: ${first.text}` : first.text;
}

/** @implNote esbuild is imported here, not at the top, so nothing but the developer commands ever loads it. */
async function bundleSource(source: string, outfile: string, external: string[]): Promise<Built> {
  const { build } = await import("esbuild");
  try {
    const result = await build({ entryPoints: [source], outfile, bundle: true, format: "esm", platform: "node", target: "node20", external, metafile: true, write: false, logLevel: "silent" });
    const [file] = result.outputFiles;
    const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports);
    return { text: file?.text ?? "", imports };
  } catch (error) {
    throw new BuildRefusal(`${source} could not be bundled: ${failureDetail(error)}`, "correct the source esbuild names, or install the dependency it cannot resolve");
  }
}

function isAllowedImport(specifier: string): boolean {
  return isBuiltin(specifier) || EXTERNAL.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function checkImports(id: string, imports: MetafileImport[]): string[] {
  const specifiers = [...new Set(imports.map((entry) => entry.path))].sort();
  const foreign = specifiers.filter((specifier) => !isAllowedImport(specifier));
  if (foreign.length === 0) return specifiers;
  throw new BuildRefusal(`the bundle of ${id} would still import ${foreign.join(", ")} at run time`, "let the bundle inline it, or reach it through the host instead of importing it");
}

/** @implNote A `require` of a computed name never reaches the metafile, so esbuild's shim in the text counts too. */
function needsRequire(built: Built): boolean {
  return built.imports.some((entry) => entry.external === true && RUNTIME_REQUIRE_KINDS.has(entry.kind)) || built.text.includes(REQUIRE_SHIM);
}

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function writeBundle(manifest: BundleManifest, out: string, built: Built): BundleOutput {
  const files: Record<string, string> = { [manifest.entry]: join(out, manifest.entry), "plugin.json": join(out, "plugin.json") };
  writeFile(files[manifest.entry] as string, needsRequire(built) ? `${REQUIRE_BANNER}${built.text}` : built.text);
  copyFileSync(manifest.path, files["plugin.json"] as string);
  const markerKey = moduleMarkerKey(manifest.entry);
  if (markerKey !== undefined) {
    files[markerKey] = join(out, markerKey);
    writeFile(files[markerKey], MODULE_MARKER_CONTENT);
  }
  return { id: manifest.id, version: manifest.version, files };
}

/** @internal `bundlePlugin` with the modules left external given, so a test can make one escape; not part of the package entry. */
export async function bundlePluginWith(repositoryRoot: string, outDirectory: string, external: string[]): Promise<BundledPlugin> {
  const manifest = readBundleManifest(resolve(repositoryRoot));
  const out = resolve(outDirectory);
  const built = await bundleSource(resolve(repositoryRoot, manifest.source), join(out, manifest.entry), external);
  const imports = checkImports(manifest.id, built.imports);
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
