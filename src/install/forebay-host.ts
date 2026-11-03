import { join } from "node:path";
import type { HostPlaces } from "../context/places.js";
import type { HostIdentity } from "../identity.js";

/** The id the standalone host runs and records its references under. */
export const FOREBAY_HOST_ID = "forebay-host";

/**
 * The standalone host's home, in the state place, the only place this host owns.
 *
 * @implNote Until each application's loader gives it a host identity of its own, the standalone
 * host is the one host, so its home is not any application's.
 */
export function forebayHostHome(places: HostPlaces): string {
  return join(places.state, "home", FOREBAY_HOST_ID);
}

/** @implNote No commands: the standalone host writes nothing onto the PATH. */
export function forebayHostIdentity(places: HostPlaces, version: string): HostIdentity {
  return { id: FOREBAY_HOST_ID, version, home: forebayHostHome(places), requiresCommand: false, commands: [] };
}
