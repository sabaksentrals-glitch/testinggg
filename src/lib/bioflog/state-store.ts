/**
 * Reading and writing the authoritative `bioflog_state` row, with an exact
 * optimistic-concurrency token.
 *
 * Why this module exists: the previous guard compared `updated_at` after it had
 * been round-tripped through `new Date(...).toISOString()`, which truncates to
 * milliseconds. Postgres stores microseconds, so a row written at
 * `05:28:27.086729` was read back as `05:28:27.086`, and the UPDATE's
 * `updated_at = $2` matched zero rows — a STATE_CONFLICT with no second writer
 * anywhere. Every mutation on this path could fail that way, not just password
 * rotation.
 *
 * The fix separates the two jobs that one timestamp was doing:
 *   - `updatedAt`  — display metadata only. Millisecond ISO is fine.
 *   - `revision`   — the concurrency token. Postgres' MVCC `xmin`, carried as
 *                    text, compared as text, and NEVER parsed as a Date.
 *
 * The token goes out of the database and comes back unchanged, so the compare
 * is exact. This needs no schema migration: `xmin` is a system column every
 * Postgres row already has, and it changes on every UPDATE, which is precisely
 * the version semantics we want.
 *
 * Kept free of `@/lib/db` so the test runner can import it — `secure.server.ts`
 * cannot be loaded outside a bundler.
 */

/** The slice of the app's SQL client this module needs. */
export type StateSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/** Opaque exact-compare concurrency token. Never send it to the browser. */
export type StateRevision = string;

export type StateRead = {
  payload: unknown;
  updatedAt: string;
  revision: StateRevision;
};

export type StateWrite = {
  updatedAt: string;
  revision: StateRevision;
};

export const SELECT_STATE_SQL =
  "select payload, updated_at, xmin::text as state_revision from bioflog_state where id = 'default'";

export const UPDATE_STATE_SQL = `update bioflog_state
        set payload = $1::jsonb, updated_at = now()
      where id = 'default' and xmin::text = $2
      returning updated_at, xmin::text as state_revision`;

export const UPSERT_STATE_SQL = `insert into bioflog_state (id, payload, updated_at)
     values ('default', $1::jsonb, now())
     on conflict (id) do update set payload = excluded.payload, updated_at = now()
     returning updated_at, xmin::text as state_revision`;

/**
 * Normalise a revision token. Text in, identical text out — deliberately NOT a
 * Date, a number, or anything else lossy.
 */
export function asRevision(value: unknown): StateRevision {
  const revision = typeof value === "string" ? value : String(value ?? "");
  if (!revision) throw new Error("bioflog_state revision token missing");
  return revision;
}

/** Display timestamp. Millisecond precision is acceptable here and only here. */
export function asDisplayIso(value: unknown, onInvalid: () => Error): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw onInvalid();
  return parsed.toISOString();
}

export async function readState(
  sql: StateSql,
  onInvalidTimestamp: () => Error,
): Promise<StateRead | null> {
  const rows = await sql.query<{
    payload: unknown;
    updated_at: unknown;
    state_revision: unknown;
  }>(SELECT_STATE_SQL);
  const row = rows[0];
  if (!row) return null;
  return {
    payload: row.payload,
    updatedAt: asDisplayIso(row.updated_at, onInvalidTimestamp),
    revision: asRevision(row.state_revision),
  };
}

/**
 * Write only if the row is still at `expectedRevision`.
 *
 * Returns null when the row moved on — a REAL conflict, since the token came
 * straight from Postgres and was never reformatted.
 */
export async function writeStateIfUnchanged(
  sql: StateSql,
  payload: unknown,
  expectedRevision: StateRevision,
  onInvalidTimestamp: () => Error,
): Promise<StateWrite | null> {
  const rows = await sql.query<{ updated_at: unknown; state_revision: unknown }>(
    UPDATE_STATE_SQL,
    [JSON.stringify(payload), expectedRevision],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    updatedAt: asDisplayIso(row.updated_at, onInvalidTimestamp),
    revision: asRevision(row.state_revision),
  };
}

/** Local/preview bootstrap only — callers gate this on the backend. */
export async function upsertState(
  sql: StateSql,
  payload: unknown,
  onInvalidTimestamp: () => Error,
): Promise<StateWrite> {
  const rows = await sql.query<{ updated_at: unknown; state_revision: unknown }>(
    UPSERT_STATE_SQL,
    [JSON.stringify(payload)],
  );
  const row = rows[0];
  if (!row) throw onInvalidTimestamp();
  return {
    updatedAt: asDisplayIso(row.updated_at, onInvalidTimestamp),
    revision: asRevision(row.state_revision),
  };
}
