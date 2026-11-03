import { ps1Quoted, shQuoted, withRenderedSection } from "./install-script-sections.js";
import type { InstallScriptKind, RenderedSection } from "./install-script-sections.js";
import type { PinnedRuntime, RuntimeBuild } from "./runtime-pin.js";

const PINS: RenderedSection = {
  begin: "# rendered from src/install/runtime-pin.ts by scripts/render-install-scripts.mjs; edit the pin there",
  end: "# end of rendered pins",
};

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

/** `script` with its pins rendered from `pin` for `kind`, so the scripts carry the same runtime the TypeScript pins. */
export function withRenderedPins(script: string, kind: InstallScriptKind, pin: PinnedRuntime, compatibleMajor: number): string {
  return withRenderedSection(script, kind, PINS, kind === "sh" ? shPins(pin, compatibleMajor) : ps1Pins(pin, compatibleMajor));
}

export type { InstallScriptKind };
