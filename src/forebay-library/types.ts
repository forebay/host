import type { AppDescriptor, ServiceType } from "@weivel/typescript";
import type { Profile } from "../contracts/index.js";

/**
 * The services `forebay/library`'s `library.json` declares, written by hand.
 *
 * @implNote Not generated: weivel/typescript's generator refuses a `type` array such as
 * `["string", "null"]` (`nativeModelPattern`) and `["number", "null"]` (`expires`). `open.test.ts`
 * calls every function once through the opened library, so a function renamed or dropped in the
 * declaration fails there.
 */
export interface Refusable {
  refused?: string;
  fix?: string;
}

export interface Assignment {
  provider: string;
  model: string;
  name: string;
  derived: boolean;
}

export type ModelMap = Record<string, Assignment[]>;

export interface CatalogModel {
  name: string;
  limit: { context: number; output: number };
}

/** One provider's models in the shape `routing.*` reads, keyed by the provider's plugin id. */
export interface ProviderCatalog {
  models: Record<string, CatalogModel>;
  ranking: string[];
  defaultModelId?: string;
}

export type ModelsArgument = Record<string, ProviderCatalog>;

export type RoutingNotice = "model_switched" | "healed";

export interface AppsService {
  list(argument: Record<string, unknown>): { apps: AppDescriptor[] };
  get(argument: { id: string }): { app?: AppDescriptor };
  home(argument: { id: string }): { home?: string };
  current(argument: Record<string, unknown>): { id: string };
}

export const Apps: ServiceType<AppsService> = { id: "apps" };

export interface RoutingService {
  tiers(argument: { profile: Profile; models: ModelsArgument }): { tiers?: string[] } & Refusable;
  modelMap(argument: { profile: Profile; stored: Record<string, unknown>; models: ModelsArgument }): { map?: ModelMap; healed?: string[] } & Refusable;
  resolve(argument: { profile: Profile; map: ModelMap; models: ModelsArgument; requestedModel: string }): { chain?: Assignment[]; notices?: RoutingNotice[] } & Refusable;
  outcome(argument: { status: number; headers: Record<string, string>; now: number }): { rateLimited: boolean; resetAt?: number };
  limits(argument: Record<string, never>): { maxRequestBytes: number };
  environment(argument: { profile: Profile; map: ModelMap; port: number; providersEnabled: boolean; environment: Record<string, string>; userHome: string }): { environment: Record<string, string> };
}

export const Routing: ServiceType<RoutingService> = { id: "routing" };

export interface StoredAccount {
  id: string;
  label?: string;
  enabled?: boolean;
  disabledReason?: string;
  coolingDownUntil?: number;
  cooldownReason?: string;
  rateLimitResetTimes?: Record<string, number>;
  lastUsed?: number;
  expires?: number | null;
  quota?: Record<string, unknown>;
  [member: string]: unknown;
}

export type AccountOutcome = "success" | "rate-limited" | "error" | "disabled" | "quota";

export interface AccountsService {
  list(argument: { store: string }): { accounts?: StoredAccount[] } & Refusable;
  upsert(argument: { store: string; account: StoredAccount }): { outcome?: "added" | "updated" | "unchanged" } & Refusable;
  remove(argument: { store: string; id: string }): { removed?: boolean } & Refusable;
  acquire(argument: { store: string; lane?: string; strategy: string; now: number }): { id?: string; available?: boolean; availableAt?: number; none?: boolean; nextAvailableAt?: number } & Refusable;
  report(argument: {
    store: string;
    id: string;
    lane?: string;
    outcome: AccountOutcome;
    now: number;
    random?: number;
    baseMilliseconds?: number;
    maxMilliseconds?: number;
    attempt?: number;
    resetAt?: number;
    reason?: string;
    quota?: Record<string, unknown>;
  }): { changed?: boolean } & Refusable;
  tokenExpired(argument: { expires?: number | null; now: number; skewMilliseconds?: number }): { expired?: boolean } & Refusable;
  hasCapacity(argument: { pools: Array<{ remainingFraction?: number; [member: string]: unknown }> }): { capacity?: boolean } & Refusable;
}

export const Accounts: ServiceType<AccountsService> = { id: "accounts" };
