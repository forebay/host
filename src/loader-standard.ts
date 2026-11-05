export type PackageMapping = string | { name: string; options?: Record<string, unknown>; [member: string]: unknown };

export interface LoaderApplication {
  id: string;
  label: string;
  binary: string;
  home: { envOverride?: string; nativeEnv?: string; xdgSubdir?: string; candidates: string[] };
  packages: Record<string, PackageMapping>;
}

/**
 * What a loader declares about the application it loads into, the PATH commands it asks for and
 * the background hosts it keeps running.
 *
 * @remarks `packages` is the manifest shape of the host registry design (5.2), so
 * `runtime.install.packages` merges the user's `packages.json` over it unchanged.
 */
export interface LoaderStandard {
  application: LoaderApplication;
  pathCommands: { requested: string[]; minimum: 0 | 1 };
  background: string[];
}
