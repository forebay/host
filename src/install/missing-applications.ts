import { currentPlatformKey } from "@weivel/typescript/host";
import type { AskQuestion } from "../cli/terminal-question.js";
import type { Catalog } from "../catalog/catalog.js";
import type { LoaderApplication } from "../loader/standard.js";
import { applicationList } from "../lists.js";
import { detectThroughMethods } from "../methods/detect.js";
import { operate } from "../methods/operate.js";
import type { RunningHost } from "../start.js";
import { activeMethods, applicationsOf, catalogProviders, offerFor } from "./application-offers.js";
import type { ApplicationOffer, CatalogProvider, MethodRefusal } from "./application-offers.js";
import type { MethodDetection } from "../methods/detection.js";
import { detectRecorded } from "../methods/detect.js";
import type { ApplicationOrigin, ApplicationReport, InstallReport } from "./install-report.js";
import { installProviderStep, planSteps, readStep, runningOf } from "./provider-install.js";
import type { MissingApplicationsHost, PlanStep, ProviderSession } from "./provider-install.js";

export type { MissingApplicationsHost };

const SKIP = "skip";
const PATH_METHOD = "path";
const MAX_ATTEMPTS = 3;

/** A `--application` value the command line cannot accept. */
export class ApplicationChoiceError extends Error {}

export interface MissingApplicationsRequest {
  catalog: Catalog;
  environment: Record<string, string>;
  /** The `--application <id>=<method>` flags, by application id. */
  choices: Record<string, string>;
  ask: AskQuestion;
  platformKey?: string;
}

interface Session extends ProviderSession {
  request: MissingApplicationsRequest;
  platformKey: string;
  providers: CatalogProvider[];
  terminalAvailable: boolean;
}

export function parseApplicationChoices(values: readonly string[]): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    const [id, method] = separator < 1 ? ["", ""] : [value.slice(0, separator), value.slice(separator + 1)];
    if (id === "" || method === "") throw new ApplicationChoiceError(`--application ${value} is not <id>=<method>`);
    if (Object.hasOwn(choices, id)) throw new ApplicationChoiceError(`--application names ${id} twice`);
    choices[id] = method;
  }
  return choices;
}

export function checkApplicationIds(catalog: Catalog, choices: Record<string, string>): void {
  const known = applicationsOf(catalog).map(({ id }) => id);
  const unknown = Object.keys(choices).find((id) => !known.includes(id));
  if (unknown !== undefined) throw new ApplicationChoiceError(`--application names ${unknown}, which the catalog lists no application under; the applications are ${known.join(", ") || "(none)"}`);
}

function flagFor(id: string, method: string): string {
  return `--application ${id}=${method}`;
}

function withRefusals(row: ApplicationReport, unavailable: MethodRefusal[]): ApplicationReport {
  return unavailable.length === 0 ? row : { ...row, unavailable };
}

function questionFor(application: LoaderApplication, offered: string[]): string {
  const lines = [...offered, SKIP].map((method, index) => `  ${index + 1}) ${method}`);
  return `${application.id} (${application.label}) is not installed and was not found. Install it through:\n${lines.join("\n")}\nChoose 1-${lines.length}: `;
}

function methodOf(answer: string, offered: string[]): string | undefined {
  const options = [...offered, SKIP];
  const typed = answer.trim().toLowerCase();
  if (typed === "") return SKIP;
  return options[Number(typed) - 1] ?? options.find((option) => option === typed);
}

async function askForMethod(session: Session, application: LoaderApplication, offered: string[]): Promise<string | undefined> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const answer = await session.request.ask(questionFor(application, offered));
    if (answer === undefined) {
      session.terminalAvailable = false;
      return undefined;
    }
    const method = methodOf(answer, offered);
    if (method !== undefined) return method;
  }
  return SKIP;
}

function checkFlaggedMethod(application: LoaderApplication, method: string, offered: string[]): void {
  if (method === SKIP || offered.includes(method)) return;
  throw new ApplicationChoiceError(`--application ${application.id}=${method} names a method that is not offered; the offered methods are ${[...offered, SKIP].join(", ")}`);
}

async function chosenMethod(session: Session, application: LoaderApplication, offered: string[]): Promise<string | undefined> {
  const flagged = session.request.choices[application.id];
  if (flagged !== undefined) return flagged;
  return offered.length > 0 && session.terminalAvailable ? askForMethod(session, application, offered) : undefined;
}

function failed(application: LoaderApplication, method: string, detail: string, fix: string): ApplicationReport {
  return { id: application.id, state: "failed", unavailable: [{ method, detail, fix }] };
}

/** @implNote The version is what the provider reports after the install, so a provider that cannot say leaves it absent. */
async function installedOrigin(current: RunningHost, application: LoaderApplication, method: string, step: Extract<PlanStep, { kind: "install" }>): Promise<ApplicationOrigin> {
  const detection = await detectRecorded(current, application.id, method, step.name, step.options);
  const version = "answer" in detection && detection.answer.installed ? detection.answer.version : undefined;
  return { method, package: step.name, ...(step.options === undefined ? {} : { options: step.options }), ...(version === undefined ? {} : { version }) };
}

