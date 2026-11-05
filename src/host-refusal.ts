/** Why a host did not start, and what would make it start. */
export class HostRefusal extends Error {
  readonly detail: string;
  readonly fix: string;

  constructor(detail: string, fix: string) {
    super(`${detail}; ${fix}`);
    this.name = "HostRefusal";
    this.detail = detail;
    this.fix = fix;
  }
}
