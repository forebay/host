import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startSessionHost } from "../entries/opencode.js";
import { isPluginError } from "@weivel/typescript/engine";
import { HostRefusal } from "../host-refusal.js";
import type { JavascriptHost } from "./start-javascript-host.js";
import { startJavascriptHost } from "./start-javascript-host.js";
import { processEnvironment } from "../process-environment.js";
import { REINSTALL_FIX } from "./cached-layer.js";

const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const USAGE_FIX = "start it as <runtime executable> host.js <host id>";

function bundleFile(): string {
  return fileURLToPath(import.meta.url);
}

function writeError(text: string): void {
  process.stderr.write(text);
}

/** A refusal's detail and fix, from a host refusal and a weivel plugin error alike, as OpenCode's entry reports one. */
function refusalText(hostId: string, error: unknown): string {
  const refusal = error instanceof HostRefusal || isPluginError(error) ? error : undefined;
  const detail = refusal?.detail ?? (error instanceof Error ? error.message : String(error));
  return `spisor did not start ${hostId}: ${detail}\nfix: ${refusal?.fix ?? REINSTALL_FIX}\n`;
}

function isThisProcessEntry(): boolean {
  const started = process.argv[1];
  if (started === undefined) return false;
  try {
    return realpathSync(started) === realpathSync(bundleFile());
  } catch {
    return false;
  }
}

/** @implNote Exits explicitly once stopped, since a plugin may leave a handle open that would keep the process alive. */
function exitWhenStopped(stopping: Promise<void>, code: number): void {
  stopping.then(
    () => process.exit(code),
    (error: unknown) => {
      writeError(`spisor could not stop the host: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}

/** Runs background host `hostId` until no holder is left or it is told to stop. */
async function runHeldHost(hostId: string): Promise<void> {
  let host: JavascriptHost | undefined;
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
    if (host !== undefined) exitWhenStopped(host.stop(), 0);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, stop);
  try {
    host = await startJavascriptHost({ hostId, bundleFile: bundleFile(), environment: processEnvironment(), held: true, onUnheld: (exitCode) => process.exit(exitCode), writeError });
  } catch (error) {
    writeError(refusalText(hostId, error));
    process.exit(1);
  }
  if (stopRequested) stop();
}

/** OpenCode's in-process entry: starts loader `loaderId`'s plugins in OpenCode's own process. */
export function runSessionHost(loaderId: string): Promise<JavascriptHost> {
  return startSessionHost(loaderId, bundleFile());
}

if (isThisProcessEntry()) {
  const hostId = process.argv[2];
  if (hostId === undefined || process.argv.length !== 3) {
    writeError(`the javascript-host takes exactly one host id\nfix: ${USAGE_FIX}\n`);
    process.exit(2);
  }
  void runHeldHost(hostId);
}
