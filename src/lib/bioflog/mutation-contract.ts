/**
 * How the client must react when a mutation fails.
 *
 * Two rules the store previously got wrong:
 *
 *  1. A mutation is not "successful" until the server says so. The store used
 *     to fire the request and return synchronously, so the UI announced success
 *     before the server had even been asked.
 *  2. Only a genuinely invalid session may clear the session. The store used to
 *     drop `sessionToken`, `userData` and `view` on EVERY failure, so an
 *     ordinary validation error, a permission denial, a locked period or a
 *     concurrency conflict logged the operator out and discarded their work.
 *
 * Kept free of relative runtime imports so the test runner can load it —
 * `store.ts` pulls in the server-function client and cannot be imported here.
 */

/**
 * Codes that mean the caller's session is no longer usable. Taken from the
 * actual throw sites in `secure.server.ts` (`parseClaims`, `sessionUser`, and
 * the post-mutation active-user re-check), plus the store's own local guard.
 *
 * Deliberately NOT in this list, because the session is still valid and the
 * operator must stay on the page:
 *   PASSWORD_CHANGE_REQUIRED (403) — must reach the rotation screen
 *   STATE_CONFLICT (409), VERSION_CONFLICT (409), PERIOD_LOCKED (409)
 *   FORBIDDEN, FORBIDDEN_SCOPE, FINANCE_FORBIDDEN, DEVICE_PERMISSION (403)
 *   INVALID_FIELD, PASSWORD_* and every other domain rejection (422)
 *   STATE_UNAVAILABLE, STATE_TIMESTAMP, DATABASE_REQUIRED (503)
 */
export const SESSION_INVALID_CODES: readonly string[] = [
  "UNAUTHENTICATED",
  "SESSION_INVALID",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
];

type ErrorLike = { code?: unknown; status?: unknown; message?: unknown };

/**
 * `code` and `status` survive the server-function boundary: the handler's
 * `Problem` is serialized by seroval with its own properties intact and
 * rethrown client-side as the same object, so this can classify on the code
 * rather than on message text.
 *
 * `status === 401` is honoured as a fallback so an auth failure introduced
 * later still logs out even if its code is not listed here. Anything else —
 * including an unrecognised error — keeps the session, because wrongly keeping
 * a session shows the operator an error, while wrongly dropping one destroys
 * their unsaved work.
 */
export function isSessionInvalid(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ErrorLike;
  if (typeof candidate.code === "string" && SESSION_INVALID_CODES.includes(candidate.code)) {
    return true;
  }
  return candidate.status === 401;
}

export type FailureAction = {
  /** Clear sessionToken/userData/view and send the operator back to login. */
  clearSession: boolean;
  /** Message to surface. */
  syncError: string;
};

export function mutationFailureAction(error: unknown, fallback: string): FailureAction {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  return { clearSession: isSessionInvalid(error), syncError: message };
}
