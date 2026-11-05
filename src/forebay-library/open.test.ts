import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Profile } from "../contracts/index.js";
import { forebayLibraryServices, openForebayLibrary, siblingForebayLibrary } from "./open.js";
import type { ForebayLibrary } from "./open.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const NOW = 1_000_000;
const PROFILE: Profile = {
  tierSourceProvider: "provider-a",
  tierOrder: ["opus"],
  tierFallback: ["opus"],
  tierRegex: "^claude-([a-z]+)-\\d",
  envPrefix: "ANTHROPIC",
  nativeModelPattern: null,
  defaultContext: 200000,
  defaultOutput: 64000,
  upstream: "http://127.0.0.1:1",
};
const MODELS = { "provider-a": { models: { "claude-opus-1": { name: "Opus", limit: { context: 1, output: 1 } } }, ranking: ["claude-opus-1"] } };

let base: string;
let library: ForebayLibrary;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "host-forebay-library-"));
  library = openForebayLibrary(siblingForebayLibrary(REPOSITORY_ROOT), () => ({ environment: {}, home: join(base, "home"), arguments: [] }));
});

afterAll(() => {
  library.close();
  rmSync(base, { recursive: true, force: true });
});

describe("forebay/library opened from its declaration", () => {
  it("offers apps, routing and accounts as host services", () => {
    expect(forebayLibraryServices(library).map((service) => service.id)).toEqual(["apps", "routing", "accounts"]);
  });

  it("answers every apps function", () => {
    expect(Array.isArray(library.apps.list({}).apps)).toBe(true);
    expect(library.apps.get({ id: "nobody" })).toEqual({});
    expect(library.apps.home({ id: "nobody" })).toEqual({});
    expect(typeof library.apps.current({}).id).toBe("string");
  });

  it("answers every routing function", () => {
    expect(library.routing.tiers({ profile: PROFILE, models: MODELS }).tiers).toContain("opus");
    const map = library.routing.modelMap({ profile: PROFILE, stored: {}, models: MODELS }).map ?? {};
    expect(map.opus?.[0]).toMatchObject({ provider: "provider-a", model: "claude-opus-1" });
    expect(library.routing.resolve({ profile: PROFILE, map, models: MODELS, requestedModel: "claude-opus-1" }).chain?.[0]?.model).toBe("claude-opus-1");
    expect(library.routing.outcome({ status: 429, headers: {}, now: NOW })).toEqual({ rateLimited: true });
    const environment = library.routing.environment({ profile: PROFILE, map, port: 40001, providersEnabled: false, environment: {}, userHome: join(base, "home") });
    expect(environment.environment).toEqual({ ANTHROPIC_BASE_URL: "http://127.0.0.1:40001" });
  });

  it("answers every accounts function", () => {
    const store = join(base, "accounts.json");
    expect(library.accounts.upsert({ store, account: { id: "a", label: "A" } }).outcome).toBe("added");
    expect(library.accounts.list({ store }).accounts?.map((account) => account.id)).toEqual(["a"]);
    expect(library.accounts.acquire({ store, strategy: "sticky", now: NOW }).id).toBe("a");
    expect(library.accounts.report({ store, id: "a", outcome: "success", now: NOW }).refused).toBeUndefined();
    expect(library.accounts.tokenExpired({ expires: null, now: NOW }).refused).toBeUndefined();
    expect(library.accounts.hasCapacity({ pools: [{ remainingFraction: 0.5 }] }).capacity).toBe(true);
    expect(library.accounts.remove({ store, id: "a" }).removed).toBe(true);
  });
});
