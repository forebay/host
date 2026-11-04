import { catalogProvenance } from "../../install/forebay-host.js";
import { loaderIdentity } from "../../install/loader-identity.js";
import { isRecord } from "../../plugins/is-record.js";
import { standardOf } from "../../launch/session.js";
import { registerHost } from "../../registration.js";
import { openRuntime } from "../../runtime/open.js";
import { readHostReferences, recordReferences } from "../../updates/references.js";
import { hostRunOf, openCacheSession, readRegistration } from "../cache-session.js";
import type { CacheSession, HostRun } from "../cache-session.js";
import { CommandRefusal } from "../command-refusal.js";

const HOOK_EVENTS = new Set(["session-start"]);
const REINSTALL_FIX = "run forebay-host install --catalog <path or url> again";

export interface HookRequest {
  loaderId: string;
  event: string;
}

function checkEvent(event: string): void {
  if (HOOK_EVENTS.has(event)) return;
  throw new CommandRefusal(`the hook event ${JSON.stringify(event)} is not one this host answers`, `run the hook with one of: ${[...HOOK_EVENTS].join(", ")}`);
}

/** Records what a start of the loader runs, as `launch` does, so a sweep keeps that version and the one it switched from. */
function recordRun(state: string, loaderId: string, run: HostRun): void {
  const recorded = readHostReferences(state, loaderId);
  recordReferences(state, loaderId, { run: { ...recorded.run, [loaderId]: run.version }, next: run.next, rollback: run.rollback });
}

/** @implNote The version is chosen by {@link hostRunOf}, the rule every start of the loader follows, so a scheduled version is switched to here as a launch would. */
function registerLoader(session: CacheSession, request: HookRequest, environment: Record<string, string>): void {
  const run = hostRunOf(session, request.loaderId, readRegistration(session, request.loaderId).version);
  const { version } = run;
  const standard = standardOf(session, request.loaderId, version);
  const { places } = session.setup;
  const runtime = openRuntime(session.boot.runtime);
  try {
    const identity = loaderIdentity(runtime, { id: request.loaderId, version, application: standard.application, pathCommands: standard.pathCommands, places, environment });
    registerHost(runtime, places, identity, catalogProvenance(places.cache, request.loaderId, version, new Date()), environment);
  } finally {
    runtime.close();
  }
  recordRun(places.state, request.loaderId, run);
}

function refusalText(error: unknown): string {
  const { detail, fix } = isRecord(error) ? (error as { detail?: unknown; fix?: unknown }) : {};
  const shownDetail = typeof detail === "string" ? detail : (error as Error).message;
  const shownFix = typeof fix === "string" ? fix : REINSTALL_FIX;
  return `${shownDetail}\nfix: ${shownFix}\n`;
}

/**
 * Answers one event of the application's own plugin mechanism for loader `loaderId`: registers the
 * loader, requesting its commands again, and records its reference file, starting no plugin.
 *
 * @implNote Silent on success and never failing, because the application runs this as it starts:
 * Claude Code reads a SessionStart hook's stdout as context, and a spisor problem must never stop
 * the application starting. So nothing is written to stdout, and a refusal or any other error is
 * written to stderr with its fix while the command still exits 0.
 */
export async function hookCommand(request: HookRequest, bundleFile: string, environment: Record<string, string>, writeError: (text: string) => void): Promise<void> {
  try {
    checkEvent(request.event);
    registerLoader(openCacheSession(bundleFile, environment), request, environment);
  } catch (error) {
    writeError(refusalText(error));
  }
}
