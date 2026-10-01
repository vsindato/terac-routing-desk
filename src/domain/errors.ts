export type DomainErrorCode = "not_found" | "invalid_transition" | "conflict" | "not_eligible";

/** An expected, user-facing failure of a command. Anything else is a bug. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError("not_found", `${what} not found`);
export const invalidTransition = (message: string) => new DomainError("invalid_transition", message);
