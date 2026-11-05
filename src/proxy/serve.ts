import { createServer } from "node:http";
import type { Server } from "node:http";
import type { LoadedHost } from "@weivel/typescript/host";
import type { FrontDoor, Profile, Provider } from "../contracts/index.js";
import type { ForebayLibrary } from "../forebay-library/open.js";
import type { ModelMap } from "../forebay-library/types.js";
import { isRecord } from "../plugins/is-record.js";
import { contractChecks } from "./contracts.js";
import type { ContractChecks } from "./contracts.js";
import { FRONT_DOOR_CAPABILITY, frontDoorCalls } from "./front-door.js";
import type { FrontDoorCalls } from "./front-door.js";
import { handleRequest } from "./handle-request.js";
import type { ProxyLog, ProxyState, RoutingSnapshot } from "./handle-request.js";
import { providerModels } from "./models.js";
import { PROVIDER_CAPABILITY, providerCalls } from "./providers.js";
import type { ProviderCalls } from "./providers.js";
import type { ReadyPublisher } from "./publish.js";

export const DEFAULT_PROXY_PORT = 34567;

const LOOPBACK = "127.0.0.1";
const MODELS_REFRESH_MILLISECONDS = 60 * 60 * 1000;

/** What the session host serves its proxy from. */
export interface ProxySession {
  hostId: string;
  loaded: LoadedHost;
  /** The session host's own settings, merged across its layers. */
  settings: Record<string, unknown>;
  library: Pick<ForebayLibrary, "routing" | "contractsDirectory">;
  publisher: ReadyPublisher;
  /** The environment the application would start with, and the user's home, which `routing.environment` reads. */
  environment: Record<string, string>;
  userHome: string;
  log: ProxyLog;
}

export interface ProxyServer {
  /** The port the proxy listens on, absent when it serves nothing. */
  port?: number;
  stop(): Promise<void>;
}

/** A refusal the session host publishes instead of an environment. */
class ProxyRefusal extends Error {
  constructor(
    readonly refused: string,
    readonly fix: string,
  ) {
    super(refused);
  }
}

const IDLE: ProxyServer = { stop: async () => undefined };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nested(settings: Record<string, unknown>, group: string, key: string): unknown {
  const values = settings[group];
  return isRecord(values) ? values[key] : undefined;
}

function proxyPort(session: ProxySession): number {
  const port = nested(session.settings, "proxy", "port") ?? DEFAULT_PROXY_PORT;
  if (typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  throw new ProxyRefusal(`proxy.port is ${JSON.stringify(port)}, which is no port`, `set proxy.port in the settings of ${session.hostId} to a port from 1 to 65535`);
}

/** @implNote Only a plugin whose manifest validated can be seen declaring the capability; one whose manifest did not is refused at start like any other. */
function refusalOfStoppedFrontDoor(session: ProxySession): ProxyRefusal | undefined {
  const declared = session.loaded.deployed.find(({ manifest }) => manifest.capabilities?.includes(FRONT_DOOR_CAPABILITY) === true && !session.loaded.started.includes(manifest.id));
  if (declared === undefined) return undefined;
  const id = declared.manifest.id;
  const cause = session.loaded.quarantined.find((error) => error.pluginId === id);
  const detail = cause === undefined ? "it is not running" : cause.detail;
  return new ProxyRefusal(`the front door ${id} is enabled but did not start: ${detail}`, cause === undefined ? `fix or disable ${id}` : `${cause.fix} (plugin ${id})`);
}

function onlyFrontDoor(session: ProxySession): { pluginId: string; implementation: FrontDoor } | undefined {
  const stopped = refusalOfStoppedFrontDoor(session);
  if (stopped !== undefined) throw stopped;
  const records = session.loaded.host.capability(FRONT_DOOR_CAPABILITY);
  if (records.length > 1) {
    const ids = records.map((record) => record.pluginId).join(", ");
    throw new ProxyRefusal(`${ids} each provide a ${FRONT_DOOR_CAPABILITY}, and a session host serves one`, `disable all but one of ${ids}`);
  }
  const record = records[0];
  return record === undefined ? undefined : { pluginId: record.pluginId, implementation: record.implementation as FrontDoor };
}

function providersOf(session: ProxySession, checks: ContractChecks): Map<string, ProviderCalls> {
  const records = session.loaded.host.capability(PROVIDER_CAPABILITY);
  return new Map(records.map((record) => [record.pluginId, providerCalls(record.pluginId, record.implementation as Provider, checks, session.loaded.scheduler)]));
}

async function profileOf(frontDoor: FrontDoorCalls): Promise<Profile> {
  try {
    return await frontDoor.profile();
  } catch (error) {
    throw new ProxyRefusal(`the front door ${frontDoor.pluginId} answered no usable profile: ${messageOf(error)}`, `fix or disable ${frontDoor.pluginId}`);
  }
}

function storedMap(session: ProxySession): Record<string, unknown> {
  const stored = nested(session.settings, "routing", "modelMap");
  return stored === undefined ? {} : { modelMap: stored };
}

async function snapshotOf(session: ProxySession, profile: Profile, providers: Map<string, ProviderCalls>): Promise<RoutingSnapshot> {
  const { argument, answers } = await providerModels(providers.values(), (id, error) => session.log.warn(`${id} answered no models: ${messageOf(error)}`));
  const derived = session.library.routing.modelMap({ profile, stored: storedMap(session), models: argument });
  if (derived.refused !== undefined) throw new ProxyRefusal(derived.refused, derived.fix ?? `correct routing.modelMap in the settings of ${session.hostId}`);
  return { models: argument, answers, map: derived.map ?? ({} as ModelMap) };
}

function listening(server: Server, port: number, hostId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      const cause = error.code === "EADDRINUSE" ? "is already in use" : `cannot be listened on (${error.message})`;
      reject(new ProxyRefusal(`port ${port} on ${LOOPBACK} ${cause}, so the proxy of ${hostId} cannot listen`, `stop what listens on port ${port}, or set proxy.port in the settings of ${hostId} to a free port`));
    });
    server.listen(port, LOOPBACK, () => resolve());
  });
}

