import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileFixtureBundles } from "./bundles.js";
import type { Fetcher } from "../cache/fetcher.js";
import type { CatalogTransport } from "../updates/check.js";

export const CATALOG_URL = "https://catalog.test/index.json";

export interface ServedCatalog {
  index: string;
  files: Map<string, Uint8Array>;
}

export interface RecordingFetcher extends Fetcher {
  urls: string[];
}

export interface RecordingTransport extends CatalogTransport {
  calls: number;
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @implNote The entry is served as `.mjs` because the cache holds no `package.json` marking its folders as ESM. */
function versionFiles(compiled: string, id: string, version: string): Record<string, Uint8Array> {
  const manifest = { ...JSON.parse(readFileSync(join(compiled, id, "plugin.json"), "utf8")), version, entry: "index.mjs" };
  return {
    "plugin.json": Buffer.from(JSON.stringify(manifest)),
    "index.mjs": readFileSync(join(compiled, id, "index.js")),
  };
}

/** A catalog listing fixture plugin `id` at each of `versions`, its files served from `CATALOG_URL`'s origin. */
export function servedCatalog(workspace: string, id: string, versions: string[], latest: string): ServedCatalog {
  const compiled = compileFixtureBundles(join(workspace, "compiled"), [id]);
  const files = new Map<string, Uint8Array>();
  const listed: Record<string, { files: Record<string, { url: string; sha256: string; size: number }> }> = {};
  for (const version of versions) {
    const references: Record<string, { url: string; sha256: string; size: number }> = {};
    for (const [key, bytes] of Object.entries(versionFiles(compiled, id, version))) {
      const url = `https://catalog.test/${id}/${version}/${key}`;
      files.set(url, bytes);
      references[key] = { url, sha256: sha256Of(bytes), size: bytes.length };
    }
    listed[version] = { files: references };
  }
  return { index: JSON.stringify({ format: 1, items: { [id]: { kind: "plugin", latest, versions: listed } } }), files };
}

export function servingFetcher(served: ServedCatalog): RecordingFetcher {
  const urls: string[] = [];
  return {
    urls,
    async fetch(url) {
      urls.push(url);
      const bytes = served.files.get(url);
      if (bytes === undefined) throw new Error(`nothing served at ${url}`);
      return bytes;
    },
  };
}

export function servingTransport(answer: () => Promise<Awaited<ReturnType<CatalogTransport["get"]>>>): RecordingTransport {
  const transport: RecordingTransport = {
    calls: 0,
    async get() {
      transport.calls += 1;
      return answer();
    },
  };
  return transport;
}
