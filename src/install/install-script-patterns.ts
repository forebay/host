import { isRecord } from "../plugins/is-record.js";
import { ps1Quoted, shQuoted, withRenderedSection } from "./install-script-sections.js";
import type { InstallScriptKind, RenderedSection } from "./install-script-sections.js";

const PATTERNS: RenderedSection = {
  begin: "# rendered from catalog.schema.json by scripts/render-install-scripts.mjs; edit the schema there",
  end: "# end of rendered patterns",
};

/** The catalog schema's patterns the install scripts check the host's catalog entry against. */
export interface CatalogKeyPatterns {
  fileKey: string;
  version: string;
  sha256: string;
}

function patternAt(schema: unknown, path: readonly string[]): string {
  const found = path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), schema);
  if (isRecord(found) && typeof found.pattern === "string") return found.pattern;
  throw new Error(`the catalog schema has no pattern at ${path.join("/")}`);
}

/** The file key, version and sha256 patterns of the catalog schema, so the scripts refuse exactly what the host does. */
export function catalogKeyPatterns(schema: unknown): CatalogKeyPatterns {
  return {
    fileKey: patternAt(schema, ["definitions", "files", "propertyNames"]),
    version: patternAt(schema, ["definitions", "item", "properties", "latest"]),
    sha256: patternAt(schema, ["definitions", "fileRef", "properties", "sha256"]),
  };
}

function shPatterns(patterns: CatalogKeyPatterns): string[] {
  return [`FILE_KEY_PATTERN=${shQuoted(patterns.fileKey)}`, `VERSION_PATTERN=${shQuoted(patterns.version)}`, `SHA256_PATTERN=${shQuoted(patterns.sha256)}`];
}

function ps1Patterns(patterns: CatalogKeyPatterns): string[] {
  return [`$FileKeyPattern = ${ps1Quoted(patterns.fileKey)}`, `$VersionPattern = ${ps1Quoted(patterns.version)}`, `$Sha256Pattern = ${ps1Quoted(patterns.sha256)}`];
}

/** `script` with its catalog patterns rendered from `patterns` for `kind`. */
export function withRenderedPatterns(script: string, kind: InstallScriptKind, patterns: CatalogKeyPatterns): string {
  return withRenderedSection(script, kind, PATTERNS, kind === "sh" ? shPatterns(patterns) : ps1Patterns(patterns));
}
