import { currentPlatformKey } from "@weivel/typescript/host";
import type { Catalog } from "../catalog/catalog.js";
import type { HostPlaces } from "../context/places.js";
import type { ApplicationProvenance } from "../install/application-provenance.js";
import { emptyReport } from "../install/install-report.js";
import { ensureProvider, runningOf } from "../install/provider-install.js";
import type { MissingApplicationsHost, ProviderSession } from "../install/provider-install.js";
import type { LoaderApplication } from "../loader/standard.js";
import type { Runtime } from "../runtime/open.js";
import { detectRecorded } from "./detect.js";
import { operate } from "./operate.js";

const PATH_METHOD = "path";

/** What an update or a remove of an application needs to reach its install method's provider: how to start a host, and the catalog a missing provider comes from. */
export interface ApplicationRoute {
  host: MissingApplicationsHost;
  catalog: Catalog;
  platformKey?: string;
}

export type ApplicationOperation = { ok: true; providerInstalled?: string } | { ok: false; detail: string; fix: string };

interface RecordedApplication {
  registration: { [key: string]: unknown };
  application: LoaderApplication & { provenance?: ApplicationProvenance };
}

function refusal(detail: string, fix: string): ApplicationOperation {
  return { ok: false, detail, fix };
}

function recordedApplication(runtime: Runtime, places: HostPlaces, loaderId: string): RecordedApplication | ApplicationOperation {
  const registration = runtime.registry.get({ places, id: loaderId }).registration;
  if (registration === undefined) return refusal(`no host is registered as ${loaderId}`, "name a registered loader");
  const application = registration.application as RecordedApplication["application"] | undefined;
  if (application === undefined) return refusal(`${loaderId} is not a loader of an application`, "name the loader of the application");
  return { registration, application };
}

/** @implNote A route that is `path` or missing was never an install method's to change, so forebay says where the application came from rather than guessing. */
function routeRefusal(application: RecordedApplication["application"], verb: string): ApplicationOperation | undefined {
  const { provenance } = application;
  if (provenance === undefined) return refusal(`how ${application.id} was installed is not recorded`, `${verb} ${application.id} with whatever installed it`);
  if (provenance.method === PATH_METHOD) return refusal(`${application.id} was found on this machine at ${provenance.location}, not installed through an install method`, `${verb} ${application.id} with whatever installed it`);
  if (provenance.package === undefined) return refusal(`the record of ${application.id} names method ${provenance.method} and no package`, `${verb} ${application.id} with whatever installed it`);
  return undefined;
}

async function refreshVersion(session: ProviderSession, runtime: Runtime, places: HostPlaces, recorded: RecordedApplication): Promise<void> {
  const { provenance } = recorded.application;
  if (provenance?.package === undefined || session.running === undefined) return;
  const detection = await detectRecorded(session.running, recorded.application.id, provenance.method, provenance.package, provenance.options);
  if (!("answer" in detection) || !detection.answer.installed || detection.answer.version === undefined) return;
  const application = { ...recorded.application, provenance: { ...provenance, version: detection.answer.version } };
  runtime.registry.register({ places, registration: { ...recorded.registration, application } as never });
}

async function throughRecordedMethod(runtime: Runtime, places: HostPlaces, loaderId: string, verb: "update" | "remove", route: ApplicationRoute): Promise<ApplicationOperation> {
  const recorded = recordedApplication(runtime, places, loaderId);
  if (!("application" in recorded)) return recorded;
  const refused = routeRefusal(recorded.application, verb);
  if (refused !== undefined) return refused;
  const provenance = recorded.application.provenance as ApplicationProvenance & { package: string };
  const report = emptyReport();
  const session: ProviderSession = { running: await route.host.start(), host: route.host, report };
  try {
    const missing = await ensureProvider(session, recorded.application, provenance.method, route.catalog, route.platformKey ?? currentPlatformKey());
    if (missing !== undefined) return refusal(missing.detail, missing.fix);
    const answer = await operate(runningOf(session), provenance.method, verb, provenance.package, provenance.options);
    if (!answer.ok) return answer;
    if (verb === "update") await refreshVersion(session, runtime, places, recorded);
    return report.installed.length > 0 ? { ok: true, providerInstalled: report.installed[0]?.id } : { ok: true };
  } finally {
    await session.running?.stop();
  }
}

export function updateApplicationThrough(runtime: Runtime, places: HostPlaces, loaderId: string, route: ApplicationRoute): Promise<ApplicationOperation> {
  return throughRecordedMethod(runtime, places, loaderId, "update", route);
}

export function removeApplicationThrough(runtime: Runtime, places: HostPlaces, loaderId: string, route: ApplicationRoute): Promise<ApplicationOperation> {
  return throughRecordedMethod(runtime, places, loaderId, "remove", route);
}
