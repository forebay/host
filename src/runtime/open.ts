import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentPlatformKey, openLibrary, parseDeclaration, servicesOf } from "@weivel/typescript/host";
import type { LibraryDeclaration, LoadedLibrary } from "@weivel/typescript/host";
import { useKoffiFrom } from "./cached-koffi.js";
import { runtimeBinaryName } from "./cached-runtime.js";
import type {
  BootService,
  CacheService,
  ConfigService,
  LoaderService,
  LogService,
  PathsService,
  PlacesService,
  ProcessesService,
  RegistryService,
  SecretsService,
  SettingsService,
  UiService,
  UpdatesService,
} from "./types.js";

export interface RuntimeSource {
  binaryPath: string;
  declarationPath: string;
  /** The cached koffi the host bundle loads the runtime through; unset where koffi is an installed package. */
  koffiDirectory?: string;
}

export interface Runtime {
  places: PlacesService;
  paths: PathsService;
  config: ConfigService;
  settings: SettingsService;
  log: LogService;
  secrets: Pick<SecretsService, "get" | "set" | "delete" | "reconcile">;
  registry: Pick<RegistryService, "get">;
  cache: Pick<CacheService, "locate">;
  updates: Pick<UpdatesService, "apply" | "check">;
  processes: Pick<ProcessesService, "prune" | "recordRun" | "removeRuns" | "ready">;
  boot: Pick<BootService, "read">;
  loader: Pick<LoaderService, "check">;
  ui: Pick<UiService, "navigation" | "plan" | "render">;
  close(): void;
}

/** Where `cmake --build --config Release` leaves the runtime library on this OS, as `siblings/library` is laid out. */
function sharedLibraryPath(root: string): string {
  const build = join(root, "siblings", "library", "build", "bin");
  const binary = runtimeBinaryName(currentPlatformKey());
  return process.platform === "win32" ? join(build, "Release", binary) : join(build, binary);
}

export function siblingRuntime(root: string): RuntimeSource {
  return {
    binaryPath: sharedLibraryPath(root),
    declarationPath: join(root, "siblings", "library", "runtime", "library.json"),
  };
}

function serviceOf<Service>(library: LoadedLibrary, declaration: LibraryDeclaration, id: string): Service {
  const found = servicesOf(library, declaration).find((service) => service.id === id);
  if (!found) throw new Error(`the runtime declaration has no ${id} service`);
  return found.implementation as unknown as Service;
}

export function openRuntime(source: RuntimeSource): Runtime {
  if (source.koffiDirectory !== undefined) useKoffiFrom(source.koffiDirectory);
  const declaration = parseDeclaration(readFileSync(source.declarationPath, "utf8"));
  const library = openLibrary(source.binaryPath, declaration);
  const service = <Service>(id: string) => serviceOf<Service>(library, declaration, id);
  return {
    places: service<PlacesService>("places"),
    paths: service<PathsService>("paths"),
    config: service<ConfigService>("config"),
    settings: service<SettingsService>("settings"),
    log: service<LogService>("log"),
    secrets: service<SecretsService>("secrets"),
    registry: service<RegistryService>("registry"),
    cache: service<CacheService>("cache"),
    updates: service<UpdatesService>("updates"),
    processes: service<ProcessesService>("processes"),
    boot: service<BootService>("boot"),
    loader: service<LoaderService>("loader"),
    ui: service<UiService>("ui"),
    close: () => library.close(),
  };
}
