export interface EnabledPlugin {
  id: string;
  pin?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enabledEntry(id: string, choice: unknown): EnabledPlugin[] {
  if (!isRecord(choice) || choice.enabled !== true) return [];
  return [typeof choice.pin === "string" ? { id, pin: choice.pin } : { id }];
}

/** The plugins `plugins.<id>.enabled` turns on in the merged ecosystem settings, ordered by id. */
export function enabledPlugins(settings: Record<string, unknown>): EnabledPlugin[] {
  const plugins = settings.plugins;
  if (!isRecord(plugins)) return [];
  return Object.keys(plugins)
    .sort()
    .flatMap((id) => enabledEntry(id, plugins[id]));
}