/** @implNote A provider's answer wins over PATH, so an application a provider reports is recorded under that provider's method. */
function detectedOrigin(application: LoaderApplication, detections: MethodDetection[]): ApplicationOrigin {
  const found = detections.find((detection): detection is Extract<MethodDetection, { answer: unknown }> => detection.item === application.id && "answer" in detection && detection.answer.installed);
  if (found === undefined) return { method: PATH_METHOD };
  const { version } = found.answer;
  return { method: found.method, package: found.package, ...(found.options === undefined ? {} : { options: found.options }), ...(version === undefined ? {} : { version }) };
}

/** @implNote A provider that could not be installed ends the plan before its install step, which would only be refused for want of the provider. */
async function carryOut(session: Session, application: LoaderApplication, method: string, steps: Array<Record<string, unknown>>): Promise<ApplicationReport> {
  let installedStep: Extract<PlanStep, { kind: "install" }> | undefined;
  for (const raw of steps) {
    const step = readStep(raw);
    if (step === undefined) return failed(application, method, `the install plan has a step this installer cannot read: ${JSON.stringify(raw)}`, "choose another method");
    if (step.kind === "install-provider") {
      const refusals = await installProviderStep(session, step.providerId);
      if (refusals.length > 0) return failed(application, method, refusals[0]?.detail ?? "", refusals[0]?.fix ?? "");
      continue;
    }
    const answer = await operate(runningOf(session), method, "install", step.name, step.options);
    if (!answer.ok) return failed(application, method, answer.detail, answer.fix);
    installedStep = step;
  }
  const origin = installedStep === undefined ? { method } : await installedOrigin(runningOf(session), application, method, installedStep);
  return { id: application.id, state: "installed", installedThrough: method, origin };
}

async function installThrough(session: Session, application: LoaderApplication, offered: string[], method: string): Promise<ApplicationReport> {
  const planned = planSteps(runningOf(session), application, offered, method, session.providers);
  if ("detail" in planned) return failed(application, method, planned.detail, planned.fix);
  return carryOut(session, application, method, planned.steps);
}

async function resolveOne(session: Session, application: LoaderApplication, offer: ApplicationOffer): Promise<ApplicationReport> {
  const method = await chosenMethod(session, application, offer.offered);
  if (method === undefined && offer.offered.length === 0) return withRefusals({ id: application.id, state: "unavailable" }, offer.unavailable);
  if (method === undefined) {
    const first = offer.offered[0] as string;
    return withRefusals({ id: application.id, state: "missing", offered: offer.offered, flag: flagFor(application.id, first) }, offer.unavailable);
  }
  if (method === SKIP) return withRefusals({ id: application.id, state: "skipped" }, offer.unavailable);
  return withRefusals(await installThrough(session, application, offer.offered, method), offer.unavailable);
}

interface ApplicationStates {
  states: Map<string, string | undefined>;
  detections: MethodDetection[];
}

async function stateOfEach(session: Session, applications: LoaderApplication[]): Promise<ApplicationStates> {
  const current = runningOf(session);
  const detections = (await Promise.all(applications.map(({ id, packages }) => detectThroughMethods(current, id, packages)))).flat();
  const rows = applicationList(current.runtime, session.request.catalog, current.places, session.request.environment, detections);
  return { states: new Map(rows.map((row) => [row.id, row.state])), detections };
}

interface Pending {
  application: LoaderApplication;
  offer: ApplicationOffer;
}

function settledRow(application: LoaderApplication, state: string | undefined, detections: MethodDetection[]): ApplicationReport {
  return state === "detected" ? { id: application.id, state: "detected", origin: detectedOrigin(application, detections) } : { id: application.id, state: "installed" };
}

/** @implNote Every flag is checked against the offers before the first install, so a refused flag leaves nothing half done. */
async function resolveAll(session: Session): Promise<ApplicationReport[]> {
  const applications = applicationsOf(session.request.catalog);
  const { states, detections } = await stateOfEach(session, applications);
  const pending = new Map<string, Pending>();
  for (const application of applications) {
    const state = states.get(application.id);
    if (state === "installed" || state === "detected") continue;
    const offer = offerFor(runningOf(session), application, session.providers, session.platformKey);
    const flagged = session.request.choices[application.id];
    if (flagged !== undefined) checkFlaggedMethod(application, flagged, offer.offered);
    pending.set(application.id, { application, offer });
  }
  const rows: ApplicationReport[] = [];
  for (const application of applications) {
    const waiting = pending.get(application.id);
    const state = states.get(application.id);
    rows.push(waiting === undefined ? settledRow(application, state, detections) : await resolveOne(session, waiting.application, waiting.offer));
  }
  return rows;
}

/**
 * Offers every catalog application that is neither installed nor detected for install through a
 * method the user chooses, and records what happened on `report.applications`.
 *
 * @remarks Nothing is installed unasked: a method comes from an `--application` flag or from the
 * terminal, and with neither the report names the exact flag. A chosen method whose provider is not
 * installed is installed first from the catalog, which stops the host, installs and enables the
 * provider, and starts the host again so the provider is loaded.
 */
export async function resolveMissingApplications(request: MissingApplicationsRequest, host: MissingApplicationsHost, report: InstallReport): Promise<void> {
  const platformKey = request.platformKey ?? currentPlatformKey();
  const session: Session = { running: await host.start(), request, host, report, platformKey, providers: catalogProviders(request.catalog, platformKey), terminalAvailable: true };
  try {
    report.applications = await resolveAll(session);
  } finally {
    await session.running?.stop();
  }
}
