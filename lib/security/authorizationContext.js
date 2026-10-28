const AUTHORIZATION_CONTEXT = Symbol("grandmaster.authorization.context");

export function createAuthorizationContext({ actor = "control-token", requestId = null } = {}) {
  // The symbol key cannot be produced by JSON, so client-supplied fields cannot forge this context.
  return Object.freeze({
    [AUTHORIZATION_CONTEXT]: true,
    actor: String(actor || "control-token").slice(0, 80),
    requestId: requestId ? String(requestId).slice(0, 80) : null,
    issuedAt: new Date().toISOString(),
  });
}

export function isAuthorizationContext(value) {
  return Boolean(
    value && typeof value === "object" && value[AUTHORIZATION_CONTEXT] === true,
  );
}
