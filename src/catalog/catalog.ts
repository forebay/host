import type { LoaderApplication } from "../loader/standard.js";
import { foldedDuplicate } from "./folded-keys.js";
import { validateCatalogIndex } from "./schema.generated.js";
import { resolveWithinOrigin } from "./urls.js";

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
  application?: LoaderApplication;
  installMethod?: string;
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
  pattern: "use the shape the schema's pattern requires: a plugin-style id, a semver version, a 64-character lowercase hex sha256, or a file key of non-empty relative segments with / separators",
  enum: "use one of the values the schema lists for this member",
  required: "add the missing member",
  const: "set the member to the value the schema requires",
  type: "give the member the type the schema requires",
  minimum: "use a value of at least the schema's minimum",
  minLength: "give the member a non-empty value",
  not: "remove the member, which this kind of item may not carry; only a host item may have an application",
};

const NEITHER_FILES_NOR_PLATFORMS_FIX = "list files, platforms, or both";
const BYTE_ORDER_MARK = "\uFEFF";

export type CatalogReading = { ok: true; catalog: Catalog } | { ok: false; refusal: CatalogRefusal };

interface SchemaError {
  instancePath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
  propertyName?: string;
}

function refusalFor(error: SchemaError): CatalogRefusal {
  const missing = typeof error.params.missingProperty === "string" ? `/${error.params.missingProperty}` : "";
  const named = typeof error.propertyName === "string" ? `/${error.propertyName}` : "";
  const fix = error.keyword === "anyOf" ? NEITHER_FILES_NOR_PLATFORMS_FIX : SCHEMA_FIXES[error.keyword] ?? "correct the member the path names";
  return { detail: `the catalog index ${error.message ?? "is invalid"}`, fix, path: `${error.instancePath}${missing}${named}` };
}

function mostSpecificError(errors: SchemaError[]): SchemaError {
  return errors.find((error) => error.keyword === "anyOf") ?? (errors[0] as SchemaError);
}

function refuse(refusal: CatalogRefusal): CatalogReading {
  return { ok: false, refusal };
}

function resolveFiles(files: Record<string, FileRef> | undefined, origin: string): string | undefined {
  for (const [key, reference] of Object.entries(files ?? {})) {
    const resolved = resolveWithinOrigin(reference.url, origin);
    if (resolved === undefined) return key;
    reference.url = resolved;
  }
  return undefined;
}

function refusalForUrl(id: string, version: string, key: string, origin: string): CatalogRefusal {
  return {
    detail: `the url of file ${key} in ${id}@${version} leaves its source (resolved against ${origin})`,
    fix: "use an https url under an https index, or a file url inside the index's own directory under a file index",
    path: `/items/${id}/versions/${version}`,
  };
}

function resolveCatalogUrls(catalog: Catalog, origin: string): CatalogRefusal | undefined {
  for (const [id, item] of Object.entries(catalog.items)) {
    for (const [name, version] of Object.entries(item.versions)) {
      const platformFiles = Object.values(version.platforms ?? {}).map((platform) => platform.files);
      for (const files of [version.files, ...platformFiles]) {
        const offending = resolveFiles(files, origin);
        if (offending !== undefined) return refusalForUrl(id, name, offending, origin);
      }
    }
  }
  return undefined;
}

function unknownLatest(catalog: Catalog): CatalogRefusal | undefined {
  for (const [id, item] of Object.entries(catalog.items)) {
    if (!Object.hasOwn(item.versions, item.latest)) {
      return {
        detail: `item ${id} names latest version ${item.latest}, which it does not list`,
        fix: "set latest to one of the item's versions",
        path: `/items/${id}/latest`,
      };
    }
  }
  return undefined;
}

/** The key sets one install of `version` writes into one directory: the shared files alone, or with each platform's. */
function installedKeySets(version: CatalogVersion): string[][] {
  const shared = Object.keys(version.files ?? {});
  const platforms = Object.values(version.platforms ?? {});
  return platforms.length === 0 ? [shared] : platforms.map((platform) => [...shared, ...Object.keys(platform.files)]);
}

function caseCollision(catalog: Catalog): CatalogRefusal | undefined {
  for (const [id, item] of Object.entries(catalog.items)) {
    for (const [name, version] of Object.entries(item.versions)) {
      const pair = installedKeySets(version).map(foldedDuplicate).find((found) => found !== undefined);
      if (pair === undefined) continue;
      return {
        detail: `files ${pair[0]} and ${pair[1]} of ${id}@${name} differ only by case, so Windows and macOS would install both into one file`,
        fix: "give every file of a version a name that differs from the others in more than case",
        path: `/items/${id}/versions/${name}`,
      };
    }
  }
  return undefined;
}

/** @implNote A leading byte order mark is dropped, as an editor on Windows writes one and JSON.parse refuses it. */
function parseJson(text: string): { value: unknown } | CatalogRefusal {
  try {
    return { value: JSON.parse(text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text) };
  } catch (error) {
    return { detail: `the catalog index is not valid JSON: ${(error as Error).message}`, fix: "serve the index as a JSON document" };
  }
}

/**
 * @implNote A relative `url` resolves against `origin`, the index's own URL, so a catalog of
 * local build outputs can name the files that sit beside it without knowing where it is mounted.
 */
export function readCatalog(text: string, origin: string): CatalogReading {
  const parsed = parseJson(text);
  if (!("value" in parsed)) return refuse(parsed);
  if (!validateCatalogIndex(parsed.value)) return refuse(refusalFor(mostSpecificError(validateCatalogIndex.errors as SchemaError[])));
  const catalog = parsed.value as Catalog;
  const refusal = unknownLatest(catalog) ?? caseCollision(catalog) ?? resolveCatalogUrls(catalog, origin);
  return refusal === undefined ? { ok: true, catalog } : refuse(refusal);
}
