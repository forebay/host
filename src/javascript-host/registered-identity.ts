import type { HostPlaces } from "../context/places.js";
import { HostRefusal, REINSTALL_FIX } from "../host-refusal.js";
import type { HostIdentity } from "../identity.js";
import { isRecord } from "../plugins/is-record.js";
import type { Runtime } from "../runtime/open.js";

/** The identity host `hostId`'s registration records, refused with the fix to install again when there is none. */
export function registeredIdentity(runtime: Pick<Runtime, "registry">, places: HostPlaces, hostId: string): HostIdentity {
  const registration = runtime.registry.get({ places, id: hostId }).registration;
  if (registration === undefined || typeof registration.version !== "string" || typeof registration.home !== "string") {
    throw new HostRefusal(`the host ${hostId} is not registered in ${places.state}`, REINSTALL_FIX);
  }
  return {
    id: hostId,
    version: registration.version,
    home: registration.home,
    requiresCommand: registration.requiresCommand === true,
    commands: [],
    ...(isRecord(registration.application) ? { application: registration.application } : {}),
  };
}
