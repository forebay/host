/** Why a host command was refused, and what would make it run. */
export class CommandRefusal extends Error {
  readonly detail: string;
  readonly fix: string;

  constructor(detail: string, fix: string) {
    super(`${detail}; ${fix}`);
    this.name = "CommandRefusal";
    this.detail = detail;
    this.fix = fix;
  }
}
