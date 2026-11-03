import { mkdirSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join } from "node:path";
import { BuildRefusal } from "./build-refusal.js";
import { MODULE_MARKER_CONTENT, moduleMarkerKey } from "../cache/module-marker.js";

/**
 * Gives inlined CommonJS a working `require`, which esbuild's ESM output otherwise replaces with a
 * stub that throws.
 *
 * @implNote esbuild's require shim reads the free name `require`, and esbuild renames any top-level
 * `require` a bundled module declares itself, so this binding never collides with the module's own.
 */
const REQUIRE_BANNER = 'import { createRequire as __forebayHostCreateRequire } from "node:module";\nconst require = __forebayHostCreateRequire(import.meta.url);\n';

const REQUIRE_SHIM = 'typeof require !== "undefined"';

const RUNTIME_REQUIRE_KINDS = new Set(["require-call", "require-resolve"]);

interface EsbuildFailure {
  errors?: Array<{ text: string; location?: { file: string; line: number } | null }>;
}

interface MetafileImport {
  path: string;
  kind: string;
  external?: boolean;
}

/** One bundled entry: its text, every module it still imports at run time, and every source file inlined into it. */
export interface Built {
  text: string;
  imports: MetafileImport[];
  inputs: string[];
}

/** How one entry is bundled: what stays external, and which bare specifiers resolve to a given file instead. */
export interface BundleSettings {
  external: string[];
  replaced?: Record<string, string>;
}

interface ReplacingPlugin {
  name: string;
  setup(build: { onResolve(options: { filter: RegExp }, callback: (arguments_: { path: string }) => { path: string } | undefined): void }): void;
}

function failureDetail(error: unknown): string {
  const first = (error as EsbuildFailure).errors?.[0];
  if (first === undefined) return (error as Error).message;
  return first.location ? `${first.location.file}:${first.location.line}: ${first.text}` : first.text;
}

function replacingPlugin(replaced: Record<string, string>): ReplacingPlugin {
  return {
    name: "replaced-modules",
    setup(build) {
      build.onResolve({ filter: /.*/ }, ({ path }) => (Object.hasOwn(replaced, path) ? { path: replaced[path] as string } : undefined));
    },
  };
}

function isAllowedImport(specifier: string, external: string[]): boolean {
  return isBuiltin(specifier) || external.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/** @implNote esbuild is imported here, not at the top, so nothing but the developer commands ever loads it. */
export async function bundleSource(source: string, outfile: string, settings: BundleSettings): Promise<Built> {
  const { build } = await import("esbuild");
  const plugins = settings.replaced === undefined ? [] : [replacingPlugin(settings.replaced)];
  try {
    const result = await build({
      entryPoints: [source],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      external: settings.external,
      plugins,
      metafile: true,
      write: false,
      logLevel: "silent",
    });
    const [file] = result.outputFiles;
    const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports);
    return { text: file?.text ?? "", imports, inputs: Object.keys(result.metafile.inputs) };
  } catch (error) {
    throw new BuildRefusal(`${source} could not be bundled: ${failureDetail(error)}`, "correct the source esbuild names, or install the dependency it cannot resolve");
  }
}

/** Every module `built` still imports at run time, refused unless each is a Node builtin or one of `external`. */
export function checkImports(id: string, built: Built, external: string[]): string[] {
  const specifiers = [...new Set(built.imports.map((entry) => entry.path))].sort();
  const foreign = specifiers.filter((specifier) => !isAllowedImport(specifier, external));
  if (foreign.length === 0) return specifiers;
  throw new BuildRefusal(`the bundle of ${id} would still import ${foreign.join(", ")} at run time`, "let the bundle inline it, or reach it through the host instead of importing it");
}

/** @implNote A `require` of a computed name never reaches the metafile, so esbuild's shim in the text counts too. */
function needsRequire(built: Built): boolean {
  return built.imports.some((entry) => entry.external === true && RUNTIME_REQUIRE_KINDS.has(entry.kind)) || built.text.includes(REQUIRE_SHIM);
}

export function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/**
 * Writes one bundled entry at `entry` under `out`, with the `package.json` marking it as ESM beside a `.js` entry.
 *
 * @returns the files written, keyed by their relative path with `/` separators.
 */
export function writeEntry(out: string, entry: string, built: Built): Record<string, string> {
  const files: Record<string, string> = { [entry]: join(out, entry) };
  writeFile(files[entry] as string, needsRequire(built) ? `${REQUIRE_BANNER}${built.text}` : built.text);
  const markerKey = moduleMarkerKey(entry);
  if (markerKey !== undefined) {
    files[markerKey] = join(out, markerKey);
    writeFile(files[markerKey], MODULE_MARKER_CONTENT);
  }
  return files;
}
