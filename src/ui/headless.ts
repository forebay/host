import type { PluginManifest, UiComponent, UiNode, ViewDeclaration } from "@weivel/typescript";
import { checkUiData } from "@weivel/typescript/host";
import type { RunningHost } from "../start.js";
import { callBinding, deployedManifest, providesService } from "./bindings.js";
import { SETTINGS_VIEW_ID, settingsView } from "./settings-view.js";

export interface HeadlessNodeError {
  detail: string;
  fix: string;
  /** Where in the bound answer the fault is, as in `items[0].id`. */
  path?: string;
}

export interface HeadlessNode {
  id: string;
  component: UiComponent;
  parent?: string;
  state: "ready" | "error" | "unavailable";
  data?: unknown;
  error?: HeadlessNodeError;
  /** The node's known presentation members only; an unknown member a description carries never appears here. */
  props: Record<string, unknown>;
}

export interface HeadlessScreen {
  plugin: string;
  view: string;
  title: string;
  nodes: HeadlessNode[];
}

type Outcome = Pick<HeadlessNode, "state" | "data" | "error">;

const PROP_MEMBERS = ["size", "emphasis", "tone", "label", "text", "icon", "action", "field", "chart", "span"] as const;
const MEASURE_MEMBERS = ["value", "maximum"];
const SERIES_MEMBERS = ["series"];

function propsOf(node: UiNode): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const member of PROP_MEMBERS) {
    if (node[member] !== undefined) props[member] = node[member];
  }
  return props;
}

function viewOf(manifest: PluginManifest, viewId: string): ViewDeclaration {
  const declared = manifest.views?.[viewId];
  if (declared !== undefined) return declared;
  if (viewId === SETTINGS_VIEW_ID) return settingsView(manifest);
  throw new Error(`${manifest.id} declares no view ${viewId}`);
}

function manifestOf(running: RunningHost, plugin: string): PluginManifest {
  const manifest = deployedManifest(running, plugin);
  if (manifest === undefined) throw new Error(`${plugin} is not deployed in this host`);
  return manifest;
}

function failed(detail: string, fix: string, path?: string): Outcome {
  return { state: "error", error: path === undefined ? { detail, fix } : { detail, fix, path } };
}

/** @implNote The node's own `chart` picks the branch, never the answer, so one answer carrying both reads as the node declares. */
function chartData(node: UiNode, answer: Record<string, unknown>): Outcome {
  const members = node.chart === "meter" ? MEASURE_MEMBERS : SERIES_MEMBERS;
  const absent = members.find((member) => !(member in answer));
  if (absent !== undefined) {
    return failed(`a ${node.chart ?? "series"} chart reads ${members.join(" and ")}, and the answer has no ${absent}`, `answer ${members.join(" and ")} for this node`, absent);
  }
  return { state: "ready", data: Object.fromEntries(members.map((member) => [member, answer[member]])) };
}

function checked(node: UiNode, answer: unknown): Outcome {
  const issues = checkUiData(node.component, answer) ?? [];
  if (issues.length > 0) return failed(issues[0].message, issues[0].fix, issues[0].path);
  if (node.component === "chart") return chartData(node, answer as Record<string, unknown>);
  return { state: "ready", data: answer };
}

function isUnavailable(running: RunningHost, service: string, manifest: PluginManifest): boolean {
  return providesService(manifest, service) && running.loaded.host.service(service) === undefined;
}

async function outcomeOf(running: RunningHost, manifest: PluginManifest, node: UiNode): Promise<Outcome> {
  if (node.bind === undefined) return { state: "ready" };
  if (isUnavailable(running, node.bind.service, manifest)) return { state: "unavailable" };
  const answer = await callBinding(running, manifest.id, node.bind);
  return answer.ok ? checked(node, answer.value) : failed(answer.error.detail, answer.error.fix);
}

async function renderNode(running: RunningHost, manifest: PluginManifest, node: UiNode): Promise<HeadlessNode> {
  const outcome = await outcomeOf(running, manifest, node);
  return {
    id: node.id,
    component: node.component,
    ...(node.parent === undefined ? {} : { parent: node.parent }),
    ...outcome,
    props: propsOf(node),
  };
}

/**
 * Renders one of a plugin's views to plain data, calling every binding and checking each answer
 * against the model, for tests and for a host with no interactive UI.
 *
 * @implNote A failed, late or misshapen answer puts only its own node in `error`; the rest render
 * and the plugin is never quarantined, since one bad read says nothing about its services. A view
 * id the plugin does not declare resolves to its generated settings view when it is `settings`.
 */
export async function renderHeadless(running: RunningHost, plugin: string, viewId: string): Promise<HeadlessScreen> {
  const manifest = manifestOf(running, plugin);
  const view = viewOf(manifest, viewId);
  const nodes = await Promise.all(view.nodes.map((node) => renderNode(running, manifest, node)));
  return { plugin, view: viewId, title: view.title, nodes };
}
