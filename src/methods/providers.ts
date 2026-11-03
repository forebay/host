import type { RunningHost } from "../start.js";
import { bindingTarget, deployedManifest } from "../ui/binding-target.js";

const SERVICE_SUFFIX = "install-method";

export interface MethodProvider {
  method: string;
  plugin: string;
  serviceId: string;
  /** Set when an earlier provider already serves this method. */
  shadowedBy?: string;
}

export type ProviderImplementation =
  | { ok: true; implementation: Record<string, unknown> }
  | { ok: false; detail: string };

function isInstallMethodService(serviceId: string): boolean {
  return serviceId === SERVICE_SUFFIX || serviceId.endsWith(`:${SERVICE_SUFFIX}`);
}

function serviceIdOf(provides: readonly (string | { id: string })[]): string | undefined {
  return provides.map((offer) => (typeof offer === "string" ? offer : offer.id)).find(isInstallMethodService);
}

/**
 * The deployed plugins whose manifest names an `installMethod`, in load order.
 *
 * @implNote A service id has one holder in the engine, so each provider registers its own namespaced
 * `<plugin>:install-method`, and the first provider of a method in load order serves it.
 */
export function installMethodProviders(running: RunningHost): MethodProvider[] {
  const serving = new Map<string, string>();
  const providers: MethodProvider[] = [];
  for (const { manifest } of running.loaded.deployed) {
    const serviceId = serviceIdOf(manifest.services?.provides ?? []);
    if (manifest.installMethod === undefined || serviceId === undefined) continue;
    const winner = serving.get(manifest.installMethod);
    if (winner === undefined) serving.set(manifest.installMethod, manifest.id);
    providers.push({ method: manifest.installMethod, plugin: manifest.id, serviceId, ...(winner === undefined ? {} : { shadowedBy: winner }) });
  }
  return providers;
}

export function implementationOf(running: RunningHost, provider: MethodProvider): ProviderImplementation {
  if (deployedManifest(running, provider.plugin) === undefined) return { ok: false, detail: `${provider.plugin} is not deployed` };
  const target = bindingTarget(running, provider.plugin, provider.serviceId);
  if (target.state !== "callable") return { ok: false, detail: target.error.message };
  return { ok: true, implementation: target.implementation };
}
