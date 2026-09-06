import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { dbSource, getSql, type Sql } from "@/lib/db";
import {
  DEMO_PASSWORD,
  type Database,
  type Row,
  type User,
} from "./types";
import {
  Problem,
  auditLog,
  dispatch,
  hashPassword,
  login as engineLogin,
  seedDemo,
  snapshot,
} from "./engine";

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const DEMO_PASSWORD_HASH = hashPassword(DEMO_PASSWORD);

type StoredState = {
  db: Database;
  sql: Sql;
  updatedAt: string;
};

type SessionClaims = {
  uid: string;
  uv: number;
  exp: number;
  restricted?: 1;
};

type ClientView = Row & {
  __finance?: {
    invoices: Database["invoices"];
    payments: Database["payments"];
    costs: Database["costs"];
    orders: Database["orders"];
    periods: Database["periods"];
    timezone: string;
  };
  __audit?: Row[];
};

const globalSession = globalThis as typeof globalThis & {
  __bioflogLocalSessionSecret__?: Buffer;
};

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Problem("STATE_TIMESTAMP", "Timestamp state database tidak valid.", 503);
  }
  return parsed.toISOString();
}

function asDatabase(payload: unknown): Database | null {
  let candidate = payload;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object") return null;
  const db = candidate as Database;
  if (
    !db.farm?.id ||
    !Array.isArray(db.users) ||
    !Array.isArray(db.ponds) ||
    !Array.isArray(db.cycles) ||
    !Array.isArray(db.records)
  ) {
    return null;
  }
  return db;
}

function assertDeploymentDatabase(): void {
  if (process.env.VERCEL === "1" && dbSource !== "neon") {
    throw new Problem(
      "DATABASE_REQUIRED",
      "Deployment Vercel tidak memiliki DATABASE_URL Neon. Aplikasi dihentikan agar tidak memakai database demo sementara.",
      503,
    );
  }
}

async function loadStoredState(): Promise<StoredState> {
  assertDeploymentDatabase();
  const sql = await getSql();
  const rows = await sql.query<{ payload: unknown; updated_at: unknown }>(
    "select payload, updated_at from bioflog_state where id = 'default'",
  );
  const row = rows[0];
  const db = row ? asDatabase(row.payload) : null;
  if (db && row) {
    return { db, sql, updatedAt: asIso(row.updated_at) };
  }

  // Demo/local development may bootstrap itself. A real Neon database never
  // reconstructs state from the stale relational mirror and never accepts an
  // implicit demo seed.
  if (dbSource === "pglite" && process.env.VERCEL !== "1") {
    const seeded = seedDemo();
    const inserted = await sql.query<{ updated_at: unknown }>(
      `insert into bioflog_state (id, payload, updated_at)
       values ('default', $1::jsonb, now())
       on conflict (id) do update set payload = excluded.payload, updated_at = now()
       returning updated_at`,
      [JSON.stringify(seeded)],
    );
    return {
      db: seeded,
      sql,
      updatedAt: asIso(inserted[0]?.updated_at ?? new Date()),
    };
  }

  throw new Problem(
    "STATE_UNAVAILABLE",
    "State produksi BIOFLOG tidak tersedia atau tidak valid. Tidak ada fallback ke data relasional/demo.",
    503,
  );
}

async function saveStoredState(
  sql: Sql,
  db: Database,
  expectedUpdatedAt: string,
): Promise<string> {
  const rows = await sql.query<{ updated_at: unknown }>(
    `update bioflog_state
        set payload = $1::jsonb, updated_at = now()
      where id = 'default' and updated_at = $2::timestamptz
      returning updated_at`,
    [JSON.stringify(db), expectedUpdatedAt],
  );
  if (!rows.length) {
    throw new Problem(
      "STATE_CONFLICT",
      "Data berubah dari sesi lain. Muat ulang lalu ulangi tindakan agar perubahan tidak saling menimpa.",
      409,
    );
  }
  return asIso(rows[0].updated_at);
}

function sessionSecret(): Buffer {
  const explicit =
    process.env.BIOFLOG_SESSION_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (explicit) return createHash("sha256").update(explicit).digest();

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    // Keeps the token key server-only even before a dedicated session secret is
    // provisioned. Rotating the database credential intentionally revokes every
    // outstanding session. BIOFLOG_SESSION_SECRET remains the preferred key.
    return createHash("sha256")
      .update("bioflog-session-v1\0")
      .update(databaseUrl)
      .digest();
  }

  globalSession.__bioflogLocalSessionSecret__ ??= randomBytes(32);
  return globalSession.__bioflogLocalSessionSecret__;
}

function signClaims(claims: SessionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function parseClaims(token: string): SessionClaims {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) {
    throw new Problem("SESSION_INVALID", "Sesi tidak valid. Masuk kembali.", 401);
  }
  const expected = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    throw new Problem("SESSION_INVALID", "Sesi tidak valid. Masuk kembali.", 401);
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Problem("SESSION_INVALID", "Sesi tidak valid. Masuk kembali.", 401);
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    throw new Problem("SESSION_INVALID", "Sesi tidak valid. Masuk kembali.", 401);
  }
  if (
    !claims.uid ||
    !Number.isInteger(claims.uv) ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new Problem("SESSION_EXPIRED", "Sesi berakhir. Masuk kembali.", 401);
  }
  return claims;
}

