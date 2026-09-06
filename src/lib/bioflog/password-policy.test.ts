import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isStrongPasswordHash,
  legacyPasswordHash,
  mayRunRestrictedAction,
  nextScreen,
  passwordMatches,
  requiresPasswordUpgrade,
  shouldWithholdView,
  strongPasswordHash,
  validatePasswordChange,
} from "./password-policy.ts";

const LEGACY_PILOT_PASSWORD = "BioflogDemo12";
const legacyHash = legacyPasswordHash(LEGACY_PILOT_PASSWORD);

// Golden value taken from the real production snapshot: every un-rotated pilot
// account in Neon stores exactly this hash. It pins the legacy algorithm so a
// future edit cannot silently stop recognising production accounts.
test("the legacy hash still matches the production pilot value", () => {
  assert.equal(legacyHash, "3300307d");
});

/** The shape loginFarmSession/resumeFarmSession return, using the same rules. */
function sessionFor(storedHash: string, source = "neon") {
  const requiresPasswordChange = requiresPasswordUpgrade(storedHash, source);
  return {
    requiresPasswordChange,
    restricted: requiresPasswordChange,
    view: shouldWithholdView(requiresPasswordChange) ? null : { farm: "farm-utama" },
    user: { id: "admin", email: "admin@bioflog.local" },
  };
}

// A
test("legacy login is accepted but yields requiresPasswordChange and a null view", () => {
  assert.equal(passwordMatches(LEGACY_PILOT_PASSWORD, legacyHash), true);
  const session = sessionFor(legacyHash);
  assert.equal(session.requiresPasswordChange, true);
  assert.equal(session.view, null, "farm data must be withheld before rotation");
  assert.ok(session.user, "the account is still identified so it can rotate");
});

// B
test("a restricted session cannot run any action except users/password", () => {
  assert.equal(mayRunRestrictedAction(true, "users/password"), true);
  for (const action of ["records", "ponds", "cycles", "users", "tasks/complete"]) {
    assert.equal(mayRunRestrictedAction(true, action), false, `${action} must be blocked`);
  }
  assert.equal(mayRunRestrictedAction(false, "records"), true);
});

// C — the deadlock regression
test("forced rotation screen is reachable while user exists and view is null", () => {
  const base = { ready: true, hydrated: true };
  assert.equal(
    nextScreen({ ...base, user: { id: "admin" }, view: null, requiresPasswordChange: true }),
    "rotate",
    "must NOT fall back to the login screen — that was the deadlock",
  );
  assert.equal(
    nextScreen({ ...base, user: null, view: null, requiresPasswordChange: false }),
    "login",
  );
  assert.equal(
    nextScreen({ ...base, user: { id: "admin" }, view: { farm: 1 }, requiresPasswordChange: false }),
    "app",
  );
  assert.equal(
    nextScreen({ ready: false, hydrated: false, user: null, view: null, requiresPasswordChange: false }),
    "loading",
  );
});

test("a session with no view and no rotation flag still goes to login, not rotate", () => {
  assert.equal(
    nextScreen({ ready: true, hydrated: true, user: { id: "x" }, view: null, requiresPasswordChange: false }),
    "login",
  );
});

// D
test("a new password under 12 characters is rejected", () => {
  const err = validatePasswordChange({
    current: LEGACY_PILOT_PASSWORD,
    next: "short11chars",
    storedHash: legacyHash,
  });
  assert.equal(validatePasswordChange({
    current: LEGACY_PILOT_PASSWORD, next: "abc", storedHash: legacyHash,
  })?.code, "PASSWORD_LENGTH");
  assert.equal(err, null, "exactly 12 characters is allowed");
  assert.equal(validatePasswordChange({
    current: LEGACY_PILOT_PASSWORD, next: "x".repeat(257), storedHash: legacyHash,
  })?.code, "PASSWORD_LENGTH");
});

// E
test("reusing the current password is rejected", () => {
  const err = validatePasswordChange({
    current: LEGACY_PILOT_PASSWORD,
    next: LEGACY_PILOT_PASSWORD,
    storedHash: legacyHash,
  });
  assert.equal(err?.code, "PASSWORD_REUSE");
});

// F
test("a wrong current password is rejected before anything else", () => {
  const err = validatePasswordChange({
    current: "not-the-pilot-password",
    next: "aValidLongPassword123",
    storedHash: legacyHash,
  });
  assert.equal(err?.code, "PASSWORD_INVALID");
});

test("a mismatched confirmation is rejected on the client", () => {
  const err = validatePasswordChange({
    current: LEGACY_PILOT_PASSWORD,
    next: "aValidLongPassword123",
    confirm: "aValidLongPassword124",
  });
  assert.equal(err?.code, "PASSWORD_CONFIRM");
});

// G, H, I, J — the full rotation round trip
test("rotation stores a strong hash; old password dies, new password works", () => {
  const NEW = "KolamBioflok2026!";
  assert.equal(validatePasswordChange({
    current: LEGACY_PILOT_PASSWORD, next: NEW, confirm: NEW, storedHash: legacyHash,
  }), null);

  // G
  const rotated = strongPasswordHash(NEW);
  assert.equal(isStrongPasswordHash(rotated), true);
  assert.notEqual(rotated, legacyHash);
  assert.ok(!rotated.includes(NEW), "the hash must not embed the password");

  // H
  assert.equal(passwordMatches(LEGACY_PILOT_PASSWORD, rotated), false);
  // I
  assert.equal(passwordMatches(NEW, rotated), true);

  // J
  const session = sessionFor(rotated);
  assert.equal(session.requiresPasswordChange, false);
  assert.notEqual(session.view, null, "farm data is released once rotation is done");
});

test("each rotation salts independently", () => {
  const a = strongPasswordHash("KolamBioflok2026!");
  const b = strongPasswordHash("KolamBioflok2026!");
  assert.notEqual(a, b);
  assert.equal(passwordMatches("KolamBioflok2026!", a), true);
  assert.equal(passwordMatches("KolamBioflok2026!", b), true);
});

test("the local preview backend does not force rotation", () => {
  assert.equal(requiresPasswordUpgrade(legacyHash, "neon"), true);
  assert.equal(requiresPasswordUpgrade(legacyHash, "pglite"), false);
});
