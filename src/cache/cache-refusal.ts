/** Why the cache would not fetch or keep a file, and what would make it. */
export class CacheRefusal extends Error {
  readonly detail: string;
  readonly fix: string;

  constructor(detail: string, fix: string) {
    super(`${detail}; ${fix}`);
    this.name = "CacheRefusal";
    this.detail = detail;
    this.fix = fix;
  }
}
