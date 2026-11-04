import { describe, expect, it } from "vitest";
import { startFixtureHost } from "../../__fixtures__/running-host.js";
import type { Catalog } from "../../catalog/catalog.js";
import { emptyReport } from "../../install/install-report.js";
import type { MissingApplicationsHost } from "../../install/missing-applications.js";
import type { RunningHost } from "../../start.js";
import { runCommands } from "../command-line.js";
import type { CommandLineOutput } from "../output.js";
import { resolveApplicationsForCommand } from "./install.js";

const FILE = { url: "https://catalog.test/file", sha256: "0".repeat(64), size: 1 };
const APPLICATION = { id: "claude", label: "Claude", binary: "claude-binary-absent", home: { candidates: ["~/.claude"] }, packages: { fake: "claude-pkg" } };
const CATALOG: Catalog = { format: 1, items: { claude: { kind: "host", latest: "1.0.0", versions: { "1.0.0": { files: { "host.json": FILE } } }, application: APPLICATION } } };

describe("install command line", () => {
  it("answers 2 and names the offered methods for an --application method that is not offered, installing nothing", async () => {
    const started: RunningHost[] = [];
    const host: MissingApplicationsHost = {
      async start() {
        const fixture = await startFixtureHost(["fake-install-method"]);
        started.push(fixture.running);
        return { ...fixture.running, stop: fixture.dispose };
      },
      installProvider: () => {
        throw new Error("nothing should be installed");
      },
    };
    const printed: string[] = [];
    const output: CommandLineOutput = { out: (line) => printed.push(line), error: (line) => printed.push(line) };
    const report = emptyReport();

    const code = await runCommands(
      ["install"],
      output,
      () => resolveApplicationsForCommand({ catalog: CATALOG, environment: { PATH: "" }, choices: { claude: "winget" }, ask: () => Promise.resolve(undefined) }, host, report),
      "usage: forebay-host install",
      () => undefined,
    );

    expect(code).toBe(2);
    expect(printed.join("\n")).toMatch(/claude=winget.*offered methods are fake, skip/s);
    expect(report.applications).toEqual([]);
  });
});
