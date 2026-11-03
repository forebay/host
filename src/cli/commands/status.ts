import { startInstalledHost } from "../start-installed-host.js";
import type { CommandLineOutput } from "../output.js";

/** Starts the installed host from the cache with no background check, prints its `HostStatus` as JSON, and stops it. */
export async function statusCommand(bundleFile: string, environment: Record<string, string>, output: CommandLineOutput): Promise<void> {
  const running = await startInstalledHost(bundleFile, environment);
  try {
    output.out(JSON.stringify(running.status(), null, 2));
  } finally {
    await running.stop();
  }
}
