import { pluginError } from "@weivel/typescript/engine";
import type { LedgerRow, PluginStatus } from "@weivel/typescript/engine";
import type { LoadedHost } from "@weivel/typescript/host";
import { describe, expect, it } from "vitest";
import { statusOf } from "./status.js";

function row(pluginId: string, status: PluginStatus, error?: { detail: string; fix: string }): LedgerRow {
  return {
    pluginId,
    status,
    ...(error === undefined ? {} : { error }),
    capabilitiesDeclared: [],
    capabilitiesProvided: [],
    permissions: [],
    servicesConsumed: [],
    servicesProvided: [],
    topics: [],
  };
}

function loadedWith(started: string[], quarantined: LoadedHost["quarantined"], rows: LedgerRow[]): LoadedHost {
  return { started, quarantined, host: { ledger: { entries: () => rows } } } as unknown as LoadedHost;
}

describe("statusOf", () => {
  it("reports a library refusal under libraries, never as a quarantined plugin", () => {
    const loaded = loadedWith(
      ["a"],
      [pluginError("owner/repo@v1.0.0", "the release has no asset for this platform", "publish one")],
      [row("a", "active")],
    );
    const status = statusOf("test-host", loaded, null);
    expect(status.active).toEqual(["a"]);
    expect(status.quarantined).toEqual([]);
    expect(status.libraries).toEqual([{ id: "owner/repo@v1.0.0", detail: "the release has no asset for this platform", fix: "publish one" }]);
  });

  it("reports a plugin quarantined after it started as quarantined and not active", () => {
    const broken = { detail: "it threw while serving", fix: "fix the plugin" };
    const loaded = loadedWith(["a", "b"], [], [row("a", "active"), row("b", "broken", broken)]);
    const status = statusOf("test-host", loaded, null);
    expect(status.active).toEqual(["a"]);
    expect(status.quarantined).toEqual([{ id: "b", ...broken }]);
  });
});
