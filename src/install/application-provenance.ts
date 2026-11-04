import { findOnPath } from "../loader/on-path.js";
import type { LoaderApplication } from "../loader/standard.js";
import type { Provenance } from "../registration.js";
import type { Runtime } from "../runtime/open.js";
import type { HostPlaces } from "../context/places.js";
import type { ApplicationOrigin } from "./install-report.js";

/** A host's provenance shape, plus the package under the method; a binary found on PATH carries no package and may carry no version. */
export type ApplicationProvenance = Omit<Provenance, "version"> & { version?: string; package?: string; options?: object };

export interface ProvenanceInput {
  origin: ApplicationOrigin;
  application: LoaderApplication;
  home: string;
  environment: Record<string, string>;
  now: Date;
}

export function storedApplicationProvenance(runtime: Runtime, places: HostPlaces, loaderId: string): ApplicationProvenance | undefined {
  const application = runtime.registry.get({ places, id: loaderId }).registration?.application as { provenance?: ApplicationProvenance } | undefined;
  return application?.provenance;
}

/** @implNote The location is the binary on PATH when there is one, else the application's home, since a provider reports no path. */
export function provenanceOf(input: ProvenanceInput): ApplicationProvenance {
  const { origin, application, home, environment, now } = input;
  return {
    method: origin.method,
    ...(origin.package === undefined ? {} : { package: origin.package }),
    ...(origin.options === undefined ? {} : { options: origin.options }),
    ...(origin.version === undefined ? {} : { version: origin.version }),
    location: findOnPath(application.binary, environment) ?? home,
    os: process.platform,
    architecture: process.arch,
    installedAt: now.toISOString(),
  };
}
