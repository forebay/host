import { describe, expect, it } from "vitest";
// @ts-expect-error the engine seam is internal and not part of the package entry
import type { HostEngine } from "./index.js";
import type { HostCatalog, HostOptions } from "./index.js";
import * as entry from "./index.js";

type StartParameters = Parameters<typeof entry.startHost>;
type TakesOnlyOptions = [HostOptions] extends StartParameters ? (StartParameters extends [HostOptions] ? true : false) : false;
type FetcherParameters = Parameters<typeof entry.defaultFetcher>;
type StoreParameters = Parameters<typeof entry.storeFile>;
type ReconcileParameters = Parameters<typeof entry.reconcileSecretsInBackground>;

const startTakesOnlyOptions: TakesOnlyOptions = true;
const reconcileTakesNoWorkerEntry: ReconcileParameters[2] extends URL | undefined ? (URL extends ReconcileParameters[2] ? false : true) : true = true;
const fetcherTakesNothing: FetcherParameters extends [] ? true : false = true;
const storeTakesNoSeams: StoreParameters["length"] extends 3 ? true : false = true;
const seamIsUnreachable: HostEngine | undefined = undefined;
const catalogCarriesNoStartChoice: "checkUpdates" extends keyof HostCatalog ? false : true = true;

describe("the package entry", () => {
  it("carries no test seam", () => {
    expect(Object.keys(entry)).not.toContain("startHostWith");
    expect(Object.keys(entry)).not.toContain("runReconcileWorker");
    expect(Object.keys(entry)).not.toContain("fetcherWith");
    expect(Object.keys(entry)).not.toContain("storeFileWith");
    expect(Object.keys(entry)).not.toContain("catalogTransportWith");
    for (const internal of ["checkCatalog", "catalogStatePath", "currentCatalog", "resolveVersions", "recordReferences", "readReferences", "sweepCache", "installedVersions", "compareVersions", "newestVersion", "startUpdates", "readBundleManifest", "pluginDirectoryOutput", "acceptsVersion", "isPlatformKey", "runCommandLine", "bundlePlugin", "bundlePluginWith", "buildLocalCatalog", "BuildRefusal"]) {
      expect(Object.keys(entry)).not.toContain(internal);
    }
    expect([startTakesOnlyOptions, reconcileTakesNoWorkerEntry, seamIsUnreachable, fetcherTakesNothing, storeTakesNoSeams, catalogCarriesNoStartChoice]).toEqual([true, true, undefined, true, true, true]);
  });

  it("carries the boot path a loader starts a host from the cache through", () => {
    expect(typeof entry.bootFromCache).toBe("function");
    expect(typeof entry.hostLibraryReferences).toBe("function");
  });
});
