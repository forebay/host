import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG_URL } from "../__fixtures__/catalog.js";
import { readBootHint, writeBootHint } from "../boot/boot-hint.js";
import { installVersion } from "../cache/install-version.js";
import type { Fetcher } from "../cache/fetcher.js";
import type { CatalogItem } from "../catalog/catalog.js";
import { hostRunOf } from "../cli/cache-session.js";
import type { CacheSession } from "../cli/cache-session.js";
import type { HostPlaces } from "../context/places.js";
import { catalogStart } from "./catalog-start.js";
import { readHostReferences } from "./references.js";

const LOADER = "fixture-loader";
const FOREBAY_HOST = "forebay-host";
const LIBRARIES = { runtime: "0.1.0", koffi: "1.0.0" };

let base: string;
let places: HostPlaces;
let served: Map<string, Uint8Array>;
let index: { format: 1; items: Record<string, CatalogItem> };

function hostItem(id: string, versions: string[], latest: string): CatalogItem {
  const listed = Object.fromEntries(
    versions.map((version) => {
      const bytes = Buffer.from(JSON.stringify({ id, version }));
      const url = `https://catalog.test/${id}/${version}/host.json`;
      served.set(url, bytes);
      return [version, { files: { "host.json": { url, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length } } }];
    }),
  );
  return { kind: "host", latest, versions: listed };
}

const fetcher: Fetcher = {
  async fetch(url) {
    const bytes = served.get(url);
    if (bytes === undefined) throw new Error(`nothing served at ${url}`);
    return bytes;
  },
};

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "host-host-updates-"));
  places = { cache: join(base, "cache"), state: join(base, "state") } as HostPlaces;
  served = new Map();
  index = { format: 1, items: { [LOADER]: hostItem(LOADER, ["1.0.0", "2.0.0"], "2.0.0"), [FOREBAY_HOST]: hostItem(FOREBAY_HOST, ["1.0.0", "2.0.0"], "2.0.0") } };
  for (const id of [LOADER, FOREBAY_HOST]) await installVersion(places.cache, id, index.items[id] as CatalogItem, "1.0.0", fetcher);
  writeBootHint(places.cache, FOREBAY_HOST, LIBRARIES, "1.0.0");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("a start's background update check", () => {
  it("schedules a newer loader and forebay-host for the next start, which then runs both", async () => {
    const start = catalogStart(
      { sources: [{ kind: "https", url: CATALOG_URL }], transport: { get: async () => ({ status: 200, body: JSON.stringify(index) }) }, fetcher, references: { run: { [LOADER]: "1.0.0", [FOREBAY_HOST]: "1.0.0" }, next: {} } },
      places,
      LOADER,
      {},
      {},
    );
    const updates = start.startUpdates();
    await vi.waitFor(() => expect(updates.progress().finished).toBe(true));
    start.releaseRun();

    expect(updates.progress().fetched.sort()).toEqual([`${LOADER}@2.0.0`, `${FOREBAY_HOST}@2.0.0`]);
    expect(readHostReferences(places.state, LOADER).next).toEqual({ [LOADER]: "2.0.0", [FOREBAY_HOST]: "2.0.0" });
    const session = { location: { cache: places.cache }, setup: { places } } as unknown as CacheSession;
    expect(hostRunOf(session, LOADER, "1.0.0").version).toBe("2.0.0");
    expect(readBootHint(places.cache, FOREBAY_HOST)).toEqual({ libraries: LIBRARIES, host: "2.0.0" });
  });

  it("holds a host to its pin", async () => {
    const start = catalogStart(
      { sources: [{ kind: "https", url: CATALOG_URL }], transport: { get: async () => ({ status: 200, body: JSON.stringify(index) }) }, fetcher, references: { run: { [LOADER]: "1.0.0", [FOREBAY_HOST]: "1.0.0" }, next: {} } },
      places,
      LOADER,
      { plugins: { [LOADER]: { pin: "1.0.0" } } },
      {},
    );
    const updates = start.startUpdates();
    await vi.waitFor(() => expect(updates.progress().finished).toBe(true));
    start.releaseRun();

    expect(updates.progress().fetched).toEqual([`${FOREBAY_HOST}@2.0.0`]);
    expect(readHostReferences(places.state, LOADER).next).toEqual({ [FOREBAY_HOST]: "2.0.0" });
  });
});
