import { isPluginError } from "@weivel/typescript/engine";
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

export interface RefusedCommand {
  name: string;
  detail: string;
  fix: string;
}

export interface RegisteredHost {
  provenance: Provenance;
  commands: string[];
  /** Commands the runtime refused for a host that does not require one; a host that does fails to start instead. */
  refusedCommands: RefusedCommand[];
}

type Requested = { name: string } | { refused: RefusedCommand };

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

/** @implNote Only the runtime's refusal is recorded, and only for a host that can run without a command; anything else still throws. */
function requestCommand(
  runtime: Runtime,
  places: HostPlaces,
  identity: HostIdentity,
  environment: Record<string, string>,
  command: { name: string; target: string },
): Requested | undefined {
  try {
    const answered = runtime.commands.request({
      places,
      environment,
      host: identity.id,
      home: userHomeOf(environment),
      name: command.name,
      target: command.target,
    });
    return answered.name === undefined ? undefined : { name: answered.name };
  } catch (error) {
    if (identity.requiresCommand || !isPluginError(error)) throw error;
    return { refused: { name: command.name, detail: error.detail, fix: error.fix } };
  }
}

function requestCommands(
  runtime: Runtime,
  places: HostPlaces,
  identity: HostIdentity,
  environment: Record<string, string>,
): Pick<RegisteredHost, "commands" | "refusedCommands"> {
  const requested = identity.commands.map((command) => requestCommand(runtime, places, identity, environment, command));
  return {
    commands: requested.flatMap((outcome) => (outcome !== undefined && "name" in outcome ? [outcome.name] : [])),
    refusedCommands: requested.flatMap((outcome) => (outcome !== undefined && "refused" in outcome ? [outcome.refused] : [])),
  };
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
  return { provenance: recorded, ...requestCommands(runtime, places, identity, environment) };
}
