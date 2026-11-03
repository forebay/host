import { isRecord } from "../../plugins/is-record.js";
import { DEFAULT_HOLDER_CHECK_MILLISECONDS, selfExitWhenUnheld } from "../../processes/self-exit.js";
import { openCacheSession, readRegistration, startFromCache } from "../cache-session.js";

const STOP_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

/** `processes.holderCheckMilliseconds` from the host's settings, the default when it is absent or not a positive number. */
function holderCheckOf(settings: Record<string, unknown>): number {
  const configured = isRecord(settings.processes) ? settings.processes.holderCheckMilliseconds : undefined;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_HOLDER_CHECK_MILLISECONDS;
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
 * no launcher holding it is alive or it is told to stop, then stops it.
 *
 * @implNote The stop signals are taken before the host starts, so a launcher's stop arriving
 * mid-start still stops the plugins rather than killing the process under them.
 */
export async function backgroundCommand(hostId: string, bundleFile: string, environment: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const release = abortOnStopSignals(controller);
  try {
    const session = openCacheSession(bundleFile, environment);
    const registration = readRegistration(session, hostId);
    const identity = { id: hostId, version: registration.version, home: registration.home, requiresCommand: registration.requiresCommand, commands: [], ...(registration.application === undefined ? {} : { application: registration.application }) };
    const running = await startFromCache(session, identity, environment);
    try {
      await selfExitWhenUnheld(session.setup.places.state, hostId, holderCheckOf(running.settings.all()), controller.signal);
    } finally {
      await running.stop();
    }
  } finally {
    release();
  }
}
