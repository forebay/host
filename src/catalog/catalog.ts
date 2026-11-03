import { validateCatalogIndex } from "./schema.generated.js";

export interface FileRef {
  url: string;
  sha256: string;
  size: number;
}

export interface CatalogVersion {
  files?: Record<string, FileRef>;
  platforms?: Record<string, { files: Record<string, FileRef> }>;
  packages?: Record<string, unknown>;
}

export interface CatalogItem {
  kind: "plugin" | "host" | "library";
  versions: Record<string, CatalogVersion>;
  latest: string;
}

export interface Catalog {
  format: 1;
  items: Record<string, CatalogItem>;
}

export interface CatalogRefusal {
  detail: string;
  fix: string;
  path?: string;
}

const SCHEMA_FIXES: Record<string, string> = {
  pattern: "use a 64-character lowercase hex sha256, and a file key that is a relative path with / separators, no .. segment and no leading /",
  enum: "use one of the values the schema lists for this member",
  required: "add the missing member",
  const: "set the member to the value the schema requires",
  anyOf: "give the version a files member, a platforms member, or both",
  type: "give the member the type the schema requires",
  minimum: "use a value of at least the schema's minimum",
  minLength: "give the member a non-empty value",
};

interface SchemaError {
  instancePath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
}

function refusalFor(error: SchemaError): CatalogRefusal {
  const missing = typeof error.params.missingProperty === "string" ? `/${error.params.missingProperty}` : "";
  const named = typeof error.params.propertyName === "string" ? `/${error.params.propertyName}` : "";
  return {
    detail: `the catalog index ${error.message ?? "is invalid"}`,
    fix: SCHEMA_FIXES[error.keyword] ?? "correct the member the path names",
    path: `${error.instancePath}${missing}${named}`,
  };
}

function absolute(url: string, origin: string): string {
  return new URL(url, origin).href;
}

function resolveFiles(files: Record<string, FileRef> | undefined, origin: string): void {
  for (const reference of Object.values(files ?? {})) reference.url = absolute(reference.url, origin);
}

function resolveVersion(version: CatalogVersion, origin: string): void {
  resolveFiles(version.files, origin);
  for (const platform of Object.values(version.platforms ?? {})) resolveFiles(platform.files, origin);
}

function unknownLatest(catalog: Catalog): CatalogRefusal | undefined {
  for (const [id, item] of Object.entries(catalog.items)) {
    if (item.versions[item.latest] === undefined) {
      return {
        detail: `item ${id} names latest version ${item.latest}, which it does not list`,
        fix: "set latest to one of the item's versions",
        path: `/items/${id}/latest`,
      };
    }
  }
  return undefined;
}

function parseJson(text: string): unknown | CatalogRefusal {
  try {
    return JSON.parse(text);
  } catch (error) {
    return { detail: `the catalog index is not valid JSON: ${(error as Error).message}`, fix: "serve the index as a JSON document" };
  }
}

/**
 * @implNote A relative `url` resolves against `origin`, the index's own URL, so a catalog of
 * local build outputs can name the files that sit beside it without knowing where it is mounted.
 */
export function readCatalog(text: string, origin: string): Catalog | CatalogRefusal {
  const parsed = parseJson(text);
  if (parsed !== null && typeof parsed === "object" && "fix" in parsed && "detail" in parsed) return parsed as CatalogRefusal;
  if (!validateCatalogIndex(parsed)) return refusalFor((validateCatalogIndex.errors as SchemaError[])[0] as SchemaError);
  const catalog = parsed as Catalog;
  const latestRefusal = unknownLatest(catalog);
  if (latestRefusal !== undefined) return latestRefusal;
  try {
    for (const item of Object.values(catalog.items)) {
      for (const version of Object.values(item.versions)) resolveVersion(version, origin);
    }
  } catch {
    return { detail: `a file url cannot be resolved against the origin ${origin}`, fix: "give the index an absolute origin URL, or absolute file urls" };
  }
  return catalog;
}
