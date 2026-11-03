/** Why an application's home could not be resolved, and what would make it. */
export class HomeRefusal extends Error {
  readonly detail: string;
  readonly fix: string;

  constructor(detail: string, fix: string) {
    super(`${detail}; ${fix}`);
    this.name = "HomeRefusal";
    this.detail = detail;
    this.fix = fix;
  }
}
