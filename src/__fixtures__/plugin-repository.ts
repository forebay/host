import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const FIXTURE_PLUGINS = resolve(import.meta.dirname, "plugins");

export interface RepositoryLayout {
  manifest?: Record<string, unknown>;
  sources?: Record<string, string>;
}

function writeAll(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/**
 * A plugin repository built from fixture plugin `id`: its `plugin.json` with `index.mjs` as the
 * entry, its `index.ts` re-exported from `src/index.ts`, and a CommonJS package under
 * `node_modules` the entry imports, so a bundle has something to inline.
 *
 * @implNote The entry is `.mjs` because the cache holds no `package.json` marking a bundle as ESM.
 */
export function pluginRepository(root: string, id: string, layout: RepositoryLayout = {}): string {
  const manifest = { ...JSON.parse(readFileSync(join(FIXTURE_PLUGINS, id, "plugin.json"), "utf8")), entry: "index.mjs", ...layout.manifest };
  writeAll(root, {
    "plugin.json": JSON.stringify(manifest, null, 2),
    "src/plugin.ts": readFileSync(join(FIXTURE_PLUGINS, id, "index.ts"), "utf8"),
    "src/index.ts": 'import "inlined-dependency";\nexport { default } from "./plugin.js";\n',
    "node_modules/inlined-dependency/package.json": JSON.stringify({ name: "inlined-dependency", version: "1.0.0", main: "index.js" }),
    "node_modules/inlined-dependency/index.js": 'module.exports = { separator: require("node:path").sep };\n',
    ...layout.sources,
  });
  return root;
}

const MODULE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

/** Every module specifier the file's import statements, dynamic imports and requires name. */
export function importedSpecifiers(file: string): string[] {
  return [...new Set([...readFileSync(file, "utf8").matchAll(MODULE_SPECIFIER)].map((match) => match[1] as string))].sort();
}
