import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "@weivel/typescript";

const INSTALLED_VERSION = "1.0.0";
const UPDATED_VERSION = "2.0.0";

type Installed = Record<string, string>;
type Answer = { ok: true } | { ok: false; detail: string; fix: string };

const fake: Plugin = {
  activate(context) {
    const file = join(context.paths.cache, "installed.json");

    const read = (): Installed => {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as Installed;
      } catch {
        return {};
      }
    };
    const write = (installed: Installed): void => {
      mkdirSync(context.paths.cache, { recursive: true });
      writeFileSync(file, JSON.stringify(installed));
    };
    const change = (name: string, apply: (installed: Installed) => void): Answer => {
      const installed = read();
      apply(installed);
      write(installed);
      return { ok: true };
    };

    context.services.register(context.service<object>("fake-install-method:install-method"), {
      detect: (request: { package: string }) => {
        const version = read()[request.package];
        return version === undefined ? { installed: false } : { installed: true, version };
      },
      install: (request: { package: string }) => change(request.package, (installed) => {
        installed[request.package] ??= INSTALLED_VERSION;
      }),
      update: (request: { package: string }): Answer => {
        if (read()[request.package] === undefined) {
          return { ok: false, detail: `${request.package} is not installed`, fix: `install ${request.package} first` };
        }
        return change(request.package, (installed) => {
          installed[request.package] = UPDATED_VERSION;
        });
      },
      remove: (request: { package: string }) => change(request.package, (installed) => {
        delete installed[request.package];
      }),
    });
  },
  deactivate() {},
};

export default fake;