function stopperOf(server: Server, timer: NodeJS.Timeout): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () =>
    (stopping ??= new Promise((resolve) => {
      clearInterval(timer);
      server.close(() => resolve());
      server.closeAllConnections();
    }));
}

/** @implNote A refresh that fails keeps the snapshot it had, so a provider briefly unreachable does not empty the map. */
function refreshEveryHour(session: ProxySession, profile: Profile, providers: Map<string, ProviderCalls>, holder: { snapshot: RoutingSnapshot }): NodeJS.Timeout {
  const timer = setInterval(() => {
    snapshotOf(session, profile, providers).then(
      (snapshot) => (holder.snapshot = snapshot),
      (error: unknown) => session.log.warn(`the models could not be refreshed: ${messageOf(error)}`),
    );
  }, MODELS_REFRESH_MILLISECONDS);
  timer.unref();
  return timer;
}

async function served(session: ProxySession, front: { pluginId: string; implementation: FrontDoor }): Promise<ProxyServer> {
  const checks = contractChecks(session.library.contractsDirectory);
  const frontDoor = frontDoorCalls(front.pluginId, front.implementation, checks, session.loaded.scheduler);
  const providers = providersOf(session, checks);
  const port = proxyPort(session);
  const profile = await profileOf(frontDoor);
  const holder = { snapshot: await snapshotOf(session, profile, providers) };
  const state: ProxyState = {
    port,
    frontDoor,
    providers,
    routing: session.library.routing,
    profile,
    checks,
    snapshot: () => holder.snapshot,
    log: session.log,
    now: () => Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const server = createServer((request, response) => void handleRequest(state, request, response));
  await listening(server, port, session.hostId);
  try {
    const { environment } = session.library.routing.environment({ profile, map: holder.snapshot.map, port, providersEnabled: providers.size > 0, environment: session.environment, userHome: session.userHome });
    session.publisher.environment(environment);
  } catch (error) {
    server.close();
    throw error;
  }
  return { port, stop: stopperOf(server, refreshEveryHour(session, profile, providers, holder)) };
}

/**
 * Serves the one enabled front door on `127.0.0.1:<proxy.port>` and publishes the environment the
 * application starts with; with no front door enabled it publishes an empty environment. Whatever
 * stops it serving is published as a refusal instead, so `launch` never waits on a host that has
 * nothing to publish.
 */
export async function serveProxy(session: ProxySession): Promise<ProxyServer> {
  try {
    const front = onlyFrontDoor(session);
    if (front !== undefined) return await served(session, front);
    session.publisher.environment({});
  } catch (error) {
    const refusal = error instanceof ProxyRefusal ? error : new ProxyRefusal(`the proxy of ${session.hostId} could not start: ${messageOf(error)}`, "run forebay-host install again");
    session.log.warn(`${refusal.refused}; fix: ${refusal.fix}`);
    session.publisher.refusal(refusal.refused, refusal.fix);
  }
  return IDLE;
}
