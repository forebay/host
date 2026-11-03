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
import type { ApplicationReport, InstallReport } from "./install-report.js";

const SKIP = "skip";
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

/** How the install starts the host from the cache, and installs and enables one more plugin into it. */
export interface MissingApplicationsHost {
  start(): Promise<RunningHost>;
  installProvider(id: string): Promise<InstallReport>;
}

interface Session {
  running: RunningHost | undefined;
  request: MissingApplicationsRequest;
  host: MissingApplicationsHost;
  report: InstallReport;
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

function running(session: Session): RunningHost {
  if (session.running === undefined) throw new Error("the host is not running");
  return session.running;
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
  if (flagged !== undefined) {
    checkFlaggedMethod(application, flagged, offered);
    return flagged;
  }
  return offered.length > 0 && session.terminalAvailable ? askForMethod(session, application, offered) : undefined;
}

function failed(application: LoaderApplication, method: string, detail: string, fix: string): ApplicationReport {
  return { id: application.id, state: "failed", unavailable: [{ method, detail, fix }] };
}

function stepsOf(session: Session, application: LoaderApplication, offered: string[], method: string): { steps: Array<Record<string, unknown>> } | MethodRefusal {
  const current = running(session);
  try {
    return current.runtime.install.plan({
      places: current.places,
      item: application.id,
      manifestPackages: application.packages,
      methods: offered,
      chosen: method,
      installedProviders: activeMethods(current),
      catalog: session.providers.map((provider) => ({ ...provider })),
    });
  } catch (error) {
    return { method, detail: (error as Error).message, fix: "choose another method" };
  }
}

async function installProviderStep(session: Session, providerId: string): Promise<MethodRefusal[]> {
  await running(session).stop();
  session.running = undefined;
  const result = await session.host.installProvider(providerId);
  session.report.installed.push(...result.installed);
  session.report.enabled.push(...result.enabled);
  session.running = await session.host.start();
  return result.unavailable.map(({ detail, fix }) => ({ method: providerId, detail, fix }));
}

function packageOf(step: Record<string, unknown>): { name: string; options?: object } {
  return (step.install as { package: { name: string; options?: object } }).package;
}

/** @implNote A provider that could not be installed ends the plan before its install step, which would only be refused for want of the provider. */
async function carryOut(session: Session, application: LoaderApplication, method: string, steps: Array<Record<string, unknown>>): Promise<ApplicationReport> {
  for (const step of steps) {
    if (step["install-provider"] !== undefined) {
      const providerId = (step["install-provider"] as { id: string }).id;
      const refusals = await installProviderStep(session, providerId);
      if (refusals.length > 0) return failed(application, method, refusals[0]?.detail ?? "", refusals[0]?.fix ?? "");
      continue;
    }
    const { name, options } = packageOf(step);
    const answer = await operate(running(session), method, "install", name, options);
    if (!answer.ok) return failed(application, method, answer.detail, answer.fix);
  }
  return { id: application.id, state: "installed", installedThrough: method };
}

async function installThrough(session: Session, application: LoaderApplication, offered: string[], method: string): Promise<ApplicationReport> {
  const planned = stepsOf(session, application, offered, method);
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

async function stateOfEach(session: Session, applications: LoaderApplication[]): Promise<Map<string, string | undefined>> {
  const current = running(session);
  const detections = (await Promise.all(applications.map(({ id, packages }) => detectThroughMethods(current, id, packages)))).flat();
  const rows = applicationList(current.runtime, session.request.catalog, current.places, session.request.environment, detections);
  return new Map(rows.map((row) => [row.id, row.state]));
}

async function resolveAll(session: Session): Promise<ApplicationReport[]> {
  const applications = applicationsOf(session.request.catalog);
  const states = await stateOfEach(session, applications);
  const rows: ApplicationReport[] = [];
  for (const application of applications) {
    const state = states.get(application.id);
    if (state === "installed" || state === "detected") {
      rows.push({ id: application.id, state });
      continue;
    }
    rows.push(await resolveOne(session, application, offerFor(running(session), application, session.providers, session.platformKey)));
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
