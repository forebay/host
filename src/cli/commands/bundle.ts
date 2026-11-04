import { bundleLoader } from "../../build/bundle-loader.js";
import { bundlePlugin } from "../../build/bundle-plugin.js";
import type { CommandLineOutput } from "../output.js";

export async function bundleCommand(repository: string, outDirectory: string, output: CommandLineOutput): Promise<void> {
  const bundled = await bundlePlugin(repository, outDirectory);
  output.out(`bundled ${bundled.id}@${bundled.version} into ${outDirectory}`);
}

export async function bundleLoaderCommand(repository: string, outDirectory: string, output: CommandLineOutput): Promise<void> {
  const bundled = await bundleLoader(repository, outDirectory);
  output.out(`bundled the loader ${bundled.id}@${bundled.version} into ${outDirectory}`);
}
