import { join } from "node:path";
import type { BundleSource } from "../plugins/bundle-source.js";
import { siblingRuntime } from "../runtime/open.js";
import { startHost } from "../start.js";
import type { RunningHost } from "../start.js";
import { REPOSITORY_ROOT } from "./context.js";

/** A host in temp places under `base` whose `demo:greeting` defaults to the greeter fixture. */
export function startGreeterHost(base: string, bundles: BundleSource): Promise<RunningHost> {
  return startHost({
    identity: { id: "test-host", version: "1.0.0", home: join(base, "home"), requiresCommand: false, commands: [] },
    runtime: siblingRuntime(REPOSITORY_ROOT),
    bundles,
    defaults: { "demo:greeting": "greeter" },
    consumes: ["demo:greeting"],
    environment: {
      HOME: join(base, "user"),
      USERPROFILE: join(base, "user"),
      SPISOR_HOME: join(base, "portable"),
      SPISOR_STATE: join(base, "state"),
      SPISOR_CACHE: join(base, "cache"),
      SPISOR_SECRETS: join(base, "secrets"),
    },
  });
}
