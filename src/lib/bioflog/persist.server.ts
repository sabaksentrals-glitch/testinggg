import { dbSource, getSql, type Sql } from "@/lib/db";
import { hashPassword } from "./engine";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "./types";
import type {
  Allocation,
  Approval,
  AuditRow,
  Command,
  CostRow,
  Cycle,
  Database,
  Device,
  Farm,
  HarvestLot,
  Incident,
  Invoice,
  Lot,
  Order,
  Payment,
  Period,
  Pond,
  PopMove,
  RecordRow,
  Sop,
  StockMove,
  Task,
  Telemetry,
  User,
} from "./types";

export type FarmLoad = {
  source: "neon" | "pglite";
  db: Database | null;
  pondCount: number;
  updatedAt: string | null;
};

function asDb(payload: unknown): Database | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Database;
  if (!p.farm?.id || !Array.isArray(p.ponds) || !Array.isArray(p.users)) return null;
  return withDemoLogins(p);
}

function withDemoLogins(db: Database): Database {
  const hash = hashPassword(DEMO_PASSWORD);
  const emails = new Set(DEMO_ACCOUNTS.map((a) => a.email));
  return {
    ...db,
    users: db.users.map((u) => (emails.has(u.email) ? { ...u, password_hash: hash } : u)),
  };
}

function jsonVal<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

async function importFromRelational(sql: Sql): Promise<Database | null> {
  const farms = await sql<Farm>`select * from farms order by id limit 1`;
  if (!farms.length) return null;
  const [users, ponds, cycles, records, population, stock, lots, costs, tasks, approvals, devices, commands, telemetry, incidents, harvestLots, allocations, orders, invoices, payments, periods, sops, audit] =
    await Promise.all([
      sql<User>`select * from users`,
      sql<Pond>`select * from ponds order by code`,
      sql<Cycle>`select * from cycles`,
      sql<RecordRow>`select * from records`,
      sql<PopMove>`select * from population_events`,
      sql<StockMove>`select * from stock_movements`,
      sql<Lot>`select * from lots`,
      sql<CostRow>`select * from cycle_costs`,
      sql<Task>`select * from tasks`,
      sql<Approval>`select * from approvals`,
      sql<Device>`select * from devices`,
      sql<Command>`select * from device_commands`,
      sql<Telemetry>`select * from telemetry`,
      sql<Incident>`select * from incidents`,
      sql<HarvestLot>`select * from harvest_lots`,
      sql<Allocation>`select * from allocations`,
      sql<Order>`select * from sales_orders`,
      sql<Invoice>`select * from invoices`,
      sql<Payment>`select * from payments`,
      sql<Period>`select * from locked_periods`,
      sql<Sop>`select * from sop_versions`,
      sql<AuditRow>`select * from audit_events`,
    ]);
  return withDemoLogins({
    farm: farms[0],
    users,
    ponds,
    cycles: cycles.map((c) => ({
      ...c,
      status: c.status === "closed" ? "closed" : "active",
    })),
    records: records.map((r) => ({ ...r, data: jsonVal(r.data, {}) })),
    population,
    stock,
    lots,
    costs,
    tasks: tasks.map((t) => ({
      ...t,
      checklist: jsonVal(t.checklist, []),
    })),
    approvals: approvals.map((a) => ({
      ...a,
      payload: jsonVal(a.payload, {}),
    })),
    devices,
    commands,
    telemetry: telemetry.map((t) => ({ ...t, data: jsonVal(t.data, {}) })),
    incidents,
    harvestLots,
    allocations,
    orders,
    invoices,
    payments,
    periods,
    sops,
    audit: audit.map((a) => ({
      ...a,
      before: jsonVal(a.before, {}),
      after: jsonVal(a.after, {}),
    })),
  });
}

async function saveSnapshot(sql: Sql, db: Database) {
  await sql.query(
    `insert into bioflog_state (id, payload, updated_at)
     values ('default', $1::jsonb, now())
     on conflict (id) do update set payload = excluded.payload, updated_at = now()`,
    [JSON.stringify(db)],
  );
}

export async function loadFarmStateFromDb(): Promise<FarmLoad> {
  const sql = await getSql();
  const rows = await sql<{ payload: unknown; updated_at: string }>`
    select payload, updated_at from bioflog_state where id = 'default'
  `;
  const existing = rows[0] ? asDb(rows[0].payload) : null;
  if (existing) {
    return {
      source: dbSource,
      db: existing,
      pondCount: existing.ponds.length,
      updatedAt: rows[0]?.updated_at ?? null,
    };
  }
  try {
    const imported = await importFromRelational(sql);
    if (imported) {
      await saveSnapshot(sql, imported);
      return {
        source: dbSource,
        db: imported,
        pondCount: imported.ponds.length,
        updatedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    console.error("[bioflog] relational import skipped:", err);
  }
  return { source: dbSource, db: null, pondCount: 0, updatedAt: null };
}

export async function saveFarmStateToDb(db: Database): Promise<FarmLoad> {
  const sql = await getSql();
  await saveSnapshot(sql, db);
  return {
    source: dbSource,
    db,
    pondCount: db.ponds.length,
    updatedAt: new Date().toISOString(),
  };
}
