import type { LoaderApplication } from "./standard.js";
import type { MethodDetection } from "../methods/detection.js";
import { findOnPath } from "./on-path.js";

function reportsPackageInstalled(application: LoaderApplication, providers: MethodDetection[]): boolean {
  return providers.some((detection) => {
    if (detection.item !== application.id || "refused" in detection) return false;
    return detection.answer.installed;
  });
}

/** @implNote A refused detection never counts: a method that could not answer has not said the package is here. */
export function detectApplication(
  application: LoaderApplication,
  environment: Record<string, string>,
  providers: MethodDetection[],
  platform: NodeJS.Platform = process.platform,
): boolean {
  return findOnPath(application.binary, environment, platform) !== undefined || reportsPackageInstalled(application, providers);
}
