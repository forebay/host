import { validateCatalogIndex } from "./schema.generated.js";

const PROBE_ID = "probe";
const PROBE_VERSION = "0.0.0";
const PROBE_FILE = { url: "probe", sha256: "0".repeat(64), size: 0 };

function indexWith(id: string, version: string, key: string): unknown {
  return { format: 1, items: { [id]: { kind: "plugin", latest: version, versions: { [version]: { files: { [key]: PROBE_FILE } } } } } };
}

/**
 * Whether the catalog schema accepts `id` as an item id.
 *
 * @implNote Each check validates a one-item index through the generated validator, so a builder
 * refuses exactly what a reader would and the schema's patterns are never restated.
 */
export function acceptsItemId(id: string): boolean {
  return validateCatalogIndex(indexWith(id, PROBE_VERSION, PROBE_ID));
}

export function acceptsVersion(version: string): boolean {
  return validateCatalogIndex(indexWith(PROBE_ID, version, PROBE_ID));
}

export function acceptsFileKey(key: string): boolean {
  return validateCatalogIndex(indexWith(PROBE_ID, PROBE_VERSION, key));
}
