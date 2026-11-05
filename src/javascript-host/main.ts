import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startSessionHost } from "../entries/opencode.js";
import { isPluginError } from "@weivel/typescript/engine";
import { HostRefusal } from "../host-refusal.js";
import type { JavascriptHost } from "./start-javascript-host.js";
import { startJavascriptHost } from "./start-javascript-host.js";
import { processEnvironment } from "../process-environment.js";
import { REINSTALL_FIX } from "./cached-layer.js";
import { ACTION_MODE, actionRequestOf, runActionMode } from "./action.js";

const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const USAGE_FIX = "start it as <runtime executable> host.js <host id>, or with action <plugin> <action> <input json object> after the host id";

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
    host = await startJavascriptHost({ hostId, bundleFile: bundleFile(), environment: processEnvironment(), held: true, session: true, onUnheld: (exitCode) => process.exit(exitCode), writeError });
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

/** Runs one plugin action on host `hostId`'s plugins and exits with its code. */
async function runOneAction(hostId: string, arguments_: string[]): Promise<void> {
  const request = actionRequestOf(arguments_);
  if (request === undefined) {
    writeError(`the action mode takes a plugin, an action and its input as a JSON object\nfix: ${USAGE_FIX}\n`);
    process.exit(2);
  }
  try {
    const code = await runActionMode(request, { hostId, bundleFile: bundleFile(), environment: processEnvironment(), writeError, writeOutput: (text) => process.stdout.write(text) });
    process.exit(code);
  } catch (error) {
    writeError(refusalText(hostId, error));
    process.exit(1);
  }
}

if (isThisProcessEntry()) {
  const [hostId, mode, ...rest] = process.argv.slice(2);
  if (hostId !== undefined && mode === undefined) void runHeldHost(hostId);
  else if (hostId !== undefined && mode === ACTION_MODE) void runOneAction(hostId, rest);
  else {
    writeError(`the javascript-host takes a host id, and action with its arguments after it\nfix: ${USAGE_FIX}\n`);
    process.exit(2);
  }
}
