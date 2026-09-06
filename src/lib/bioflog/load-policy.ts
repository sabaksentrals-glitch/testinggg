/**
 * Fail-safe policy for what the client may do with whatever `loadFarmState`
 * returned. Kept as pure functions (no store, no network) so the safety rules
 * are unit-testable — see `load-policy.test.ts`.
 *
 * The rule that matters: a Neon-backed deployment that could NOT produce its
 * real state must never fall back to demo data that the app is then allowed to
 * write back. Doing so silently promotes seed data to the production ledger.
 */

export type DbSource = "neon" | "pglite";

/** What the client is allowed to do after a load attempt. */
export type LoadMode =
  /** Real persisted state came back — normal read/write. */
  | "remote"
  /** Local/demo backend with no state yet — seed and persist locally. */
  | "demo"
  /** Production backend with no usable state — read-only, must not be written. */
  | "unavailable";

export type LoadOutcome = {
  source: DbSource;
  /** Whether the server returned a usable Database. */
  hasDb: boolean;
};

/**
 * Decide the mode for a completed load.
 *
 * `neon` + no state => "unavailable" (NOT "demo"). This is the fix for the
 * path where an unmigrated / unreachable production database caused the client
 * to seed demo data and then persist it on the first edit.
 */
export function decideLoadMode({ source, hasDb }: LoadOutcome): LoadMode {
  if (hasDb) return "remote";
  return source === "neon" ? "unavailable" : "demo";
}

/** A load that threw is never writable, whatever the backend was. */
export function decideLoadModeOnError(): LoadMode {
  return "unavailable";
}

/** May the client seed demo data into this mode? */
export function maySeedDemo(mode: LoadMode): boolean {
  return mode === "demo";
}

/** May the client persist state to the backend in this mode? */
export function mayPersist(mode: LoadMode): boolean {
  return mode !== "unavailable";
}

/** May the client mutate at all? Blocking here stops the write at the source. */
export function mayMutate(mode: LoadMode): boolean {
  return mode !== "unavailable";
}

/**
 * Demo passwords may only be forced onto accounts on a demo/local backend.
 * On Neon the stored hashes are production credentials and must be left alone.
 */
export function mayApplyDemoLogins(source: DbSource): boolean {
  return source !== "neon";
}

export const STATE_UNAVAILABLE_MESSAGE =
  "Database produksi tidak dapat dimuat. Aplikasi dalam mode hanya-baca agar data demo tidak menimpa catatan produksi.";
