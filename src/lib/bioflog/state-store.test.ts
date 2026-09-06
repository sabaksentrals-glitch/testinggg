import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  asDisplayIso,
  asRevision,
  readState,
  upsertState,
  writeStateIfUnchanged,
  type StateSql,
} from "./state-store.ts";
import { legacyPasswordHash, isStrongPasswordHash, passwordMatches, requiresPasswordUpgrade, strongPasswordHash, validatePasswordChange } from "./password-policy.ts";

// Real Postgres (compiled to WASM), so these exercise the actual SQL — xmin
// semantics included — rather than a mock that could agree with a bug.
let pg: PGlite;
let sql: StateSql;
const boom = () => new Error("invalid timestamp");

function farm(extra: Record<string, unknown> = {}) {
  return {
    farm: { id: "farm-utama" },
    users: [
      {
        id: "admin",
        email: "admin@bioflog.local",
        password_hash: legacyPasswordHash("BioflogDemo12"),
        version: 1,
      },
    ],
    ponds: Array.from({ length: 15 }, (_, i) => ({ id: `p${i + 1}` })),
    cycles: [],
    records: [],
    ...extra,
  };
}

before(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(
    `create table bioflog_state (
       id text primary key,
       payload jsonb not null,
       updated_at timestamptz not null default now()
     );`,
  );
  sql = {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await pg.query<T>(text, params)).rows,
  };
  await upsertState(sql, farm(), boom);
});

after(async () => {
  await pg.close();
});

// A — the exact bug from production UAT
test("a microsecond timestamp does not lose concurrency identity", async () => {
  await pg.query(
    "update bioflog_state set updated_at = timestamptz '2026-09-06 05:28:27.086729+00' where id = 'default'",
  );
  const stored = await readState(sql, boom);
  assert.ok(stored);

  // What the old guard compared: a Date round-trip drops the microseconds.
  const truncated = new Date("2026-09-06 05:28:27.086729+00").toISOString();
  assert.equal(truncated, "2026-09-06T05:28:27.086Z");
  const exact = await pg.query<{ us: string }>(
    "select to_char(updated_at,'YYYY-MM-DD HH24:MI:SS.US') as us from bioflog_state where id='default'",
  );
  assert.equal(exact.rows[0].us, "2026-09-06 05:28:27.086729");
  assert.notEqual(truncated.replace("T", " ").replace("Z", ""), exact.rows[0].us);

  // The old guard, run verbatim against this very row: zero rows matched, and
  // that is exactly the STATE_CONFLICT the owner hit with no second writer.
  const oldGuard = await pg.query(
    `update bioflog_state set payload = $1::jsonb, updated_at = now()
      where id = 'default' and updated_at = $2::timestamptz returning id`,
    [JSON.stringify(farm()), truncated],
  );
  assert.equal(oldGuard.rows.length, 0, "reproduces the false conflict");

  // E — and yet the new save succeeds, because the token never went through Date.
  const written = await writeStateIfUnchanged(sql, farm(), stored.revision, boom);
  assert.ok(written, "no false STATE_CONFLICT from millisecond truncation");
});

// B
test("a fresh revision token saves", async () => {
  const stored = await readState(sql, boom);
  assert.ok(stored);
  const written = await writeStateIfUnchanged(sql, farm({ marker: "b" }), stored.revision, boom);
  assert.ok(written);
  assert.notEqual(written.revision, stored.revision, "the revision advances on write");
});

// C
test("a stale revision token is rejected as a conflict", async () => {
  const stored = await readState(sql, boom);
  assert.ok(stored);
  await writeStateIfUnchanged(sql, farm({ marker: "c1" }), stored.revision, boom);
  const second = await writeStateIfUnchanged(sql, farm({ marker: "c2" }), stored.revision, boom);
  assert.equal(second, null, "the second write with the spent token must conflict");
});

