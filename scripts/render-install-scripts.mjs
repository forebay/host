import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = [
  ["install/install.sh", "sh"],
  ["install/install.ps1", "ps1"],
];

/** @implNote Bundled first, since Node strips types but does not resolve the `.js` specifiers the TypeScript imports by. */
async function importRenderer() {
  const bundled = await build({ entryPoints: [join(repositoryRoot, "src/install/render-install-script.ts")], bundle: true, format: "esm", platform: "node", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}

const { COMPATIBLE_RUNTIME_MAJOR, RUNTIME_PIN, renderInstallScript } = await importRenderer();
const schema = JSON.parse(readFileSync(join(repositoryRoot, "catalog.schema.json"), "utf8"));

for (const [relative, kind] of SCRIPTS) {
  const path = join(repositoryRoot, relative);
  const committed = readFileSync(path, "utf8");
  const rendered = renderInstallScript(committed, kind, RUNTIME_PIN, COMPATIBLE_RUNTIME_MAJOR, schema);
  if (rendered !== committed) writeFileSync(path, rendered);
  process.stdout.write(`${relative}: ${rendered === committed ? "unchanged" : "rendered"}\n`);
}
