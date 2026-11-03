const PLATFORM_KEY = /^[a-z0-9]+-[a-z0-9]+$/;

/** Whether `key` has the `<os>-<arch>` shape Node spells platforms in, for example `linux-x64`. */
export function isPlatformKey(key: string): boolean {
  return PLATFORM_KEY.test(key);
}