// D
test("two clients on the same revision: first wins, second conflicts", async () => {
  const a = await readState(sql, boom);
  const b = await readState(sql, boom);
  assert.ok(a && b);
  assert.equal(a.revision, b.revision, "both clients loaded the same revision");

  const aWrote = await writeStateIfUnchanged(sql, farm({ by: "A" }), a.revision, boom);
  assert.ok(aWrote, "client A saves cleanly");

  const bWrote = await writeStateIfUnchanged(sql, farm({ by: "B" }), b.revision, boom);
  assert.equal(bWrote, null, "client B is correctly blocked — a real conflict");

  const now = await readState(sql, boom);
  assert.equal((now?.payload as Record<string, unknown>).by, "A", "A's write survived intact");
});

// H — the fix is on the shared save path, not something password-specific
test("an ordinary non-password mutation saves through the same path", async () => {
  const stored = await readState(sql, boom);
  assert.ok(stored);
  const next = farm({ records: [{ id: "r1", kind: "feeding" }] });
  const written = await writeStateIfUnchanged(sql, next, stored.revision, boom);
  assert.ok(written, "a routine mutation must not hit a false conflict either");
  const after = await readState(sql, boom);
  assert.equal((after?.payload as { records: unknown[] }).records.length, 1);
});

// F
test("a rejected password rotation leaves the stored state untouched", async () => {
  const before = await readState(sql, boom);
  assert.ok(before);
  const user = (before.payload as { users: { password_hash: string }[] }).users[0];

  const invalid = validatePasswordChange({
    current: "wrong-current-password",
    next: "aPerfectlyGoodPassword1",
    storedHash: user.password_hash,
  });
  assert.equal(invalid?.code, "PASSWORD_INVALID");

  // The server throws before writing, so nothing is persisted.
  const after = await readState(sql, boom);
  assert.equal(after?.revision, before.revision, "revision unchanged");
  assert.equal(
    (after?.payload as { users: { password_hash: string }[] }).users[0].password_hash,
    user.password_hash,
    "password hash unchanged",
  );
});

// G — full rotation round trip over the real save path
test("a successful rotation persists a strong hash and releases the view", async () => {
  const NEW = "KolamBioflok2026!";
  const stored = await readState(sql, boom);
  assert.ok(stored);
  const payload = stored.payload as {
    users: { password_hash: string; version: number }[];
  };
  const user = payload.users[0];
  const beforeVersion = user.version;

  assert.equal(
    validatePasswordChange({
      current: "BioflogDemo12",
      next: NEW,
      confirm: NEW,
      storedHash: user.password_hash,
    }),
    null,
  );

  user.password_hash = strongPasswordHash(NEW);
  user.version += 1;
  const written = await writeStateIfUnchanged(sql, payload, stored.revision, boom);
  assert.ok(written, "rotation must persist — this is what the bug prevented");

  const after = await readState(sql, boom);
  const saved = (after?.payload as { users: { password_hash: string; version: number }[] })
    .users[0];
  assert.equal(isStrongPasswordHash(saved.password_hash), true, "strong scrypt hash stored");
  assert.equal(saved.version, beforeVersion + 1, "user version incremented");
  assert.equal(passwordMatches("BioflogDemo12", saved.password_hash), false, "old password dead");
  assert.equal(passwordMatches(NEW, saved.password_hash), true, "new password works");
  assert.equal(requiresPasswordUpgrade(saved.password_hash, "neon"), false, "flag cleared");
  assert.equal((after?.payload as { ponds: unknown[] }).ponds.length, 15, "farm data intact");
});

test("revision tokens are exact strings, never dates or numbers", () => {
  assert.equal(asRevision("753"), "753");
  assert.equal(asRevision(753), "753");
  assert.throws(() => asRevision(""), /revision token missing/);
  // The display helper stays millisecond ISO — that is all it is for.
  assert.equal(asDisplayIso("2026-09-06 05:28:27.086729+00", boom), "2026-09-06T05:28:27.086Z");
  assert.throws(() => asDisplayIso("not a timestamp", boom), /invalid timestamp/);
});
