import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = [
  ["install/install.sh", "sh"],
  ["install/install.ps1", "ps1"],
];

/** @implNote Both modules are imported as TypeScript, which Node strips without a build since 22.18. */
const { withRenderedPins } = await import("../src/install/install-script-pins.ts");
const { COMPATIBLE_RUNTIME_MAJOR, RUNTIME_PIN } = await import("../src/install/runtime-pin.ts");

for (const [relative, kind] of SCRIPTS) {
  const path = join(repositoryRoot, relative);
  const committed = readFileSync(path, "utf8");
  const rendered = withRenderedPins(committed, kind, RUNTIME_PIN, COMPATIBLE_RUNTIME_MAJOR);
  if (rendered !== committed) writeFileSync(path, rendered);
  process.stdout.write(`${relative}: ${rendered === committed ? "unchanged" : "rendered"}\n`);
}
