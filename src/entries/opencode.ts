import { startJavascriptHost } from "../javascript-host/start-javascript-host.js";
import type { JavascriptHost } from "../javascript-host/start-javascript-host.js";
import { processEnvironment } from "../process-environment.js";

const STOP_FIX = "nothing is needed now; the next session starts the host again";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeError(text: string): void {
  process.stderr.write(text);
}

/**
 * Starts loader `loaderId`'s plugins in this process for the application's session, as OpenCode's
 * in-process entry does: this process is the application, so nothing holds the host and it stops
 * when the process exits.
 *
 * @implNote An exit runs only the synchronous start of the stop, and a stop that fails is written
 * to stderr, never left as an unhandled rejection that would take the application down.
 */
export async function startSessionHost(loaderId: string, bundleFile: string): Promise<JavascriptHost> {
  const host = await startJavascriptHost({ hostId: loaderId, bundleFile, environment: processEnvironment(), held: false, writeError });
  const stopOnExit = () => {
    host.stop().catch((error: unknown) => writeError(`spisor could not stop the session host: ${messageOf(error)}\nfix: ${STOP_FIX}\n`));
  };
  process.once("exit", stopOnExit);
  return {
    ...host,
    stop: () => {
      process.off("exit", stopOnExit);
      return host.stop();
    },
  };
}
