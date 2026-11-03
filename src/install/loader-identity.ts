import { resolve } from "node:path";
import type { HostIdentity } from "../identity.js";
import type { LoaderApplication, LoaderStandard } from "../loader/standard.js";
import { resolveApplicationHome } from "../loader/home.js";

export interface CommandTarget {
  target: string;
  arguments: string[];
}

export interface LoaderIdentityInput {
  id: string;
  version: string;
  application: LoaderApplication;
  pathCommands: LoaderStandard["pathCommands"];
  hostBundleFile: string;
  environment: Record<string, string>;
}

/**
 * What a loader's command runs: the host bundle currently running this install, started with
 * `launch <loader-id>`.
 *
 * @implNote Every command target goes through here, so changing where a loader's commands start is
 * a change to this one function.
 */
export function commandTarget(loaderId: string, hostBundleFile: string): CommandTarget {
  return { target: process.execPath, arguments: [resolve(hostBundleFile), "launch", loaderId] };
}

export function loaderIdentity(input: LoaderIdentityInput): HostIdentity {
  const { id, version, application, pathCommands, hostBundleFile, environment } = input;
  return {
    id,
    version,
    home: resolveApplicationHome(application.home, environment).home,
    application: { ...application },
    requiresCommand: pathCommands.minimum === 1,
    commands: pathCommands.requested.map((name) => ({ name, ...commandTarget(id, hostBundleFile) })),
  };
}
