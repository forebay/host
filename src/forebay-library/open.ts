import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentPlatformKey, openLibrary, parseDeclaration, servicesOf } from "@weivel/typescript/host";
import type { LibraryDeclaration, LoadedLibrary } from "@weivel/typescript/host";
import { libraryBinaryName, libraryDirectory } from "../runtime/cached-runtime.js";
import type { AccountsService, AppsService, RoutingService } from "./types.js";

export const FOREBAY_LIBRARY_ID = "apps";

const DECLARATION_FILE = "library.json";
const CONTRACTS_FOLDER = "contracts";

type LibraryContextProvider = NonNullable<Parameters<typeof openLibrary>[2]>;

/** Where `forebay/library` is: its declaration, the folder its binary is in, and its contract schemas. */
export interface ForebayLibrarySource {
  declarationPath: string;
  binaryDirectory: string;
  contractsDirectory: string;
}

/** A service the host offers every plugin, as weivel's `startPlugins` takes it. */
export interface HostService {
  id: string;
  implementation: unknown;
}

export interface ForebayLibrary {
  apps: AppsService;
  routing: RoutingService;
  accounts: AccountsService;
  contractsDirectory: string;
  services: HostService[];
  close(): void;
}

/** The `apps` library at `version` in the cache, laid out as `catalog build --library apps=<folder>` placed it. */
export function cachedForebayLibrary(cache: string, version: string, platformKey: string = currentPlatformKey()): ForebayLibrarySource {
  const directory = libraryDirectory(cache, FOREBAY_LIBRARY_ID, version, platformKey);
  return { declarationPath: join(directory, DECLARATION_FILE), binaryDirectory: directory, contractsDirectory: join(directory, CONTRACTS_FOLDER) };
}

/** The `siblings/forebay-library` checkout, built with `cmake --build build --config Release`. */
export function siblingForebayLibrary(root: string): ForebayLibrarySource {
  const checkout = join(root, "siblings", "forebay-library");
  const built = join(checkout, "build", "bin");
  return {
    declarationPath: join(checkout, DECLARATION_FILE),
    binaryDirectory: process.platform === "win32" ? join(built, "Release") : built,
    contractsDirectory: join(checkout, CONTRACTS_FOLDER),
  };
}

function implementationOf<Service>(services: HostService[], id: string): Service {
  const found = services.find((service) => service.id === id);
  if (found === undefined) throw new Error(`the ${FOREBAY_LIBRARY_ID} declaration has no ${id} service`);
  return found.implementation as Service;
}

function servicesFrom(library: LoadedLibrary, declaration: LibraryDeclaration): HostService[] {
  return servicesOf(library, declaration).map(({ id, implementation }) => ({ id, implementation }));
}

/** Opens `forebay/library`, answering the context its `apps` functions declare from `context`. */
export function openForebayLibrary(source: ForebayLibrarySource, context: LibraryContextProvider): ForebayLibrary {
  const declaration = parseDeclaration(readFileSync(source.declarationPath, "utf8"));
  const library = openLibrary(join(source.binaryDirectory, libraryBinaryName(declaration.binary, currentPlatformKey())), declaration, context);
  const services = servicesFrom(library, declaration);
  return {
    apps: implementationOf<AppsService>(services, "apps"),
    routing: implementationOf<RoutingService>(services, "routing"),
    accounts: implementationOf<AccountsService>(services, "accounts"),
    contractsDirectory: source.contractsDirectory,
    services,
    close: () => library.close(),
  };
}

/** The services a plugin reaches `forebay/library` through, under the ids its declaration gives them. */
export function forebayLibraryServices(library: ForebayLibrary): HostService[] {
  return library.services;
}
