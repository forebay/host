// Generated from the library.json of runtime 0.1.0; regenerate it from the declaration rather than editing it.
import type { ServiceType } from "@weivel/typescript";

export interface PathsService {
  resolve(argument: { home: string; names?: { [key: string]: unknown }; plugin?: string; places?: { portable: string; cache: string; [key: string]: unknown }; [key: string]: unknown }): { home: string; repos: string; plugin: string; cache: string; config: string; portable?: string; pluginCache?: string };
}

export const Paths: ServiceType<PathsService> = { id: "paths" };

export interface PlacesService {
  resolve(argument: { home: string; environment?: { [key: string]: unknown }; [key: string]: unknown }): { portable: string; state: string; cache: string; secretsFile: string; forceFileStore: boolean };
}

export const Places: ServiceType<PlacesService> = { id: "places" };

export interface ConfigService {
  all(argument: { home: string; names?: { [key: string]: unknown }; portable?: string; plugin: string; config?: { [key: string]: unknown }; [key: string]: unknown }): { values: { [key: string]: unknown } };
  get(argument: { home: string; names?: { [key: string]: unknown }; portable?: string; plugin: string; config?: { [key: string]: unknown }; key: string; [key: string]: unknown }): { value?: unknown };
  set(argument: { home: string; names?: { [key: string]: unknown }; portable?: string; plugin: string; config?: { [key: string]: unknown }; key: string; value: unknown; layer?: "application" | "portable"; [key: string]: unknown }): { previous?: unknown };
}

export const Config: ServiceType<ConfigService> = { id: "config" };

export interface SettingsService {
  all(argument: { home: string; names?: { [key: string]: unknown }; portable?: string; [key: string]: unknown }): { values: { [key: string]: unknown } };
  set(argument: { home: string; names?: { [key: string]: unknown }; portable?: string; key: string; value: unknown; layer?: "application" | "portable"; [key: string]: unknown }): { previous?: unknown };
}

export const Settings: ServiceType<SettingsService> = { id: "settings" };

export interface LogService {
  write(argument: { home: string; names?: { [key: string]: unknown }; portable?: string; plugin: string; config?: { [key: string]: unknown }; start: string; time: string; level: "debug" | "info" | "warn" | "error"; message: string; noColor: boolean; [key: string]: unknown }): { console?: string };
}

export const Log: ServiceType<LogService> = { id: "log" };

export interface SecretsService {
  get(argument: { places: { secretsFile: string; forceFileStore: boolean; [key: string]: unknown }; plugin: string; name: string; [key: string]: unknown }): { value?: string };
  set(argument: { places: { secretsFile: string; forceFileStore: boolean; [key: string]: unknown }; plugin: string; name: string; value: string; [key: string]: unknown }): { place: "store" | "file" };
  delete(argument: { places: { secretsFile: string; forceFileStore: boolean; [key: string]: unknown }; plugin: string; name: string; [key: string]: unknown }): { [key: string]: never };
  clear(argument: { places: { secretsFile: string; forceFileStore: boolean; [key: string]: unknown }; plugin: string; [key: string]: unknown }): { [key: string]: never };
  reconcile(argument: { places: { secretsFile: string; forceFileStore: boolean; [key: string]: unknown }; [key: string]: unknown }): { moved: number };
}

export const Secrets: ServiceType<SecretsService> = { id: "secrets" };

export interface RegistryService {
  register(argument: { places: { state: string; [key: string]: unknown }; registration: { id: string; kind: "host"; version: string; home?: string; application?: { [key: string]: unknown }; provenance: { method: string; version: string; location: string; os: string; architecture: string; installedAt: string; [key: string]: unknown }; requiresCommand: boolean; [key: string]: unknown }; [key: string]: unknown }): { registration: { [key: string]: unknown } };
  get(argument: { places: { state: string; [key: string]: unknown }; id: string; [key: string]: unknown }): { registration?: { [key: string]: unknown } };
  list(argument: { places: { state: string; [key: string]: unknown }; [key: string]: unknown }): { hosts: { registration: { [key: string]: unknown }; orphan: boolean }[]; unreadable: string[] };
  forget(argument: { places: { state: string; cache: string; [key: string]: unknown }; id: string; [key: string]: unknown }): { forgotten: boolean };
}

export const Registry: ServiceType<RegistryService> = { id: "registry" };

export interface ChangesService {
  apply(argument: { places: { state: string; [key: string]: unknown }; host: string; change: { kind: "file" | "directory" | "json-key" | "profile-line" | "path-entry"; path?: string; content?: string; executable?: boolean; file?: string; key?: string[]; value?: unknown; line?: string; directory?: string; home?: string; source?: string; create?: boolean; shell?: string; [key: string]: unknown }; [key: string]: unknown }): { recorded: boolean; sequence?: number };
  reverse(argument: { places: { state: string; [key: string]: unknown }; host: string; [key: string]: unknown }): { reversed: number; drifted: { sequence: number; kind: string; detail: string }[] };
}

export const Changes: ServiceType<ChangesService> = { id: "changes" };

export interface CommandsService {
  request(argument: { places: { state: string; [key: string]: unknown }; environment: { [key: string]: unknown }; host: string; home: string; name: string; target: string; arguments?: string[]; [key: string]: unknown }): { name?: string };
  rename(argument: { places: { state: string; [key: string]: unknown }; environment: { [key: string]: unknown }; host: string; from: string; to: string; [key: string]: unknown }): { name: string };
  delete(argument: { places: { state: string; [key: string]: unknown }; host: string; name: string; [key: string]: unknown }): { deleted: true };
  add(argument: { places: { state: string; [key: string]: unknown }; environment: { [key: string]: unknown }; host: string; home: string; name: string; target: string; arguments?: string[]; [key: string]: unknown }): { name: string };
}

export const Commands: ServiceType<CommandsService> = { id: "commands" };

export interface InstallService {
  packages(argument: { places: { portable: string; [key: string]: unknown }; item: string; manifestPackages?: { [key: string]: unknown }; [key: string]: unknown }): { packages: { [key: string]: unknown } };
  plan(argument: { places: { portable: string; [key: string]: unknown }; item: string; manifestPackages?: { [key: string]: unknown }; methods: string[]; chosen: string; installedProviders?: string[]; catalog?: { [key: string]: unknown }[]; [key: string]: unknown }): { steps: { [key: string]: unknown }[] };
}

export const Install: ServiceType<InstallService> = { id: "install" };
