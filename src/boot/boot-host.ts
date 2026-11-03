import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CacheRefusal } from "../cache/cache-refusal.js";
import { checkInstalled } from "../cache/install-marker.js";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { readBootHint } from "./boot-hint.js";

const HOST_ENTRY = "host.js";
const REINSTALL_FIX = "run forebay-host install --catalog <path or url> again";

/** What a host bundle that is started inside the application answers: how to stop it. */
export interface BootedSessionHost {
  stop(): Promise<void>;
}

interface InstalledHost {
  runHostCommandLine(argv: string[]): Promise<number>;
  runSessionHost(loaderId: string): Promise<BootedSessionHost>;
}

function hostDirectory(cache: string, hostId: string): string {
  const version = readBootHint(cache, hostId)?.host;
  if (version === undefined) throw new CacheRefusal(`no host version is recorded for ${hostId} in ${cache}`, REINSTALL_FIX);
  const directory = join(cache, "bundles", hostId, version);
  if (version === "" || !isStrictlyInside(join(cache, "bundles", hostId), directory)) throw new CacheRefusal(`the host version ${JSON.stringify(version)} recorded for ${hostId} is not a version`, REINSTALL_FIX);
  return directory;
}

function verifiedHostEntry(cache: string, hostId: string): string {
  const directory = hostDirectory(cache, hostId);
  const check = checkInstalled(directory);
  if (check.kind === "absent") throw new CacheRefusal(`${hostId} is not installed in ${directory}`, REINSTALL_FIX);
  if (check.kind === "damaged") throw new CacheRefusal(`${hostId} was not started: ${check.detail}`, REINSTALL_FIX);
  return join(directory, HOST_ENTRY);
}

function refusalOf(error: unknown): CacheRefusal {
  if (error instanceof CacheRefusal) return error;
  return new CacheRefusal((error as Error).message, REINSTALL_FIX);
}

async function importHost(cache: string, hostId: string): Promise<InstalledHost> {
  return (await import(pathToFileURL(verifiedHostEntry(cache, hostId)).href)) as InstalledHost;
}

/**
 * Runs the host bundle version `hostId`'s boot hint names, in `cache`, with the arguments after the
 * host id, and answers its exit code. A hint that is missing or unreadable, or a bundle whose files
 * no longer have their recorded hashes, is refused with the reinstall fix and the exit code 1;
 * no version is ever guessed.
 */
export async function bootHost(cache: string, argv: string[], printRefusal: (text: string) => void): Promise<number> {
  const [hostId, ...rest] = argv;
  let entry: string;
  try {
    if (hostId === undefined) throw new CacheRefusal("no host id was given", "pass the host id first: boot.js <host-id> <arguments>");
    entry = verifiedHostEntry(cache, hostId);
  } catch (error) {
    const refusal = refusalOf(error);
    printRefusal(`${refusal.detail}\nfix: ${refusal.fix}\n`);
    return 1;
  }
  const host = (await import(pathToFileURL(entry).href)) as InstalledHost;
  return host.runHostCommandLine(rest);
}

/**
 * Starts loader `loaderId`'s host in this process through the host bundle version `hostId`'s boot
 * hint names, in `cache`, for an application whose plugin entry lives for its whole session.
 *
 * @remarks A hint or bundle that would be refused by {@link bootHost} is refused here by throwing
 * the same {@link CacheRefusal}.
 */
export async function bootSessionHost(cache: string, hostId: string, loaderId: string): Promise<BootedSessionHost> {
  let host: InstalledHost;
  try {
    host = await importHost(cache, hostId);
  } catch (error) {
    throw refusalOf(error);
  }
  return host.runSessionHost(loaderId);
}
