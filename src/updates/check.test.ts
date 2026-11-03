import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CatalogSource } from "../catalog/sources.js";
import { catalogStatePath, checkCatalog, currentCatalog } from "./check.js";
import type { CatalogState, CatalogTransport } from "./check.js";

const URL_SOURCE: CatalogSource = { kind: "https", url: "https://catalog.test/index.json" };
const HOUR = 3_600_000;
const START = new Date("2026-11-03T08:00:00.000Z");

let cache: string;

function index(latest: string): string {
  const files = { "plugin.json": { url: `a/${latest}/plugin.json`, sha256: "0".repeat(64), size: 1 } };
  return JSON.stringify({ format: 1, items: { a: { kind: "plugin", latest, versions: { [latest]: { files } } } } });
}

interface RecordingTransport extends CatalogTransport {
  calls: Array<{ url: string; etag?: string }>;
}

function serving(answer: () => Awaited<ReturnType<CatalogTransport["get"]>>): RecordingTransport {
  const calls: RecordingTransport["calls"] = [];
  return {
    calls,
    async get(url, etag) {
      calls.push(etag === undefined ? { url } : { url, etag });
      return answer();
    },
  };
}

function failing(): RecordingTransport {
  return serving(() => {
    throw new Error("the network is down");
  });
}

function stateOf(source: CatalogSource): CatalogState {
  return JSON.parse(readFileSync(catalogStatePath(cache, source), "utf8")) as CatalogState;
}

function later(hours: number): Date {
  return new Date(START.getTime() + hours * HOUR);
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "host-check-"));
});

afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

