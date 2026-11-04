import { bootExecutable } from "../boot/boot-executable.js";
import { bootEntryFile } from "../boot/boot-install.js";
import type { HostPlaces } from "../context/places.js";
import type { HostIdentity } from "../identity.js";
import type { Runtime } from "../runtime/open.js";
import { provenanceOf, storedApplicationProvenance } from "./application-provenance.js";
import type { ApplicationProvenance } from "./application-provenance.js";
import type { ApplicationOrigin } from "./install-report.js";
import type { LoaderApplication, LoaderStandard } from "../loader/standard.js";
import { resolveApplicationHome } from "../loader/home.js";
import { FOREBAY_HOST_ID } from "./forebay-host.js";

export interface CommandTarget {
  target: string;
  arguments: string[];
}

export interface LoaderIdentityInput {
  id: string;
  version: string;
  application: LoaderApplication;
  pathCommands: LoaderStandard["pathCommands"];
  places: HostPlaces;
  environment: Record<string, string>;
  /** How install found or installed the application; only a loader with no recorded provenance takes it. */
  origin?: ApplicationOrigin;
}

/**
 * What a loader's command runs: the versionless boot entry of the cache, which starts whichever
 * host bundle version the boot hint names, with `launch <loader-id>`.
 *
 * @implNote Every command target goes through here, so changing where a loader's commands start is
 * a change to this one function. The target names no version of anything a sweep can delete: the
 * executable is the JavaScript runtime install recorded, and the entry is the same path
 * for every version.
 */
export function commandTarget(cache: string, loaderId: string): CommandTarget {
  return { target: bootExecutable(cache), arguments: [bootEntryFile(cache), FOREBAY_HOST_ID, "launch", loaderId] };
}

/** @implNote The first record wins, so a later install never rewrites how the application was first found or installed. */
function provenanceToRecord(runtime: Runtime, input: LoaderIdentityInput, home: string): ApplicationProvenance | undefined {
  const stored = storedApplicationProvenance(runtime, input.places, input.id);
  if (stored !== undefined || input.origin === undefined) return stored;
  return provenanceOf({ origin: input.origin, application: input.application, home, environment: input.environment, now: new Date() });
}

/**
 * The identity loader `input.id` registers with, from install and from every start (launch, the
 * session host, the hook), its application carrying the provenance already recorded, or, when none
 * is, the one `input.origin` gives.
 *
 * @implNote `registry.register` replaces the registration's `application` whole, so an identity
 * built without the stored provenance would erase it, and with it every later update or remove of
 * the application through its install method.
 */
export function loaderIdentity(runtime: Runtime, input: LoaderIdentityInput): HostIdentity {
  const { id, version, application, pathCommands, places, environment } = input;
  const home = resolveApplicationHome(application.home, environment).home;
  const provenance = provenanceToRecord(runtime, input, home);
  return {
    id,
    version,
    home,
    application: provenance === undefined ? { ...application } : { ...application, provenance },
    requiresCommand: pathCommands.minimum === 1,
    commands: pathCommands.requested.map((name) => ({ name, ...commandTarget(places.cache, id) })),
  };
}
