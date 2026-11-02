import type { PluginManifest, UiComponent, UiNode, ViewDeclaration } from "@weivel/typescript";
import { checkUiData } from "@weivel/typescript/host";
import type { RunningHost } from "../start.js";
import { bindingTarget, deployedManifest } from "./binding-target.js";
import { callBinding } from "./bindings.js";
import type { NavigationEntry } from "./navigation.js";
import { settingsView } from "./settings-view.js";

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
  kind: "view" | "settings";
  /** The declared view id; absent for the generated settings screen, which is addressed by its kind. */
  view?: string;
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

function declaredView(manifest: PluginManifest, viewId: string): ViewDeclaration {
  const declared = manifest.views?.[viewId];
  if (declared === undefined) throw new Error(`${manifest.id} declares no view ${viewId}`);
  return declared;
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

async function outcomeOf(running: RunningHost, manifest: PluginManifest, node: UiNode): Promise<Outcome> {
  if (node.bind === undefined) return { state: "ready" };
  const target = bindingTarget(running, manifest.id, node.bind.service);
  if (target.state === "unavailable") return { state: "unavailable" };
  if (target.state === "refused") return failed(target.error.detail, target.error.fix);
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

async function renderNodes(running: RunningHost, manifest: PluginManifest, view: ViewDeclaration): Promise<HeadlessNode[]> {
  return Promise.all(view.nodes.map((node) => renderNode(running, manifest, node)));
}

/**
 * Renders one of a plugin's declared views to plain data, calling every binding and checking each
 * answer against the model, for tests and for a host with no interactive UI.
 *
 * @implNote A failed, late or misshapen answer puts only its own node in `error`; the rest render
 * and the plugin is never quarantined, since one bad read says nothing about its services.
 */
export async function renderHeadless(running: RunningHost, plugin: string, viewId: string): Promise<HeadlessScreen> {
  const manifest = manifestOf(running, plugin);
  const view = declaredView(manifest, viewId);
  return { plugin, kind: "view", view: viewId, title: view.title, nodes: await renderNodes(running, manifest, view) };
}

/** Renders a plugin's generated settings screen through the same path as a declared view. */
export async function renderHeadlessSettings(running: RunningHost, plugin: string): Promise<HeadlessScreen> {
  const manifest = manifestOf(running, plugin);
  const view = settingsView(manifest);
  return { plugin, kind: "settings", title: view.title, nodes: await renderNodes(running, manifest, view) };
}

/** Renders the screen a navigation entry opens, routed by its kind; an action opens no screen. */
export function renderEntry(running: RunningHost, entry: NavigationEntry): Promise<HeadlessScreen> {
  if (entry.kind === "view") return renderHeadless(running, entry.plugin, entry.id);
  if (entry.kind === "settings") return renderHeadlessSettings(running, entry.plugin);
  return Promise.reject(new Error(`${entry.plugin} action ${entry.id} is run, not rendered`));
}