function publicUser(user: User): Row {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    block: user.block,
    active: user.active,
    finance: user.finance,
    device_control: user.device_control,
    version: user.version,
  };
}

function makeSession(user: User, restricted = false): string {
  return signClaims({
    uid: user.id,
    uv: user.version,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    ...(restricted ? { restricted: 1 as const } : {}),
  });
}

function sessionUser(db: Database, token: string): { user: User; claims: SessionClaims } {
  const claims = parseClaims(token);
  const user = db.users.find((candidate) => candidate.id === claims.uid && candidate.active);
  if (!user || user.version !== claims.uv) {
    throw new Problem(
      "SESSION_REVOKED",
      "Akun atau hak akses berubah. Masuk kembali untuk melanjutkan.",
      401,
    );
  }
  return { user, claims };
}

function clientView(db: Database, user: User): ClientView {
  const view = snapshot(db, user) as ClientView;
  view.demo = dbSource !== "neon";
  view.standalone = false;

  if (user.finance && user.block === "*") {
    view.__finance = {
      invoices: db.invoices,
      payments: db.payments,
      costs: db.costs,
      orders: db.orders,
      periods: db.periods,
      timezone: db.farm.timezone,
    };
  }
  if (user.role === "Admin" && user.block === "*") {
    view.__audit = auditLog(db, user);
  }
  return view;
}

function loginCutoff(): string {
  return new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
}

async function assertLoginRate(sql: Sql, email: string): Promise<void> {
  const rows = await sql.query<{ failures: number | string }>(
    `select count(*) as failures
       from login_attempts
      where lower(email) = lower($1)
        and success = 0
        and occurred_at >= $2`,
    [email, loginCutoff()],
  );
  if (Number(rows[0]?.failures ?? 0) >= LOGIN_MAX_FAILURES) {
    throw new Problem(
      "LOGIN_RATE_LIMIT",
      "Terlalu banyak percobaan masuk. Tunggu 15 menit lalu coba lagi.",
      429,
    );
  }
}

async function recordLoginAttempt(
  sql: Sql,
  email: string,
  success: boolean,
): Promise<void> {
  await sql.query(
    "insert into login_attempts (id, email, occurred_at, success) values ($1, $2, $3, $4)",
    [randomUUID(), email, new Date().toISOString(), success ? 1 : 0],
  );
}

export async function farmStatus() {
  assertDeploymentDatabase();
  try {
    const state = await loadStoredState();
    return {
      source: dbSource,
      available: true,
      pondCount: state.db.ponds.length,
      updatedAt: state.updatedAt,
    };
  } catch (error) {
    if (error instanceof Problem && error.code === "STATE_UNAVAILABLE") {
      return {
        source: dbSource,
        available: false,
        pondCount: 0,
        updatedAt: null,
        message: error.message,
      };
    }
    throw error;
  }
}

export async function loginFarmSession(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const state = await loadStoredState();
  await assertLoginRate(state.sql, email);

  let user: User;
  try {
    user = engineLogin(state.db, email, password);
  } catch (error) {
    await recordLoginAttempt(state.sql, email, false);
    throw error;
  }
  await recordLoginAttempt(state.sql, email, true);

  const requiresPasswordChange =
    dbSource === "neon" && user.password_hash === DEMO_PASSWORD_HASH;
  return {
    source: dbSource,
    pondCount: state.db.ponds.length,
    updatedAt: state.updatedAt,
    sessionToken: makeSession(user, requiresPasswordChange),
    requiresPasswordChange,
    user: publicUser(user),
    view: requiresPasswordChange ? null : clientView(state.db, user),
  };
}

export async function resumeFarmSession(sessionToken: string) {
  const state = await loadStoredState();
  const { user, claims } = sessionUser(state.db, sessionToken);
  const requiresPasswordChange =
    dbSource === "neon" && user.password_hash === DEMO_PASSWORD_HASH;
  return {
    source: dbSource,
    pondCount: state.db.ponds.length,
    updatedAt: state.updatedAt,
    sessionToken: makeSession(user, requiresPasswordChange || claims.restricted === 1),
    requiresPasswordChange,
    user: publicUser(user),
    view: requiresPasswordChange ? null : clientView(state.db, user),
  };
}

export async function mutateFarmSession(
  sessionToken: string,
  action: string,
  payload: Row,
) {
  const state = await loadStoredState();
  const { user, claims } = sessionUser(state.db, sessionToken);
  if (claims.restricted === 1 && action !== "users/password") {
    throw new Problem(
      "PASSWORD_CHANGE_REQUIRED",
      "Password demo publik wajib diganti sebelum akun dapat mengubah data farm.",
      403,
    );
  }

  const result = dispatch(state.db, user, action, payload);
  const updatedAt = await saveStoredState(state.sql, state.db, state.updatedAt);
  const currentUser = state.db.users.find((candidate) => candidate.id === user.id && candidate.active);
  if (!currentUser) {
    throw new Problem("SESSION_REVOKED", "Akun tidak lagi aktif.", 401);
  }
  const requiresPasswordChange =
    dbSource === "neon" && currentUser.password_hash === DEMO_PASSWORD_HASH;

  return {
    source: dbSource,
    pondCount: state.db.ponds.length,
    updatedAt,
    sessionToken: makeSession(currentUser, requiresPasswordChange),
    requiresPasswordChange,
    result,
    view: requiresPasswordChange ? null : clientView(state.db, currentUser),
  };
}
