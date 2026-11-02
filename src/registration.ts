import type { HostIdentity } from "./identity.js";
import type { HostPlaces } from "./context/places.js";
import type { Runtime } from "./runtime/open.js";
import { userHomeOf } from "./user-home.js";

export type Provenance = {
  method: string;
  version: string;
  location: string;
  os: string;
  architecture: string;
  installedAt: string;
};

export interface RegisteredHost {
  provenance: Provenance;
  commands: string[];
}

function storedProvenance(runtime: Runtime, places: HostPlaces, id: string): Provenance | undefined {
  return runtime.registry.get({ places, id }).registration?.provenance as Provenance | undefined;
}

/** The first start's provenance wins, so a later start never rewrites how the host was installed. */
function provenanceToRecord(runtime: Runtime, places: HostPlaces, id: string, given: Provenance): Provenance {
  return storedProvenance(runtime, places, id) ?? given;
}

function recordRegistration(runtime: Runtime, places: HostPlaces, identity: HostIdentity, provenance: Provenance): void {
  runtime.registry.register({
    places,
    registration: {
      id: identity.id,
      kind: "host",
      version: identity.version,
      home: identity.home,
      ...(identity.application ? { application: identity.application } : {}),
      provenance,
      requiresCommand: identity.requiresCommand,
    },
  });
}

function requestCommands(
  runtime: Runtime,
  places: HostPlaces,
  identity: HostIdentity,
  environment: Record<string, string>,
): string[] {
  const names: string[] = [];
  for (const command of identity.commands) {
    const answered = runtime.commands.request({
      places,
      environment,
      host: identity.id,
      home: userHomeOf(environment),
      name: command.name,
      target: command.target,
    });
    if (answered.name !== undefined) names.push(answered.name);
  }
  return names;
}

/**
 * @implNote Known limit: the first-start-wins provenance is a read followed by a write, so two
 * concurrent first starts of one host can each see no registration and the last write wins.
 * An environment without a user home is refused before anything is registered.
 */
export function registerHost(
  runtime: Runtime,
  places: HostPlaces,
  identity: HostIdentity,
  provenance: Provenance,
  environment: Record<string, string>,
): RegisteredHost {
  if (identity.commands.length > 0) userHomeOf(environment);
  const recorded = provenanceToRecord(runtime, places, identity.id, provenance);
  recordRegistration(runtime, places, identity, recorded);
  return { provenance: recorded, commands: requestCommands(runtime, places, identity, environment) };
}
