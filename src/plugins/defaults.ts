import { readOffer, readRequirement } from "@weivel/typescript/engine";
import type { PluginManifest } from "@weivel/typescript";
import type { BundleSource } from "./bundle-source.js";
import { readManifestFileOrNull } from "./manifest-file.js";

interface ServiceDeclarations {
  provides: string[];
  needs: string[];
}

const NO_SERVICES: ServiceDeclarations = { provides: [], needs: [] };

/**
 * @implNote Read leniently: a manifest that does not validate declares nothing here, and the scan
 * quarantines it. An optional consume is no need, since the plugin runs without it.
 */
function declarationsOf(source: BundleSource, id: string): ServiceDeclarations {
  const located = source.locate(id);
  const manifest = located === null ? null : (readManifestFileOrNull(located.manifestPath) as Partial<PluginManifest> | null);
  const services = manifest?.services;
  if (typeof services !== "object" || services === null) return NO_SERVICES;
  try {
    return {
      provides: (services.provides ?? []).map((declaration) => readOffer(declaration).id),
      needs: (services.consumes ?? []).map(readRequirement).filter((requirement) => !requirement.optional).map((requirement) => requirement.id),
    };
  } catch {
    return NO_SERVICES;
  }
}

function cachedDeclarations(source: BundleSource): (id: string) => ServiceDeclarations {
  const read = new Map<string, ServiceDeclarations>();
  return (id) => {
    const cached = read.get(id) ?? declarationsOf(source, id);
    read.set(id, cached);
    return cached;
  };
}

function unprovided(chosen: readonly string[], declarations: (id: string) => ServiceDeclarations, consumes: readonly string[]): string[] {
  const declared = chosen.map(declarations);
  const provided = new Set(declared.flatMap((services) => services.provides));
  const needed = [...consumes, ...declared.flatMap((services) => services.needs)];
  return [...new Set(needed)].filter((service) => !provided.has(service));
}

function defaultFor(
  service: string,
  chosen: readonly string[],
  source: BundleSource,
  defaults: Record<string, string>,
  disabled: readonly string[],
): string | null {
  const provider = Object.hasOwn(defaults, service) ? defaults[service] : undefined;
  if (provider === undefined || chosen.includes(provider) || disabled.includes(provider)) return null;
  return source.locate(provider) === null ? null : provider;
}

/**
 * Adds the host's default provider for every service the host consumes, or a chosen plugin needs,
 * that no chosen plugin provides (spec 5.2.3). A plugin the settings explicitly disable is never
 * added, and the host's own `consumes` all count as needs.
 *
 * @implNote Repeats until nothing is added, because a default can itself need a service only
 * another default provides.
 */
export function withDefaults(
  enabled: string[],
  source: BundleSource,
  consumes: string[],
  defaults: Record<string, string>,
  disabled: string[],
): string[] {
  const declarations = cachedDeclarations(source);
  const chosen = [...enabled];
  let added = true;
  while (added) {
    added = false;
    for (const service of unprovided(chosen, declarations, consumes)) {
      const provider = defaultFor(service, chosen, source, defaults, disabled);
      if (provider === null) continue;
      chosen.push(provider);
      added = true;
    }
  }
  return chosen;
}
