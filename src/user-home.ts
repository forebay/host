/**
 * @implNote On Windows USERPROFILE wins because Git Bash sets HOME to an MSYS path the runtime
 * cannot use. There is deliberately no fallback to the process's own home: a caller that controls
 * the environment (a test, a service) must not silently get the real user's.
 */
export function userHomeOf(environment: Record<string, string>, platform: NodeJS.Platform = process.platform): string {
  const home = platform === "win32" ? (environment.USERPROFILE ?? environment.HOME) : environment.HOME;
  if (home === undefined || home === "") {
    throw new Error("the environment carries neither HOME nor USERPROFILE, so the user's home cannot be found");
  }
  return home;
}
