import type { Catalog } from "../catalog/catalog.js";
import { mergeCatalogs } from "../catalog/sources.js";
import type { CatalogSource } from "../catalog/sources.js";
import { currentCatalog } from "./check.js";

/** Every source's current catalog merged, earlier sources winning an id, with no request made. */
export function currentCatalogs(sources: readonly CatalogSource[], cache: string): Catalog {
  const readings = sources.flatMap((source) => {
    const catalog = currentCatalog(source, cache);
    return catalog === undefined ? [] : [{ source, catalog }];
  });
  return mergeCatalogs(readings).catalog;
}
