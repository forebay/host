import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DECLARATION = join(ROOT, "siblings", "library", "runtime", "library.json");
const OUTPUT = join(ROOT, "src", "runtime", "types.ts");
const HOST_ENTRY = pathToFileURL(join(ROOT, "siblings", "typescript", "dist", "host", "index.js")).href;

/**
 * @implNote The weivel type generator accepts `enum` but not `const`, and the runtime declaration
 * uses `const`, so a one-value enum stands in for it. The declaration is not edited.
 */
function constAsEnum(node) {
  if (Array.isArray(node)) return node.map(constAsEnum);
  if (node === null || typeof node !== "object") return node;
  const entries = Object.entries(node).map(([key, value]) => (key === "const" ? ["enum", [value]] : [key, constAsEnum(value)]));
  return Object.fromEntries(entries);
}

async function main() {
  const { generateLibraryTypes, parseDeclaration } = await import(HOST_ENTRY);
  const declaration = parseDeclaration(JSON.stringify(constAsEnum(JSON.parse(readFileSync(DECLARATION, "utf8")))));
  writeFileSync(OUTPUT, generateLibraryTypes(declaration));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
