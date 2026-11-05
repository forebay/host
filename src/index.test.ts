import { describe, expect, it } from "vitest";
import * as entry from "./index.js";

const MOVED_TO_RUNTIME = [
  "registerHost",
  "hostsApi",
  "mergeNavigation",
  "settingsView",
  "renderEntry",
  "renderHeadless",
  "renderHeadlessSettings",
  "applicationList",
  "pluginList",
  "presentItems",
  "renderPluginList",
  "threeStateList",
  "readCatalog",
  "catalogSources",
  "mergeCatalogs",
  "readCatalogSources",
  "CacheRefusal",
  "defaultFetcher",
  "storeFile",
  "installVersion",
  "cacheBundleSource",
  "bootFromCache",
  "hostLibraryReferences",
  "checkLoaderStandard",
  "resolveApplicationHome",
  "HomeRefusal",
  "findOnPath",
  "detectApplication",
  "detectThroughMethods",
  "operate",
  "installMethodProviders",
  "writeApplicationEntry",
  "enabledPlugins",
  "disabledPlugins",
  "pinnedVersions",
  "withDefaults",
];

const LAYER = ["startHost", "buildRuntime", "callBinding", "runAction", "renderScreen", "navigationOf", "bundlePlugin", "bundleLoader", "bundleJavascriptHost", "bundleKoffiLibrary", "openRuntime", "siblingRuntime"];

describe("the package entry", () => {
  it("exports nothing whose behaviour moved to the runtime services", () => {
    expect(MOVED_TO_RUNTIME.filter((name) => Object.hasOwn(entry, name))).toEqual([]);
  });

  it("exports the layer: the start, the bindings, the screens and the bundlers", () => {
    expect(LAYER.filter((name) => typeof (entry as Record<string, unknown>)[name] !== "function")).toEqual([]);
  });

  it("carries no test seam", () => {
    for (const internal of ["startHostWith", "runReconcileWorker", "bundlePluginWith", "startJavascriptHost"]) {
      expect(Object.keys(entry)).not.toContain(internal);
    }
  });
});
