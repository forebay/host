import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG_URL, servedCatalog } from "../__fixtures__/catalog.js";
import { startUpdates } from "./background.js";
import type { UpdatePlan } from "./background.js";

let base: string;

function plan(extra: Partial<UpdatePlan>): UpdatePlan {
  const catalog = servedCatalog(join(base, "served"), "a", ["1.0.0"], "1.0.0");
  return {
    sources: [{ kind: "https", url: CATALOG_URL }],
    cache: join(base, "cache"),
    state: join(base, "state"),
    intervalHours: 24,
    transport: { get: async () => ({ status: 200, body: catalog.index }) },
    fetcher: { fetch: async () => new Uint8Array() },
    enabled: [{ id: "a" }],
    hosts: [],
    hostId: "test-host",
    run: {},
    problems: () => [],
    ...extra,
  };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-background-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("startUpdates", () => {
  it("records a version it could not install as refused, and finishes", async () => {
    const updates = startUpdates(plan({}));
    await vi.waitFor(() => expect(updates.progress().finished).toBe(true));
    expect(updates.progress().fetched).toEqual([]);
    expect(updates.progress().refused).toEqual([expect.objectContaining({ id: "a@1.0.0" })]);
    expect(updates.progress().interrupted).toBe(false);
  });

  it("stops while a fetch never answers, reporting the update interrupted rather than refused", async () => {
    const fetching = vi.fn(() => new Promise<Uint8Array>(() => {}));
    const updates = startUpdates(plan({ fetcher: { fetch: fetching } }));
    await vi.waitFor(() => expect(fetching).toHaveBeenCalled());
    await updates.stop();
    expect(updates.progress()).toMatchObject({ fetched: [], refused: [], interrupted: true, finished: true });
  });

  it("records the versions scheduled for the next start before it fetches any of them", async () => {
    const fetching = vi.fn(() => new Promise<Uint8Array>(() => {}));
    const updates = startUpdates(plan({ fetcher: { fetch: fetching }, run: { a: "0.9.0" } }));
    await vi.waitFor(() => expect(fetching).toHaveBeenCalled());
    expect(JSON.parse(readFileSync(join(base, "state", "bundles", "test-host.json"), "utf8"))).toEqual({ run: { a: "0.9.0" }, next: { a: "1.0.0" } });
    await updates.stop();
  });

  it("refetches a damaged version the start reported, even one the catalog's latest does not name", async () => {
    const urls: string[] = [];
    const catalog = servedCatalog(join(base, "served"), "a", ["1.0.0", "2.0.0"], "2.0.0");
    const updates = startUpdates(
      plan({
        transport: { get: async () => ({ status: 200, body: catalog.index }) },
        fetcher: { fetch: async (url) => (urls.push(url), catalog.files.get(url) as Uint8Array) },
        problems: () => [{ id: "a", version: "1.0.0", detail: "damaged", fix: "reinstall" }],
      }),
    );
    await vi.waitFor(() => expect(updates.progress().finished).toBe(true));
    expect(updates.progress().fetched).toEqual(["a@1.0.0", "a@2.0.0"]);
  });
});
