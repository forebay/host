import type { Catalog, CatalogItem } from "../catalog/catalog.js";
import type { LoaderApplication } from "../loader/standard.js";
import { installMethodProviders } from "../methods/providers.js";
import type { RunningHost } from "../start.js";
import type { ApplicationReport } from "./install-report.js";

export type MethodRefusal = NonNullable<ApplicationReport["unavailable"]>[number];

/** The catalog entry an install planner matches a provider by. */
export interface CatalogProvider {
  id: string;
  kind: "plugin";
  installMethod: string;
}

export interface ApplicationOffer {
  offered: string[];
  unavailable: MethodRefusal[];
}

export function applicationsOf(catalog: Catalog): LoaderApplication[] {
  return Object.values(catalog.items).flatMap((item) => (item.kind === "host" && item.application ? [item.application] : []));
}

function hasBundleFor(item: CatalogItem, platformKey: string): boolean {
  const version = item.versions[item.latest];
  return version !== undefined && (version.files !== undefined || version.platforms?.[platformKey] !== undefined);
}

export function catalogProviders(catalog: Catalog, platformKey: string): CatalogProvider[] {
  return Object.entries(catalog.items).flatMap(([id, item]) =>
    item.kind === "plugin" && item.installMethod !== undefined && hasBundleFor(item, platformKey) ? [{ id, kind: "plugin" as const, installMethod: item.installMethod }] : [],
  );
}

export function activeMethods(running: RunningHost): string[] {
  return installMethodProviders(running).filter((provider) => provider.shadowedBy === undefined).map((provider) => provider.method);
}

function noProvider(method: string, platformKey: string): MethodRefusal {
  return {
    method,
    detail: `no installed plugin and no catalog plugin for ${platformKey} provides the ${method} install method`,
    fix: `add a catalog source that lists a plugin whose installMethod is ${method}, or choose another method`,
  };
}

/**
 * The methods an application can be installed through here, in the order its merged package mapping
 * gives them, and the methods it names that nothing provides.
 *
 * @implNote `marketplace` is left out: the planner accepts it for any item, but it installs a plugin
 * from a marketplace and no install-method provider can carry it out for an application.
 */
export function offerFor(running: RunningHost, application: LoaderApplication, providers: CatalogProvider[], platformKey: string): ApplicationOffer {
  const { packages } = running.runtime.install.packages({ places: running.places, item: application.id, manifestPackages: application.packages });
  const active = new Set(activeMethods(running));
  const methods = Object.keys(packages);
  const provided = (method: string): boolean => active.has(method) || providers.some((provider) => provider.installMethod === method);
  return { offered: methods.filter(provided), unavailable: methods.filter((method) => !provided(method)).map((method) => noProvider(method, platformKey)) };
}
