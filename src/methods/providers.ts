import type { RunningHost } from "../start.js";
import { bindingTarget, deployedManifest, isActive, providesService } from "../ui/binding-target.js";

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

function ownServiceId(pluginId: string): string {
  return `${pluginId}:install-method`;
}

/**
 * The active plugins whose manifest names an `installMethod` and provides their own `<plugin>:install-method`, in load order.
 *
 * @implNote Only an active plugin can serve or shadow a method, so a quarantined first provider leaves the method to the next.
 * Each provider registers its own namespaced id because the engine gives a service id one holder.
 */
export function installMethodProviders(running: RunningHost): MethodProvider[] {
  const serving = new Map<string, string>();
  const providers: MethodProvider[] = [];
  for (const { manifest } of running.loaded.deployed) {
    const serviceId = ownServiceId(manifest.id);
    if (manifest.installMethod === undefined || !providesService(manifest, serviceId) || !isActive(running, manifest.id)) continue;
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
