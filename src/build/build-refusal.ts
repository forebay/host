/** Why a bundle or a catalog was not built, and what would make it build. */
export class BuildRefusal extends Error {
  readonly detail: string;
  readonly fix: string;

  constructor(detail: string, fix: string) {
    super(`${detail}; ${fix}`);
    this.name = "BuildRefusal";
    this.detail = detail;
    this.fix = fix;
  }
}
