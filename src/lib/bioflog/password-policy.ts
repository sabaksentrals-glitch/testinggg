/**
 * Password + session-gating rules, kept free of any database import so both the
 * server (`secure.server.ts`) and the tests can use them. `secure.server.ts`
 * imports `@/lib/db`, which is not resolvable by the plain-node test runner —
 * so anything that needs coverage has to live here.
 *
 * These are the rules that keep a legacy pilot account from reaching farm data
 * before its password is rotated. They are deliberately strict; loosening them
 * to make login easier would defeat the guard.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * The legacy Grok pilot hash (FNV-1a, non-cryptographic). Reproduced here — not
 * imported from `./engine` — because engine.ts uses extensionless relative
 * imports that the plain-node test runner cannot resolve, and these rules must
 * stay testable. `legacyPasswordHash("BioflogDemo12")` is pinned to the real
 * production value in the test suite so the two cannot drift apart.
 *
 * It is only ever used to RECOGNISE an un-rotated pilot account, never to store
 * a new credential — every rotation writes `strongPasswordHash` instead.
 */
export function legacyPasswordHash(password: string): string {
  let h = 2166136261;
  const s = "bioflog:" + password;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const SCRYPT_BYTES = 32;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

/** A hash produced by `strongPasswordHash` — scrypt$<salt hex>$<derived hex>. */
export function isStrongPasswordHash(value: string): boolean {
  return /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(value);
}

export function strongPasswordHash(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_BYTES);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Accepts the legacy Grok pilot hash ONLY so the account can be identified and
 * forced through rotation — never as a durable credential.
 */
export function passwordMatches(password: string, stored: string): boolean {
  if (!isStrongPasswordHash(stored)) return legacyPasswordHash(password) === stored;
  const [, saltHex, expectedHex] = stored.split("$");
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Real backends must upgrade legacy hashes; the local preview need not. */
export function requiresPasswordUpgrade(storedHash: string, source: string): boolean {
  return source === "neon" && !isStrongPasswordHash(storedHash);
}

/** Farm data is withheld for as long as rotation is outstanding. */
export function shouldWithholdView(requiresPasswordChange: boolean): boolean {
  return requiresPasswordChange;
}

/** A restricted (rotation-pending) session may only change its own password. */
export function mayRunRestrictedAction(restricted: boolean, action: string): boolean {
  return !restricted || action === "users/password";
}

export type PasswordChangeError = { code: string; message: string } | null;

/**
 * One rule set for both sides. `storedHash` is supplied on the server, omitted
 * on the client (which cannot verify it) — the order matches the server so the
 * client never reports a different first failure than the server would.
 */
export function validatePasswordChange(input: {
  current: string;
  next: string;
  confirm?: string;
  storedHash?: string;
}): PasswordChangeError {
  const { current, next, confirm, storedHash } = input;
  if (storedHash !== undefined && !passwordMatches(current, storedHash)) {
    return { code: "PASSWORD_INVALID", message: "Password saat ini tidak cocok." };
  }
  if (next.length < PASSWORD_MIN || next.length > PASSWORD_MAX) {
    return {
      code: "PASSWORD_LENGTH",
      message: `Password baru harus ${PASSWORD_MIN}–${PASSWORD_MAX} karakter.`,
    };
  }
  if (next === current) {
    return {
      code: "PASSWORD_REUSE",
      message: "Password baru harus berbeda dari password saat ini.",
    };
  }
  if (confirm !== undefined && confirm !== next) {
    return { code: "PASSWORD_CONFIRM", message: "Konfirmasi password baru tidak sama." };
  }
  return null;
}

export type Screen = "loading" | "login" | "rotate" | "app";

/**
 * Which screen the app owes the operator.
 *
 * The bug this fixes: a rotation-pending session has a user but no view, and
 * the old gate (`!user || !state`) sent it back to the login form — while the
 * only password form lived behind the view. That deadlocked the account. The
 * "rotate" branch has to be tested BEFORE the login branch.
 */
export function nextScreen(input: {
  ready: boolean;
  hydrated: boolean;
  user: unknown;
  view: unknown;
  requiresPasswordChange: boolean;
}): Screen {
  const { ready, hydrated, user, view, requiresPasswordChange } = input;
  if (!ready || !hydrated) return "loading";
  if (user && !view && requiresPasswordChange) return "rotate";
  if (!user || !view) return "login";
  return "app";
}
