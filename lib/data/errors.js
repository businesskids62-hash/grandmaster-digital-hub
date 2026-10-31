export const REPOSITORY_ERROR_CODES = Object.freeze({
  CONFLICT: "CONFLICT",
  NOT_FOUND: "NOT_FOUND",
  CONSTRAINT: "CONSTRAINT",
  UNAVAILABLE: "UNAVAILABLE",
  INVALID_STATE: "INVALID_STATE",
  UNSUPPORTED: "UNSUPPORTED",
});

export class RepositoryError extends Error {
  constructor(
    message,
    { code = REPOSITORY_ERROR_CODES.UNAVAILABLE, cause = null, retryable = false } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "RepositoryError";
    this.code = code;
    this.retryable = Boolean(retryable);
  }
}

export function isRepositoryError(error) {
  return error instanceof RepositoryError;
}