describe("checkCatalog over https", () => {
  it("makes one request for two checks inside the interval", async () => {
    const transport = serving(() => ({ status: 200, body: index("1.0.0"), etag: "\"one\"" }));
    expect((await checkCatalog(URL_SOURCE, cache, START, 24, transport)).kind).toBe("changed");
    expect(await checkCatalog(URL_SOURCE, cache, later(23), 24, transport)).toEqual({ kind: "skipped" });
    expect(transport.calls).toHaveLength(1);
  });

  it("keeps the index, its etag and the time of the check under the cache's catalog folder", async () => {
    await checkCatalog(URL_SOURCE, cache, START, 24, serving(() => ({ status: 200, body: index("1.0.0"), etag: "\"one\"" })));
    expect(catalogStatePath(cache, URL_SOURCE).startsWith(join(cache, "catalog"))).toBe(true);
    expect(stateOf(URL_SOURCE)).toEqual({ etag: "\"one\"", checkedAt: START.toISOString(), index: index("1.0.0") });
    expect(currentCatalog(URL_SOURCE, cache)?.items.a?.versions["1.0.0"]?.files?.["plugin.json"]?.url).toBe("https://catalog.test/a/1.0.0/plugin.json");
  });

  it("asks again once the interval has passed, sending the etag, and answers a 304 as unchanged", async () => {
    await checkCatalog(URL_SOURCE, cache, START, 24, serving(() => ({ status: 200, body: index("1.0.0"), etag: "\"one\"" })));
    const transport = serving(() => ({ status: 304 }));
    expect(await checkCatalog(URL_SOURCE, cache, later(25), 24, transport)).toEqual({ kind: "unchanged" });
    expect(transport.calls).toEqual([{ url: URL_SOURCE.url, etag: "\"one\"" }]);
    expect(stateOf(URL_SOURCE).checkedAt).toBe(later(25).toISOString());
  });

  it("answers a newer index as changed and keeps it", async () => {
    await checkCatalog(URL_SOURCE, cache, START, 24, serving(() => ({ status: 200, body: index("1.0.0") })));
    const check = await checkCatalog(URL_SOURCE, cache, later(25), 24, serving(() => ({ status: 200, body: index("2.0.0") })));
    expect(check.kind === "changed" && check.catalog.items.a?.latest).toBe("2.0.0");
    expect(currentCatalog(URL_SOURCE, cache)?.items.a?.latest).toBe("2.0.0");
  });

  it("leaves checkedAt where the last successful check put it when a check fails, so the next start retries", async () => {
    await checkCatalog(URL_SOURCE, cache, START, 24, serving(() => ({ status: 200, body: index("1.0.0"), etag: "\"one\"" })));
    const failed = await checkCatalog(URL_SOURCE, cache, later(25), 24, failing());
    expect(failed.kind).toBe("failed");
    expect(failed.kind === "failed" && failed.detail).toContain("the network is down");
    expect(stateOf(URL_SOURCE)).toEqual({ etag: "\"one\"", checkedAt: START.toISOString(), index: index("1.0.0") });
    const retry = serving(() => ({ status: 304 }));
    expect(await checkCatalog(URL_SOURCE, cache, later(26), 24, retry)).toEqual({ kind: "unchanged" });
    expect(retry.calls).toHaveLength(1);
  });

  it("retries on the next check after a first check that failed", async () => {
    expect((await checkCatalog(URL_SOURCE, cache, START, 24, failing())).kind).toBe("failed");
    const retry = serving(() => ({ status: 200, body: index("1.0.0") }));
    expect((await checkCatalog(URL_SOURCE, cache, later(1), 24, retry)).kind).toBe("changed");
    expect(retry.calls).toHaveLength(1);
  });

  it("answers an index the catalog reader refuses as failed and keeps the previous one", async () => {
    await checkCatalog(URL_SOURCE, cache, START, 24, serving(() => ({ status: 200, body: index("1.0.0") })));
    const check = await checkCatalog(URL_SOURCE, cache, later(25), 24, serving(() => ({ status: 200, body: "{" })));
    expect(check.kind).toBe("failed");
    expect(currentCatalog(URL_SOURCE, cache)?.items.a?.latest).toBe("1.0.0");
    expect(stateOf(URL_SOURCE).checkedAt).toBe(START.toISOString());
  });

  it("answers a 304 with no kept index as failed, since there is nothing it could mean unchanged from", async () => {
    expect((await checkCatalog(URL_SOURCE, cache, START, 24, serving(() => ({ status: 304 })))).kind).toBe("failed");
  });

  it("refuses a source whose url is not https without asking the transport", async () => {
    const transport = serving(() => ({ status: 200, body: index("1.0.0") }));
    const check = await checkCatalog({ kind: "https", url: "http://catalog.test/index.json" }, cache, START, 24, transport);
    expect(check.kind).toBe("failed");
    expect(transport.calls).toEqual([]);
  });
});

describe("checkCatalog over a local source", () => {
  function localSource(latest: string): CatalogSource {
    const directory = join(cache, "..", `${cache.split(/[\\/]/).pop()}-local`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "catalog.json"), index(latest));
    return { kind: "local", path: join(directory, "catalog.json") };
  }

  afterEach(() => {
    rmSync(`${cache}-local`, { recursive: true, force: true });
  });

  it("reads the index from disk every time and never asks the transport", async () => {
    const transport = failing();
    const source = localSource("1.0.0");
    expect((await checkCatalog(source, cache, START, 24, transport)).kind).toBe("changed");
    expect(await checkCatalog(source, cache, later(1), 24, transport)).toEqual({ kind: "unchanged" });
    localSource("2.0.0");
    const changed = await checkCatalog(source, cache, later(2), 24, transport);
    expect(changed.kind === "changed" && changed.catalog.items.a?.latest).toBe("2.0.0");
    expect(transport.calls).toEqual([]);
  });

  it("answers the index on disk as the current catalog before any check ran", () => {
    expect(currentCatalog(localSource("1.0.0"), cache)?.items.a?.latest).toBe("1.0.0");
  });

  it("answers a missing index as failed", async () => {
    const check = await checkCatalog({ kind: "local", path: join(cache, "absent.json") }, cache, START, 24, failing());
    expect(check.kind).toBe("failed");
  });
});
