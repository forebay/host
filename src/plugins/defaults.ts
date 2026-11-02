import { readOffer, readRequirement } from "@weivel/typescript/engine";
import type { PluginManifest } from "@weivel/typescript";
import type { BundleSource } from "./bundle-source.js";
import { readManifestFileOrNull } from "./manifest-file.js";

interface ServiceDeclarations {
  provides: string[];
  consumes: string[];
}

const NO_SERVICES: ServiceDeclarations = { provides: [], consumes: [] };

/** @implNote Read leniently: a manifest that does not validate declares nothing here, and the scan quarantines it. */
function servicesOf(source: BundleSource, id: string): ServiceDeclarations {
  const located = source.locate(id);
  const manifest = located === null ? null : (readManifestFileOrNull(located.manifestPath) as Partial<PluginManifest> | null);
  const services = manifest?.services;
  if (typeof services !== "object" || services === null) return NO_SERVICES;
  try {
    return {
      provides: (services.provides ?? []).map((declaration) => readOffer(declaration).id),
      consumes: (services.consumes ?? []).map((declaration) => readRequirement(declaration).id),
    };
  } catch {
    return NO_SERVICES;
  }
}

function unprovided(chosen: readonly string[], source: BundleSource, consumes: readonly string[]): string[] {
  const declared = chosen.map((id) => servicesOf(source, id));
  const provided = new Set(declared.flatMap((services) => services.provides));
  const wanted = [...consumes, ...declared.flatMap((services) => services.consumes)];
  return [...new Set(wanted)].filter((service) => !provided.has(service));
}

function defaultFor(service: string, chosen: readonly string[], source: BundleSource, defaults: Record<string, string>): string | null {
  const provider = Object.hasOwn(defaults, service) ? defaults[service] : undefined;
  if (provider === undefined || chosen.includes(provider) || source.locate(provider) === null) return null;
  return provider;
}

/**
 * Adds the host's default provider for every service the host or a chosen plugin consumes and no
 * chosen plugin provides (spec 5.2.3).
 *
 * @implNote Repeats until nothing is added, because a default can itself consume a service only
 * another default provides.
 */
export function withDefaults(
  enabled: string[],
  source: BundleSource,
  consumes: string[],
  defaults: Record<string, string>,
): string[] {
  const chosen = [...enabled];
  let added = true;
  while (added) {
    added = false;
    for (const service of unprovided(chosen, source, consumes)) {
      const provider = defaultFor(service, chosen, source, defaults);
      if (provider === null) continue;
      chosen.push(provider);
      added = true;
    }
  }
  return chosen;
}
