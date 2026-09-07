import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  SESSION_INVALID_CODES,
  isSessionInvalid,
  mutationFailureAction,
} from "./mutation-contract.ts";

/** Mirrors `Problem` in engine.ts / store.ts: code + status ride on the error. */
class Problem extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * The exact control flow of the Editor submit handler in app.tsx: await the
 * mutation, and only then report success and close. Driving it with a stub
 * mutate proves the ordering guarantee the async contract provides.
 *
 * This validates the contract shape, not the rendered React component — there
 * is no component test framework in this repo and the mission forbids adding
 * one.
 */
async function runSubmit(mutate: () => Promise<Record<string, unknown>>) {
  const calls: string[] = [];
  let shown = "";
  let error = "";
  try {
    const r = await mutate();
    calls.push("awaited");
    if (r.provisioning_token) {
      shown = String(r.provisioning_token);
      calls.push("token-shown");
      return { calls, shown, error };
    }
    calls.push("onDone");
    calls.push("onClose");
  } catch (err) {
    error = err instanceof Error ? err.message : "unknown";
    calls.push("caught");
  }
  return { calls, shown, error };
}

/** What the store does with its state after a failure. */
function applyFailure(
  before: { sessionToken: string | null; userData: object | null; view: object | null },
  error: unknown,
) {
  const outcome = mutationFailureAction(error, "Perubahan ditolak server dan tidak disimpan.");
  return outcome.clearSession
    ? { sessionToken: null, userData: null, view: null, syncError: outcome.syncError }
    : { ...before, syncError: outcome.syncError };
}

const SESSION = { sessionToken: "tok", userData: { id: "admin" }, view: { farm: "farm-utama" } };

// A — successful mutation
test("A: success is reported only after the awaited server response", async () => {
  let resolved = false;
  const { calls, error } = await runSubmit(async () => {
    await Promise.resolve();
    resolved = true;
    return { id: "r1" };
  });
  assert.equal(resolved, true, "server call completed before anything else ran");
  assert.deepEqual(calls, ["awaited", "onDone", "onClose"]);
  assert.equal(error, "");
});

// B — validation / domain rejection (422)
test("B: a 422 domain rejection keeps the session and does not report success", async () => {
  const err = new Problem("INVALID_FIELD", "code: isi teks 1–30 karakter.");
  const { calls, error } = await runSubmit(async () => {
    throw err;
  });
  assert.deepEqual(calls, ["caught"], "no onDone, no onClose");
  assert.equal(error, "code: isi teks 1–30 karakter.");
  const after = applyFailure(SESSION, err);
  assert.equal(after.sessionToken, "tok");
  assert.deepEqual(after.userData, SESSION.userData);
  assert.deepEqual(after.view, SESSION.view);
});

// C — permission failure (403)
test("C: a 403 permission failure never logs the operator out", () => {
  for (const code of [
    "FORBIDDEN",
    "FORBIDDEN_SCOPE",
    "FINANCE_FORBIDDEN",
    "DEVICE_PERMISSION",
    "PASSWORD_CHANGE_REQUIRED",
    "PASSWORD_INVALID",
  ]) {
    const err = new Problem(code, "denied", 403);
    assert.equal(isSessionInvalid(err), false, `${code} must not clear the session`);
    assert.equal(applyFailure(SESSION, err).sessionToken, "tok", `${code} kept the session`);
  }
});

// D — concurrency conflict (409)
test("D: a 409 conflict keeps the session and the current view", () => {
  for (const code of ["STATE_CONFLICT", "VERSION_CONFLICT", "PERIOD_LOCKED", "SAVE_BUSY"]) {
    const err = new Problem(code, "Data berubah dari sesi lain.", 409);
    assert.equal(isSessionInvalid(err), false);
    const after = applyFailure(SESSION, err);
    assert.equal(after.sessionToken, "tok");
    assert.deepEqual(after.view, SESSION.view, `${code} preserved the view`);
    assert.equal(after.syncError, "Data berubah dari sesi lain.");
  }
});

// E — genuine session invalidation (401)
test("E: a 401 session failure clears session, user and view", () => {
  for (const code of SESSION_INVALID_CODES) {
    const err = new Problem(code, "Sesi berakhir. Masuk kembali.", 401);
    assert.equal(isSessionInvalid(err), true, `${code} must clear the session`);
    const after = applyFailure(SESSION, err);
    assert.equal(after.sessionToken, null);
    assert.equal(after.userData, null);
    assert.equal(after.view, null);
  }
});

test("E2: an unlisted error carrying HTTP 401 still clears the session", () => {
  assert.equal(isSessionInvalid(new Problem("SOMETHING_NEW", "nope", 401)), true);
});

test("E3: 503 infrastructure errors keep the session", () => {
  for (const code of ["STATE_UNAVAILABLE", "STATE_TIMESTAMP", "DATABASE_REQUIRED"]) {
    assert.equal(isSessionInvalid(new Problem(code, "down", 503)), false);
  }
});

test("E4: an unrecognised error keeps the session rather than destroying work", () => {
  assert.equal(isSessionInvalid(new Error("network blip")), false);
  assert.equal(isSessionInvalid(undefined), false);
  assert.equal(isSessionInvalid("boom"), false);
  assert.equal(applyFailure(SESSION, new Error("network blip")).sessionToken, "tok");
});

// F — modal submit contract
test("F: a rejected mutation calls neither onDone nor onClose", async () => {
  const { calls } = await runSubmit(async () => {
    throw new Problem("PERIOD_LOCKED", "Tanggal berada pada periode terkunci.", 409);
  });
  assert.ok(!calls.includes("onDone"), "success callback must not fire");
  assert.ok(!calls.includes("onClose"), "form must stay open so input survives");
});

// G — provisioning token
test("G: a provisioning token is surfaced after success and keeps the form open", async () => {
  const { calls, shown } = await runSubmit(async () => ({
    id: "d1",
    provisioning_token: "tok-once-123",
  }));
  assert.equal(shown, "tok-once-123", "token still reaches the operator");
  assert.ok(calls.includes("awaited"), "only after the server confirmed");
  assert.ok(!calls.includes("onClose"), "form stays open so the token can be copied");
});

test("G2: the failure path never carries a token", () => {
  const outcome = mutationFailureAction(new Problem("FORBIDDEN", "denied", 403), "fallback");
  assert.equal(outcome.clearSession, false);
  assert.ok(!outcome.syncError.includes("tok-"), "no token leaks into the error surface");
});

test("the fallback message is used when the error carries none", () => {
  assert.equal(mutationFailureAction({}, "fallback").syncError, "fallback");
});
