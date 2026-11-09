export type PackageMapping = string | { name: string; options?: Record<string, unknown>; [member: string]: unknown };

/** The variables an application is pointed at a proxy through, and how to tell it has a login of its own. */
export interface ApplicationProxy {
  baseUrlVariable: string;
  placeholder: { variable: string; value: string };
  ownLogin: {
    variables: string[];
    stateFile?: { directoryVariable?: string; name: string; member: string };
  };
}

/**
 * What makes an application start the loader's host through its own plugin mechanism.
 *
 * @remarks Every string but a `json` member's name may use the placeholders of `loader.check`, as
 * `{{name}}` or, inside source text, `{{json:name}}`.
 */
export interface ApplicationEntry {
  runsOnJavascriptHost: boolean;
  directories: string[];
  files: Array<{ path: string; json?: unknown; text?: string }>;
  settings: Array<{ file: string; key: string[]; value: unknown }>;
}

export interface LoaderApplication {
  id: string;
  label: string;
  binary: string;
  home: { envOverride?: string; nativeEnv?: string; xdgSubdir?: string; candidates: string[] };
  packages: Record<string, PackageMapping>;
  proxy?: ApplicationProxy;
  entry?: ApplicationEntry;
}

/**
 * What a loader declares about the application it loads into, the PATH commands it asks for and
 * the background hosts it keeps running and the plugins it cannot run without.
 *
 * @remarks `packages` is the manifest shape of the host registry design (5.2), so
 * `runtime.install.packages` merges the user's `packages.json` over it unchanged.
 */
export interface LoaderStandard {
  application: LoaderApplication;
  pathCommands: { requested: string[]; minimum: 0 | 1 };
  background: string[];
  plugins: string[];
}
