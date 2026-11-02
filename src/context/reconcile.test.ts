import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixture, REPOSITORY_ROOT } from "./fixture.js";
import type { Fixture } from "./fixture.js";
import { reconcileSecretsInBackground } from "./reconcile.js";

let fixture: Fixture;
const compiledWorker = pathToFileURL(join(REPOSITORY_ROOT, "dist", "context", "reconcile-worker.js"));

function writeBlockingWorker(directory: string): URL {
  const file = join(directory, "blocking-worker.mjs");
  writeFileSync(
    file,
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
await import(${JSON.stringify(compiledWorker.href)});
`,
  );
  return pathToFileURL(file);
}

/** Workers cannot load TypeScript, so the blocking test worker imports the real one from a fresh build of dist. */
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
    const blockingWorker = writeBlockingWorker(fixture.base);
    const order: string[] = [];
    const timer = setTimeout(() => order.push("timer"), 100);
    const answer = await reconcileSecretsInBackground(fixture.source, fixture.places, blockingWorker);
    order.push("resolved");
    clearTimeout(timer);
    expect(answer).toEqual({ moved: 0 });
    expect(order).toEqual(["timer", "resolved"]);
  });

  it("answers failed rather than rejecting when the worker cannot start", async () => {
    const answer = await reconcileSecretsInBackground(fixture.source, fixture.places, pathToFileURL(join(fixture.base, "missing.js")));
    expect(answer).toHaveProperty("failed");
  });
});
