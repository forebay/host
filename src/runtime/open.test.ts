import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openRuntime, siblingRuntime } from "./open.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const scratch: string[] = [];

function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "host-runtime-"));
  scratch.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("the runtime library", () => {
  it("answers the four places the environment names", () => {
    const base = scratchDirectory();
    const environment = {
      SPISOR_HOME: join(base, "portable"),
      SPISOR_STATE: join(base, "state"),
      SPISOR_CACHE: join(base, "cache"),
      SPISOR_SECRETS: join(base, "secrets"),
    };
    const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
    try {
      const places = runtime.places.resolve({ home: join(base, "home"), environment });
      expect(places.portable).toBe(environment.SPISOR_HOME);
      expect(places.state).toBe(environment.SPISOR_STATE);
      expect(places.cache).toBe(environment.SPISOR_CACHE);
      expect(places.secretsFile).toContain(environment.SPISOR_SECRETS);
    } finally {
      runtime.close();
    }
  });

  it("throws on a failure answer", () => {
    const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
    try {
      expect(() => runtime.registry.get({ places: { state: scratchDirectory() }, id: "" })).toThrow();
    } finally {
      runtime.close();
    }
  });

  it("closes twice without throwing", () => {
    const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
    runtime.close();
    expect(() => runtime.close()).not.toThrow();
  });
});
