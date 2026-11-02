import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const FIXTURE_PLUGINS = resolve(import.meta.dirname, "plugins");

function compiled(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

/** @implNote The marker makes Node read the compiled bundles as ESM, the way a deployed plugin directory is. */
function markAsModules(root: string): void {
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
}

export function compileFixtureBundles(root: string, ids: readonly string[]): string {
  mkdirSync(root, { recursive: true });
  markAsModules(root);
  for (const id of ids) {
    const target = join(root, id);
    mkdirSync(target, { recursive: true });
    copyFileSync(join(FIXTURE_PLUGINS, id, "plugin.json"), join(target, "plugin.json"));
    writeFileSync(join(target, "index.js"), compiled(readFileSync(join(FIXTURE_PLUGINS, id, "index.ts"), "utf8")));
  }
  return root;
}
