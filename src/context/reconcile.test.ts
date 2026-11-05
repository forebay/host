import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFixture, REPOSITORY_ROOT } from "../__fixtures__/context.js";
import type { Fixture } from "../__fixtures__/context.js";
import { runReconcileWorker } from "./reconcile.js";

let fixture: Fixture;
const compiledWorker = pathToFileURL(join(REPOSITORY_ROOT, "dist", "context", "runtime-worker.js"));

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

describe("runReconcileWorker", () => {
  it("resolves with a count while the calling thread keeps running", async () => {
    const blockingWorker = writeBlockingWorker(fixture.base);
    const order: string[] = [];
    const timer = setTimeout(() => order.push("timer"), 100);
    const answer = await runReconcileWorker(fixture.source, fixture.places, blockingWorker);
    order.push("resolved");
    clearTimeout(timer);
    expect(answer).toEqual({ moved: 0 });
    expect(order).toEqual(["timer", "resolved"]);
  });

  it("terminates the worker and answers failed once its signal aborts", async () => {
    const stalled = join(fixture.base, "stalled-worker.mjs");
    writeFileSync(stalled, "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);");
    const controller = new AbortController();
    const answer = runReconcileWorker(fixture.source, fixture.places, pathToFileURL(stalled), controller.signal);
    controller.abort();
    expect(await answer).toEqual({ failed: "the host stopped before the reconcile finished" });
  });

  it("lets go of its signal once the worker has answered", async () => {
    const listening = new Set<unknown>();
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: unknown) => listening.add(listener),
      removeEventListener: (_type: string, listener: unknown) => listening.delete(listener),
    } as unknown as AbortSignal;
    const answer = await runReconcileWorker(fixture.source, fixture.places, compiledWorker, signal);
    expect(answer).toEqual({ moved: 0 });
    expect(listening.size).toBe(0);
  });

  it("answers failed rather than rejecting when the worker cannot start", async () => {
    const answer = await runReconcileWorker(fixture.source, fixture.places, pathToFileURL(join(fixture.base, "missing.js")));
    expect(answer).toHaveProperty("failed");
  });
});
