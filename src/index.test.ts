import { describe, expect, it } from "vitest";
// @ts-expect-error the engine seam is internal and not part of the package entry
import type { HostEngine } from "./index.js";
import type { HostOptions } from "./index.js";
import * as entry from "./index.js";

type StartParameters = Parameters<typeof entry.startHost>;
type TakesOnlyOptions = [HostOptions] extends StartParameters ? (StartParameters extends [HostOptions] ? true : false) : false;
type ReconcileParameters = Parameters<typeof entry.reconcileSecretsInBackground>;

const startTakesOnlyOptions: TakesOnlyOptions = true;
const reconcileTakesNoWorkerEntry: ReconcileParameters[2] extends URL | undefined ? (URL extends ReconcileParameters[2] ? false : true) : true = true;
const seamIsUnreachable: HostEngine | undefined = undefined;

describe("the package entry", () => {
  it("carries no test seam", () => {
    expect(Object.keys(entry)).not.toContain("startHostWith");
    expect(Object.keys(entry)).not.toContain("runReconcileWorker");
    expect([startTakesOnlyOptions, reconcileTakesNoWorkerEntry, seamIsUnreachable]).toEqual([true, true, undefined]);
  });
});
