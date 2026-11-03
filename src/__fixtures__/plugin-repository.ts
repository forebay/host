import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
 * A plugin repository built from fixture plugin `id`: its `plugin.json`, its `index.ts` re-exported
 * from `src/index.ts`, and a CommonJS package under `node_modules` the entry imports, so a bundle
 * has something to inline.
 */
export function pluginRepository(root: string, id: string, layout: RepositoryLayout = {}): string {
  const manifest = { ...JSON.parse(readFileSync(join(FIXTURE_PLUGINS, id, "plugin.json"), "utf8")), ...layout.manifest };
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

/**
 * What `expression` evaluates to with the module at `entry` imported as `loaded`, in a plain `node`
 * process whose runner script is written into `scratch`.
 *
 * @implNote Out of process because a vitest worker has a global `require`, which hides a bundle
 * whose inlined CommonJS would fail to load anywhere else; and with syntax detection off, so a
 * `.js` bundle loads as ESM only when a `package.json` says it is one, as on Node 20 before 20.19.
 */
export function evaluatedInNode(entry: string, expression: string, scratch: string): string {
  const runner = join(scratch, "runner.mjs");
  mkdirSync(scratch, { recursive: true });
  writeFileSync(runner, [`const loaded = await import(${JSON.stringify(pathToFileURL(entry).href)});`, `process.stdout.write(String(${expression}));`].join("\n"));
  return execFileSync(process.execPath, ["--no-experimental-detect-module", runner], { encoding: "utf8" });
}
