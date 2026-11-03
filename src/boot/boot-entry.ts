#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRunDirectly } from "../cli/command-line.js";
import { bootHost, bootSessionHost } from "./boot-host.js";
import type { BootedSessionHost } from "./boot-host.js";

const cache = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Starts loader `loaderId`'s host in this process through host `hostId`, the way an application's session-long plugin entry imports this entry. */
export function runSessionHost(hostId: string, loaderId: string): Promise<BootedSessionHost> {
  return bootSessionHost(cache, hostId, loaderId);
}

if (isRunDirectly(import.meta.url)) process.exitCode = await bootHost(cache, process.argv.slice(2), (text) => process.stderr.write(text));
