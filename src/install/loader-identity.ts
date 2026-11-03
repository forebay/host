import { bootEntryFile } from "../boot/boot-install.js";
import type { HostIdentity } from "../identity.js";
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
  cache: string;
  environment: Record<string, string>;
}

/**
 * What a loader's command runs: the versionless boot entry of the cache, which starts whichever
 * host bundle version the boot hint names, with `launch <loader-id>`.
 *
 * @implNote Every command target goes through here, so changing where a loader's commands start is
 * a change to this one function. The target names no version of anything a sweep can delete: the
 * executable is the JavaScript runtime that is running this host, and the entry is the same path
 * for every version.
 */
export function commandTarget(cache: string, loaderId: string): CommandTarget {
  return { target: process.execPath, arguments: [bootEntryFile(cache), FOREBAY_HOST_ID, "launch", loaderId] };
}

export function loaderIdentity(input: LoaderIdentityInput): HostIdentity {
  const { id, version, application, pathCommands, cache, environment } = input;
  return {
    id,
    version,
    home: resolveApplicationHome(application.home, environment).home,
    application: { ...application },
    requiresCommand: pathCommands.minimum === 1,
    commands: pathCommands.requested.map((name) => ({ name, ...commandTarget(cache, id) })),
  };
}
