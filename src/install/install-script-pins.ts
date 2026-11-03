import type { PinnedRuntime, RuntimeBuild } from "./runtime-pin.js";

export type InstallScriptKind = "sh" | "ps1";

const PINS_BEGIN = "# rendered from src/install/runtime-pin.ts by scripts/render-install-scripts.mjs; edit the pin there";
const PINS_END = "# end of rendered pins";

function shQuoted(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function ps1Quoted(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

function shBuild(platform: string, build: RuntimeBuild): string[] {
  return [
    `    ${shQuoted(platform)})`,
    `      RUNTIME_URL=${shQuoted(build.url)}`,
    `      RUNTIME_SHA256=${shQuoted(build.sha256)}`,
    `      RUNTIME_ARCHIVE=${shQuoted(build.archive)}`,
    "      ;;",
  ];
}

function shPins(pin: PinnedRuntime, compatibleMajor: number): string[] {
  return [
    `RUNTIME_NAME=${shQuoted(pin.name)}`,
    `RUNTIME_VERSION=${shQuoted(pin.version)}`,
    `RUNTIME_COMPATIBLE_MAJOR=${compatibleMajor}`,
    "select_runtime_build() {",
    '  case "$1" in',
    ...Object.entries(pin.platforms).flatMap(([platform, build]) => shBuild(platform, build)),
    "    *) return 1 ;;",
    "  esac",
    "}",
  ];
}

function ps1Pins(pin: PinnedRuntime, compatibleMajor: number): string[] {
  const builds = Object.entries(pin.platforms).map(
    ([platform, build]) => `    ${ps1Quoted(platform)} = @{ Url = ${ps1Quoted(build.url)}; Sha256 = ${ps1Quoted(build.sha256)}; Archive = ${ps1Quoted(build.archive)} }`,
  );
  return [`$RuntimeName = ${ps1Quoted(pin.name)}`, `$RuntimeVersion = ${ps1Quoted(pin.version)}`, `$RuntimeCompatibleMajor = ${compatibleMajor}`, "$RuntimeBuilds = @{", ...builds, "}"];
}

function renderedPins(kind: InstallScriptKind, pin: PinnedRuntime, compatibleMajor: number): string[] {
  return [PINS_BEGIN, ...(kind === "sh" ? shPins(pin, compatibleMajor) : ps1Pins(pin, compatibleMajor)), PINS_END];
}

/**
 * `script` with the lines from its pins marker to its end marker replaced by `pin` rendered for
 * `kind`, so the scripts carry the same runtime the TypeScript pins.
 *
 * @remarks Throws when either marker is missing, since rendering would otherwise drop the pins.
 */
export function withRenderedPins(script: string, kind: InstallScriptKind, pin: PinnedRuntime, compatibleMajor: number): string {
  const lines = script.split("\n");
  const begin = lines.indexOf(PINS_BEGIN);
  const end = lines.indexOf(PINS_END);
  if (begin < 0 || end < begin) throw new Error(`the ${kind} install script has no "${PINS_BEGIN}" line followed by "${PINS_END}"`);
  return [...lines.slice(0, begin), ...renderedPins(kind, pin, compatibleMajor), ...lines.slice(end + 1)].join("\n");
}
