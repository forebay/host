import { isRecord } from "./is-record.js";

export interface EnabledPlugin {
  id: string;
  pin?: string;
}

function choicesOf(settings: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const plugins = settings.plugins;
  if (!isRecord(plugins)) return [];
  return Object.keys(plugins)
    .sort()
    .flatMap((id) => {
      const choice = plugins[id];
      return isRecord(choice) ? [[id, choice] as [string, Record<string, unknown>]] : [];
    });
}

function pinOf(choice: Record<string, unknown>): string | undefined {
  return typeof choice.pin === "string" ? choice.pin : undefined;
}

/** The plugins `plugins.<id>.enabled` turns on in the merged ecosystem settings, ordered by id. */
export function enabledPlugins(settings: Record<string, unknown>): EnabledPlugin[] {
  return choicesOf(settings)
    .filter(([, choice]) => choice.enabled === true)
    .map(([id, choice]) => {
      const pin = pinOf(choice);
      return pin === undefined ? { id } : { id, pin };
    });
}

/** The plugins `plugins.<id>.enabled` explicitly turns off, which no host default may start, ordered by id. */
export function disabledPlugins(settings: Record<string, unknown>): string[] {
  return choicesOf(settings)
    .filter(([, choice]) => choice.enabled === false)
    .map(([id]) => id);
}

/** Every `plugins.<id>.pin`, enabled or not, since a host default must honour a pin too. */
export function pinnedVersions(settings: Record<string, unknown>): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const [id, choice] of choicesOf(settings)) {
    const pin = pinOf(choice);
    if (pin !== undefined) pins[id] = pin;
  }
  return pins;
}
