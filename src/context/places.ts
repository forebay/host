import type { PlacesService } from "../runtime/types.js";

/** The `places.resolve` answer, passed on to every service that needs a place. */
export type HostPlaces = ReturnType<PlacesService["resolve"]>;
