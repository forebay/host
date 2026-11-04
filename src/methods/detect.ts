import type { InstallMethodDetectAnswer } from "@weivel/typescript/host";
import type { RunningHost } from "../start.js";
import { askProvider } from "./ask.js";
import type { MethodDetection } from "./detection.js";
import { installMethodProviders } from "./providers.js";
import type { MethodProvider } from "./providers.js";

interface MappedPackage {
  name: string;
  options?: object;
}

function mappedPackage(entry: unknown): MappedPackage | undefined {
  if (typeof entry === "string") return { name: entry };
  if (typeof entry !== "object" || entry === null) return undefined;
  const { name, options } = entry as { name?: unknown; options?: unknown };
  if (typeof name !== "string") return undefined;
  return typeof options === "object" && options !== null ? { name, options } : { name };
}

async function detectOne(running: RunningHost, item: string, provider: MethodProvider, mapped: MappedPackage): Promise<MethodDetection> {
  const request = { package: mapped.name, ...(mapped.options === undefined ? {} : { options: mapped.options }) };
  const asked = await askProvider<InstallMethodDetectAnswer>(running, provider, "detect", request);
  if (!asked.ok) return { method: provider.method, item, refused: asked.refused };
  return { method: provider.method, item, package: mapped.name, ...(mapped.options === undefined ? {} : { options: mapped.options }), answer: asked.answer };
}

function shadowedDetection(item: string, provider: MethodProvider): MethodDetection {
  return { method: provider.method, item, refused: `${provider.plugin} is shadowed by ${provider.shadowedBy}, which serves ${provider.method} first` };
}

/**
 * Asks every installed provider whose method the item has a package under, and answers one detection per provider.
 *
 * @implNote The mapping is `runtime.install.packages`: the user's `<portable>/packages.json` over the item's own.
 */
export async function detectThroughMethods(running: RunningHost, item: string, manifestPackages: { [key: string]: unknown } = {}): Promise<MethodDetection[]> {
  const { packages } = running.runtime.install.packages({ places: running.places, item, manifestPackages });
  const detections = installMethodProviders(running).map(async (provider) => {
    const mapped = mappedPackage(packages[provider.method]);
    if (mapped === undefined) return undefined;
    return provider.shadowedBy === undefined ? detectOne(running, item, provider, mapped) : shadowedDetection(item, provider);
  });
  return (await Promise.all(detections)).filter((detection): detection is MethodDetection => detection !== undefined);
}

/** Asks the provider serving `method` about exactly the package an install recorded, whatever the mapping says now. */
export async function detectRecorded(running: RunningHost, item: string, method: string, packageName: string, options?: object): Promise<MethodDetection> {
  const provider = installMethodProviders(running).find((candidate) => candidate.method === method && candidate.shadowedBy === undefined);
  if (provider === undefined) return { method, item, refused: `no installed plugin provides the ${method} install method` };
  return detectOne(running, item, provider, { name: packageName, ...(options === undefined ? {} : { options }) });
}
