import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixture, REPOSITORY_ROOT } from "./fixture.js";
import type { Fixture } from "./fixture.js";
import { reconcileSecretsInBackground } from "./reconcile.js";

let fixture: Fixture;
const compiledWorker = pathToFileURL(join(REPOSITORY_ROOT, "dist", "context", "reconcile-worker.js"));

/** Workers cannot load TypeScript, so the test runs the worker from a fresh build of dist. */
beforeAll(() => {
  execFileSync(process.execPath, [join(REPOSITORY_ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"], {
    cwd: REPOSITORY_ROOT,
  });
}, 120000);
beforeEach(() => {
  fixture = createFixture();
});
afterEach(() => fixture.dispose());

describe("reconcileSecretsInBackground", () => {
  it("resolves with a count while the calling thread keeps running", async () => {
    const order: string[] = [];
    const timer = setTimeout(() => order.push("timer"), 100);
    const answer = await reconcileSecretsInBackground(fixture.source, fixture.places, { workerEntry: compiledWorker, delayMilliseconds: 600 });
    order.push("resolved");
    clearTimeout(timer);
    expect(answer).toEqual({ moved: 0 });
    expect(order).toEqual(["timer", "resolved"]);
  });

  it("answers failed rather than rejecting when the worker cannot start", async () => {
    const answer = await reconcileSecretsInBackground(fixture.source, fixture.places, { workerEntry: pathToFileURL(join(fixture.base, "missing.js")) });
    expect(answer).toHaveProperty("failed");
  });
});
