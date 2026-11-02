import type { PluginManifest, UiNode, ViewDeclaration } from "@weivel/typescript";

const FORM_NODE_ID = "settingsForm";

export const SETTINGS_TITLE = "Settings";

/** The id a host lists and renders a plugin's generated settings view under. */
export const SETTINGS_VIEW_ID = "settings";

/** @implNote Field ids are positional because a setting key may hold characters a node id refuses, such as a dot. */
function fieldNode(key: string, label: string, index: number): UiNode {
  return { id: `settingsField${index}`, parent: FORM_NODE_ID, component: "field", field: key, label };
}

/**
 * Generates the view that edits a plugin's settings: one `form` node holding one `field` node per
 * setting, in key order, so settings render through the same path as any declared view.
 */
export function settingsView(manifest: PluginManifest): ViewDeclaration {
  const settings = manifest.settings ?? {};
  const fields = Object.keys(settings)
    .sort()
    .map((key, index) => fieldNode(key, settings[key].label, index));
  return { title: SETTINGS_TITLE, nodes: [{ id: FORM_NODE_ID, component: "form" }, ...fields] };
}
