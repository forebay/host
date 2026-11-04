import { hostSettings } from "../../host-settings.js";
import { isRecord } from "../../plugins/is-record.js";
import { runUntilUnheld } from "../../processes/background-run.js";
import type { BackgroundRunEnd } from "../../processes/background-run.js";
import { DEFAULT_HOLDER_CHECK_MILLISECONDS } from "../../processes/holders.js";
import { openRuntime } from "../../runtime/open.js";
import { hostRunOf, openCacheSession, readRegistration, startFromCache } from "../cache-session.js";
import type { CacheSession } from "../cache-session.js";

const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

/** `processes.holderCheckMilliseconds` from the host's settings, the default when it is absent or not a positive number. */
function holderCheckOf(settings: Record<string, unknown>): number {
  const configured = isRecord(settings.processes) ? settings.processes.holderCheckMilliseconds : undefined;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_HOLDER_CHECK_MILLISECONDS;
}

/** @implNote Read before the host starts, since the holder loop runs from the first moment of the process. */
function holderCheckOfHost(session: CacheSession, home: string): number {
  const runtime = openRuntime(session.boot.runtime);
  try {
    return holderCheckOf(hostSettings(runtime, session.setup.places, home).all());
  } finally {
    runtime.close();
  }
}

function abortOnStopSignals(controller: AbortController): () => void {
  const abort = () => controller.abort();
  for (const signal of STOP_SIGNALS) process.on(signal, abort);
  return () => {
    for (const signal of STOP_SIGNALS) process.off(signal, abort);
  };
}

/**
 * Runs background host `hostId` from its registration with the plugins its settings enable, until
 * no launcher holding it is alive or it is told to stop, then stops it; `abandoned` when that came
 * before its start answered, so the process has to exit by itself.
 *
 * @implNote The stop signals are taken before the host starts, so a launcher's stop arriving
 * mid-start still stops the plugins rather than killing the process under them.
 */
export async function backgroundCommand(hostId: string, bundleFile: string, environment: Record<string, string>): Promise<BackgroundRunEnd> {
  const controller = new AbortController();
  const release = abortOnStopSignals(controller);
  try {
    const session = openCacheSession(bundleFile, environment);
    const registration = readRegistration(session, hostId);
    const identity = { id: hostId, version: registration.version, home: registration.home, requiresCommand: registration.requiresCommand, commands: [], ...(registration.application === undefined ? {} : { application: registration.application }) };
    return await runUntilUnheld({
      state: session.setup.places.state,
      hostId,
      intervalMs: holderCheckOfHost(session, registration.home),
      signal: controller.signal,
      start: () => startFromCache(session, identity, hostRunOf(session, hostId, registration.version), environment),
    });
  } finally {
    release();
  }
}
