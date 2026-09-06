import type {
  Cycle,
  Database,
  Lot,
  Pond,
  RecordRow,
  Row,
  User,
} from "./types";
import { DEMO_PASSWORD } from "./types";

export class Problem extends Error {
  code: string;
  status: number;
  fields: Row;
  constructor(code: string, message: string, status = 422, fields: Row = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export function fail(code: string, message: string, status = 422): never {
  throw new Problem(code, message, status);
}

export const PARAMETERS: Record<string, [string, string, string]> = {
  ph: ["pH", "0", "14"],
  do: ["mg/L", "0", "50"],
  temperature: ["°C", "0", "60"],
  floc: ["mL/L", "0", "1000"],
  tan: ["mg/L", "0", "1000"],
  alkalinity: ["mg/L CaCO3", "0", "10000"],
};

export function hashPassword(password: string): string {
  let h = 2166136261;
  const s = "bioflog:" + password;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);

export const now = () => new Date().toISOString();

function canonical(v: unknown) {
  return JSON.stringify(v, Object.keys(v as object).sort());
}

function payloadHash(v: unknown) {
  return hashPassword(canonical(v));
}

function txt(p: Row, k: string, def?: string, maxlen = 200): string {
  const v = p[k] ?? def;
  if (typeof v !== "string" || !v.trim() || v.length > maxlen)
    fail("INVALID_FIELD", `${k}: isi teks 1–${maxlen} karakter.`);
  return v.trim();
}

function optionalText(p: Row, k: string, maxlen = 2000) {
  const v = p[k] ?? "";
  if (typeof v !== "string" || v.length > maxlen)
    fail("INVALID_FIELD", `${k}: teks maksimum ${maxlen} karakter.`);
  return v.trim();
}

function integer(p: Row, k: string, minimum = 1, maximum = 1_000_000_000, def?: number) {
  const v = p[k] ?? def;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < minimum || n > maximum)
    fail("INVALID_FIELD", `${k} di luar batas ${minimum}–${maximum}.`);
  return n;
}

function decimal(p: Row, k: string, minimum = "0", maximum = "1000000000", positive = true) {
  const v = Number(String(p[k] ?? "").replace(",", "."));
  if (!Number.isFinite(v) || v < Number(minimum) || v > Number(maximum) || (positive && v === 0))
    fail("INVALID_FIELD", `${k}: angka di luar batas.`);
  return v;
}

function grams(p: Row, k = "kg") {
  const v = decimal(p, k) * 1000;
  if (Math.abs(v - Math.round(v)) > 1e-6)
    fail("PRECISION", `${k}: maksimum 3 angka desimal kg.`);
  return Math.round(v);
}

function money(g: number, price: number) {
  return Math.round((g * price) / 1000);
}

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("INVALID_DATE", "Tanggal harus memakai format YYYY-MM-DD, termasuk angka nol.");
  const d = new Date(value + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) fail("INVALID_DATE", "Tanggal tidak valid.");
  return value;
}

function stamp(value?: string | null, future = false) {
  const dt = value ? new Date(value) : new Date();
  if (Number.isNaN(dt.getTime())) fail("INVALID_TIME", "Format waktu ISO 8601 tidak valid.");
  if (!future && dt.getTime() > Date.now() + 5000)
    fail("FUTURE_ACTUAL", "Waktu aktual tidak boleh di masa depan.");
  return dt.toISOString();
}

function farmLocalDate(iso: string, tz: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
}

export function emptyDb(): Database {
  return {
    farm: { id: "farm-utama", name: "Farm Utama", timezone: "Asia/Jakarta", address: "Sabak Sentral", version: 1 },
    users: [],
    ponds: [],
    cycles: [],
    records: [],
    population: [],
    stock: [],
    lots: [],
    costs: [],
    tasks: [],
    approvals: [],
    devices: [],
    commands: [],
    telemetry: [],
    incidents: [],
    harvestLots: [],
    allocations: [],
    orders: [],
    invoices: [],
    payments: [],
    periods: [],
    sops: [],
    audit: [],
  };
}

function one<T extends { id: string }>(rows: T[], id: string): T | undefined {
  return rows.find((r) => r.id === id);
}

function publicUser(u: User): Row {
  const { password_hash: _, ...rest } = u;
  return { ...rest, finance: rest.finance && rest.block === "*" ? 1 : 0 };
}

function roleOk(u: User, ...allowed: string[]) {
  if (!allowed.includes(u.role)) fail("FORBIDDEN", "Peran Anda tidak diizinkan untuk aksi ini.", 403);
}

function manage(u: User) {
  roleOk(u, "Admin", "Manajer");
}
function write(u: User) {
  roleOk(u, "Admin", "Manajer", "Operator");
}
function finance(u: User) {
  if (!u.finance || u.block !== "*")
    fail("FINANCE_FORBIDDEN", "Diperlukan izin keuangan seluruh farm.", 403);
}

function authorize(u: User, action: string) {
  if (action === "users" || action === "users/update") {
    roleOk(u, "Admin");
    if (u.block !== "*") fail("FORBIDDEN_SCOPE", "Pengelolaan akun memerlukan cakupan seluruh farm.", 403);
  } else if (action === "users/password") {
    return;
  } else if (action === "lots" || action === "orders/ship" || action === "periods/lock") {
    finance(u);
    manage(u);
  } else if (action === "orders" || action === "payments" || action === "expenses") {
    finance(u);
    write(u);
  } else if (
    [
      "ponds",
      "cycles",
      "cycles/close",
      "fish-transfers",
      "harvests/post",
      "approvals/decide",
      "farm",
      "sops",
      "devices",
      "devices/rotate-token",
    ].includes(action)
  ) {
    manage(u);
  } else if (action === "device-commands") {
    write(u);
    if (!u.device_control) fail("DEVICE_PERMISSION", "Tidak ada izin kontrol perangkat.", 403);
  } else if (
    [
      "water-readings",
      "feed-events",
      "samplings",
      "mortalities",
      "health",
      "harvest-plans",
      "harvests",
      "tasks",
      "tasks/update",
      "approvals",
    ].includes(action)
  ) {
    write(u);
  } else fail("UNKNOWN_ACTION", "Aksi tidak dikenal.", 404);
  if ((action === "farm" || action === "sops") && u.block !== "*")
    fail("FORBIDDEN_SCOPE", "Aksi ini memerlukan cakupan seluruh farm.", 403);
}

function pondOf(db: Database, rec: { pond_id?: string; cycle_id?: string | null; device_id?: string; record_id?: string }) {
  if (rec.device_id) {
    const d = one(db.devices, rec.device_id);
    return d ? one(db.ponds, d.pond_id) : undefined;
  }
  if (rec.record_id) {
    const r = one(db.records, rec.record_id);
    if (r?.cycle_id) {
      const cy = one(db.cycles, r.cycle_id);
      return cy ? one(db.ponds, cy.pond_id) : undefined;
    }
  }
  if (rec.cycle_id) {
    const cy = one(db.cycles, rec.cycle_id);
    return cy ? one(db.ponds, cy.pond_id) : undefined;
  }
  if (rec.pond_id) return one(db.ponds, rec.pond_id);
  return undefined;
}

function obj<T extends { id: string; farm_id?: string }>(
  db: Database,
  rows: T[],
  id: string,
  u: User,
  pondCheck = false,
): T {
  const r = one(rows, id);
  if (!r || (r.farm_id && r.farm_id !== u.farm_id))
    fail("NOT_FOUND", "Objek tidak ditemukan dalam cakupan Anda.", 404);
  const po = pondOf(db, r as Row);
  if (po && u.block !== "*" && po.block !== u.block)
    fail("NOT_FOUND", "Objek tidak ditemukan dalam cakupan Anda.", 404);
  if (!po && pondCheck && u.block !== "*")
    fail("FORBIDDEN_SCOPE", "Aksi ini memerlukan cakupan seluruh farm.", 403);
  return r;
}

function version(r: { version: number }, p: Row) {
  if (integer(p, "expected_version") !== r.version)
    fail("VERSION_CONFLICT", "Data telah berubah. Muat ulang lalu tinjau kembali.", 409);
}

function openPeriod(db: Database, u: User, at: string) {
  const local = farmLocalDate(at, db.farm.timezone);
  if (db.periods.some((p) => local <= p.through_date))
    fail("PERIOD_LOCKED", "Tanggal berada pada periode terkunci.", 409);
}

function activeCycle(db: Database, u: User, id: string, at?: string) {
  const r = obj(db, db.cycles, id, u);
  if (r.status !== "active") fail("CYCLE_CLOSED", "Siklus sudah selesai.", 409);
  if (at && at < r.started_at) fail("BEFORE_CYCLE", "Tanggal sebelum awal siklus.");
  if (at) openPeriod(db, u, at);
  return r;
}

function balance(rows: { occurred_at: string }[], col: string, at?: string) {
  return rows.reduce((s, r) => s + (!(at && r.occurred_at > at) ? Number((r as Row)[col]) : 0), 0);
}

function historyNonneg(rows: { occurred_at: string }[], col: string) {
  const buckets: Record<string, number> = {};
  for (const r of rows) buckets[r.occurred_at] = (buckets[r.occurred_at] || 0) + Number((r as Row)[col]);
  let b = 0;
  for (const at of Object.keys(buckets).sort()) {
    b += buckets[at];
    if (b < 0)
      fail("BALANCE_CONFLICT", "Saldo historis tidak cukup; catatan tetap dapat diperbaiki.", 409);
  }
}

function insert<T extends { id: string }>(rows: T[], v: T): T {
  rows.push(v);
  return v;
}

function record(
  db: Database,
  u: User,
  kind: string,
  data: Row,
  at?: string,
  cycle_id: string | null = null,
  status = "posted",
  reversal_of: string | null = null,
): RecordRow {
  return insert(db.records, {
    id: uid(),
    farm_id: u.farm_id,
    cycle_id,
    kind,
    occurred_at: at || now(),
    created_at: now(),
    created_by: u.id,
    data,
    status,
    version: 1,
    reversal_of,
  });
}

function pop(db: Database, u: User, cy: Cycle, r: RecordRow, count: number, g = 0, cohort?: string) {
  insert(db.population, {
    id: uid(),
    farm_id: u.farm_id,
    cycle_id: cy.id,
    record_id: r.id,
    count,
    grams: g,
    cohort: cohort || cy.seed_batch,
    occurred_at: r.occurred_at,
  });
  historyNonneg(
    db.population.filter((x) => x.cycle_id === cy.id),
    "count",
  );
}

function stockMove(db: Database, u: User, lot: Lot, r: RecordRow, g: number) {
  insert(db.stock, {
    id: uid(),
    farm_id: u.farm_id,
    lot_id: lot.id,
    record_id: r.id,
    grams: g,
    occurred_at: r.occurred_at,
  });
  historyNonneg(
    db.stock.filter((x) => x.lot_id === lot.id),
    "grams",
  );
}

function cost(db: Database, u: User, r: RecordRow, amount: number, category: string) {
  insert(db.costs, {
    id: uid(),
    farm_id: u.farm_id,
    cycle_id: r.cycle_id,
    record_id: r.id,
    amount,
    category,
    occurred_at: r.occurred_at,
  });
}

function log(db: Database, u: User, action: string, id: string, after: Row, before: Row = {}) {
  insert(db.audit, {
    id: uid(),
    farm_id: u.farm_id,
    actor_id: u.id,
    action,
    object_id: id,
    occurred_at: now(),
    before,
    after,
    request_id: uid(),
  });
}

function feed(db: Database, u: User, p: Row, reversalOf: string | null = null) {
  write(u);
  const at = stamp(p.occurred_at);
  const cy = activeCycle(db, u, txt(p, "cycle_id"), at);
  const lot = obj(db, db.lots, txt(p, "lot_id"), u);
  const g = grams(p);
  if (at < lot.received_at) fail("BEFORE_RECEIPT", "Pakan belum diterima pada tanggal ini.");
  const local = farmLocalDate(at, db.farm.timezone);
  if (local > lot.expires_at) fail("LOT_EXPIRED", "Lot pakan sudah kedaluwarsa.");
  const r = record(
    db,
    u,
    "feed",
    { lot_id: lot.id, grams: g, response: optionalText(p, "response"), note: optionalText(p, "note") },
    at,
    cy.id,
    "posted",
    reversalOf,
  );
  stockMove(db, u, lot, r, -g);
  cost(db, u, r, money(g, lot.unit_cost), "pakan");
  return r;
}

export function dispatch(db: Database, u: User, action: string, p: Row): Row {
  authorize(u, action);
  let result: Row = {};
  if (action === "ponds") {
    const block = txt(p, "block", "A", 50);
    if (u.block !== "*" && u.block !== block) fail("FORBIDDEN_SCOPE", "Blok di luar cakupan.", 403);
    const shape = txt(p, "shape", "round");
    if (shape !== "round" && shape !== "rectangle") fail("SHAPE", "Bentuk harus round/rectangle.");
    result = insert(db.ponds, {
      id: uid(),
      farm_id: u.farm_id,
      code: txt(p, "code", undefined, 30),
      name: txt(p, "name"),
      block,
      shape,
      diameter_mm: integer(p, "diameter_mm", 1, 1e9, 4000),
      length_mm: integer(p, "length_mm", 1, 1e9, 4000),
      width_mm: integer(p, "width_mm", 1, 1e9, 4000),
      depth_mm: integer(p, "depth_mm", 1, 1e9, 1000),
      capacity: integer(p, "capacity", 1, 1e9, 5000),
      condition: "Belum dinilai",
      version: 1,
    });
  } else if (action === "cycles") {
    const po = obj(db, db.ponds, txt(p, "pond_id"), u);
    const at = stamp(p.started_at);
    openPeriod(db, u, at);
    if (db.cycles.some((c) => c.pond_id === po.id && c.status === "active"))
      fail("CYCLE_ACTIVE", "Kolam sudah memiliki siklus aktif.", 409);
    const n = integer(p, "count", 1, po.capacity);
    const weightMg = decimal(p, "abw_g") * 1000;
    if (Math.abs(weightMg - Math.round(weightMg)) > 1e-6 || weightMg < 1)
      fail("PRECISION", "Bobot awal minimal 0,001 g dan maksimum 3 angka desimal.");
    const mg = Math.round(weightMg);
    const cy = insert(db.cycles, {
      id: uid(),
      farm_id: u.farm_id,
      pond_id: po.id,
      species: txt(p, "species"),
      seed_batch: txt(p, "seed_batch"),
      started_at: at,
      status: "active" as const,
      initial_count: n,
      initial_abw_mg: mg,
      version: 1,
    });
    const r = record(db, u, "stocking", { count: n, abw_mg: mg }, at, cy.id);
    pop(db, u, cy, r, n, money(n, mg));
    result = cy;
  } else if (action === "cycles/close") {
    const cy = activeCycle(db, u, txt(p, "cycle_id"));
    version(cy, p);
    openPeriod(db, u, now());
    if (balance(db.population.filter((x) => x.cycle_id === cy.id), "count") !== 0)
      fail("POPULATION_REMAINS", "Rekonsiliasi populasi hingga nol sebelum menutup siklus.", 409);
    const rr = db.records.filter((r) => r.cycle_id === cy.id);
    if (rr.some((r) => r.status === "draft")) fail("PENDING_DRAFT", "Masih ada draf siklus.", 409);
    const ids = new Set(rr.map((r) => r.id));
    if (db.approvals.some((a) => ids.has(a.record_id) && a.status === "submitted"))
      fail("PENDING_APPROVAL", "Masih ada koreksi menunggu persetujuan.", 409);
    cy.status = "closed";
    cy.version += 1;
    result = cy;
  } else if (action === "lots") {
    const at = stamp(p.received_at);
    openPeriod(db, u, at);
    const g = grams(p);
    const expiry = calendarDate(txt(p, "expires_at"));
    const receivedDate = farmLocalDate(at, db.farm.timezone);
    if (expiry < receivedDate) fail("LOT_EXPIRED", "Tanggal kedaluwarsa mendahului penerimaan.");
    const l = insert(db.lots, {
      id: uid(),
      farm_id: u.farm_id,
      name: txt(p, "name"),
      supplier: txt(p, "supplier"),
      document: txt(p, "document"),
      received_at: at,
      expires_at: expiry,
      unit_cost: integer(p, "unit_cost", 0),
      version: 1,
    });
    const r = record(db, u, "receipt", { lot_id: l.id, grams: g }, at);
    stockMove(db, u, l, r, g);
    result = l;
  } else if (action === "feed-events") {
    result = feed(db, u, p);
  } else if (["water-readings", "samplings", "mortalities", "health", "harvest-plans"].includes(action)) {
    const at = stamp(p.occurred_at, action === "harvest-plans");
    const cy = activeCycle(db, u, txt(p, "cycle_id"), at);
    if (action === "water-readings") {
      const param = txt(p, "parameter");
      const spec = PARAMETERS[param];
      if (!spec) fail("INVALID_PARAMETER", "Parameter tidak dikenal.");
      const [unit, low, high] = spec;
      const v = decimal(p, "value", low, high, false);
      if ((p.unit ?? unit) !== unit) fail("UNIT_MISMATCH", `Satuan harus ${unit}.`);
      result = record(
        db,
        u,
        "water",
        {
          parameter: param,
          value: String(v),
          unit,
          method: txt(p, "method", "manual"),
          quality: "valid",
          source: "manual",
          note: optionalText(p, "note"),
        },
        at,
        cy.id,
      );
    } else if (action === "samplings") {
      const n = integer(p, "count");
      const g = decimal(p, "total_weight_g");
      const popn = balance(
        db.population.filter((x) => x.cycle_id === cy.id),
        "count",
        at,
      );
      if (n > popn) fail("SAMPLE_EXCEEDS_POPULATION", "Sampel melebihi populasi pada waktu ukur.");
      result = record(
        db,
        u,
        "sampling",
        {
          count: n,
          total_weight_g: String(g),
          abw_g: String(g / n),
          method: txt(p, "method", "acak"),
          note: optionalText(p, "note"),
        },
        at,
        cy.id,
      );
    } else if (action === "mortalities") {
      const n = integer(p, "count");
      const r = record(db, u, "mortality", { count: n, note: txt(p, "note") }, at, cy.id);
      pop(db, u, cy, r, -n);
      result = r;
    } else if (action === "health") {
      result = record(
        db,
        u,
        "health",
        {
          observation: txt(p, "observation"),
          follow_up: txt(p, "follow_up"),
          assessment: "Perlu verifikasi",
        },
        at,
        cy.id,
      );
    } else {
      result = record(
        db,
        u,
        "harvest_plan",
        { grams: grams(p), note: optionalText(p, "note") },
        at,
        cy.id,
        "planned",
      );
    }
  } else if (action === "fish-transfers") {
    const at = stamp(p.occurred_at);
    const src = activeCycle(db, u, txt(p, "source_cycle_id"), at);
    const dst = activeCycle(db, u, txt(p, "destination_cycle_id"), at);
    if (src.id === dst.id || src.species !== dst.species)
      fail("TRANSFER_INVALID", "Tujuan harus berbeda dan spesies sama.");
    if (src.seed_batch !== dst.seed_batch)
      fail("COHORT_MISMATCH", "Transfer hanya untuk cohort/batch benih sama pada versi ini.");
    const n = integer(p, "count");
    const g = grams(p);
    const po = obj(db, db.ponds, dst.pond_id, u);
    const destPop = balance(db.population.filter((x) => x.cycle_id === dst.id), "count");
    if (destPop + n > po.capacity) fail("CAPACITY", "Tujuan melebihi kapasitas.");
    const r = record(
      db,
      u,
      "transfer",
      { destination_cycle_id: dst.id, count: n, grams: g, reason: txt(p, "reason") },
      at,
      src.id,
    );
    pop(db, u, src, r, -n, -g);
    pop(db, u, dst, r, n, g, src.seed_batch);
    result = r;
  } else if (action === "harvests") {
    const at = stamp(p.occurred_at);
    const cy = activeCycle(db, u, txt(p, "cycle_id"), at);
    const g = grams(p);
    const grades = p.grades;
    if (!Array.isArray(grades) || !grades.length || grades.length > 20)
      fail("GRADES", "Isi rincian grade.");
    const normalized = grades.map((x: Row) => ({ grade: txt(x, "grade"), grams: grams(x) }));
    if (new Set(normalized.map((x) => x.grade)).size !== normalized.length ||
      normalized.reduce((s, x) => s + x.grams, 0) !== g)
      fail("GRADE_MISMATCH", "Jumlah grade harus sama dengan berat netto dan tidak berulang.");
    const n = integer(p, "count");
    const method = txt(p, "count_method", "counted");
    if (method !== "counted") fail("COUNT_METHOD", "Versi ini memerlukan hitungan ekor aktual.");
    result = record(
      db,
      u,
      "harvest",
      { grams: g, count: n, count_method: method, grades: normalized, note: optionalText(p, "note") },
      at,
      cy.id,
      "draft",
    );
  } else if (action === "harvests/post") {
    const r = obj(db, db.records, txt(p, "id"), u);
    version(r, p);
    if (r.kind !== "harvest" || r.status !== "draft") fail("HARVEST_STATE", "Panen bukan draf.", 409);
    const cy = activeCycle(db, u, r.cycle_id!, r.occurred_at);
    pop(db, u, cy, r, -r.data.count, -r.data.grams);
    for (const g of r.data.grades as { grade: string; grams: number }[]) {
      insert(db.harvestLots, {
        id: uid(),
        farm_id: u.farm_id,
        record_id: r.id,
        grade: g.grade,
        grams: g.grams,
      });
    }
    r.status = "posted";
    r.version += 1;
    result = r;
  } else if (action === "orders") {
    const at = stamp(p.occurred_at);
    openPeriod(db, u, at);
    const lines = p.lines;
    if (!Array.isArray(lines) || !lines.length || lines.length > 50)
      fail("LINES", "Isi alokasi lot hasil.");
    const o = insert(db.orders, {
      id: uid(),
      farm_id: u.farm_id,
      buyer: txt(p, "buyer"),
      status: "confirmed",
      occurred_at: at,
      version: 1,
    });
    const seen = new Set<string>();
    for (const line of lines as Row[]) {
      const lot = obj(db, db.harvestLots, txt(line, "lot_id"), u);
      const source = obj(db, db.records, lot.record_id, u);
      if (at < source.occurred_at) fail("ALLOCATION_TIME", "Alokasi tidak boleh mendahului hasil panen.");
      if (seen.has(lot.id)) fail("DUPLICATE_LOT", "Gabungkan baris lot yang sama.");
      seen.add(lot.id);
      const g = grams(line);
      const used = db.allocations.filter((x) => x.lot_id === lot.id).reduce((s, x) => s + x.grams, 0);
      if (used + g > lot.grams) fail("ALLOCATION_EXCEEDED", "Alokasi melebihi hasil panen tersedia.", 409);
      insert(db.allocations, {
        id: uid(),
        farm_id: u.farm_id,
        order_id: o.id,
        lot_id: lot.id,
        grams: g,
        price_per_kg: integer(line, "price_per_kg"),
      });
    }
    result = o;
  } else if (action === "orders/ship") {
    const o = obj(db, db.orders, txt(p, "id"), u, true);
    version(o, p);
    if (o.status !== "confirmed") fail("ORDER_STATE", "Pesanan sudah dikirim.", 409);
    const at = stamp(p.occurred_at);
    openPeriod(db, u, at);
    if (at < o.occurred_at) fail("SHIPMENT_TIME", "Pengiriman sebelum pesanan.");
    const lines = db.allocations.filter((x) => x.order_id === o.id);
    const amount = lines.reduce((s, x) => s + money(x.grams, x.price_per_kg), 0);
    const invoice = insert(db.invoices, {
      id: uid(),
      farm_id: u.farm_id,
      order_id: o.id,
      amount,
      occurred_at: at,
      status: "posted",
    });
    record(db, u, "shipment", { order_id: o.id, invoice_id: invoice.id, reference: txt(p, "reference") }, at);
    o.status = "shipped";
    o.version += 1;
    result = invoice;
  } else if (action === "payments") {
    const inv = obj(db, db.invoices, txt(p, "invoice_id"), u, true);
    const at = stamp(p.occurred_at);
    openPeriod(db, u, at);
    if (at < inv.occurred_at) fail("PAYMENT_TIME", "Pembayaran mendahului invoice.");
    const amount = integer(p, "amount");
    const paid = db.payments.filter((x) => x.invoice_id === inv.id).reduce((s, x) => s + x.amount, 0);
    if (paid + amount > inv.amount) fail("ALLOCATION_EXCEEDED", "Pembayaran melebihi piutang.", 409);
    result = insert(db.payments, {
      id: uid(),
      farm_id: u.farm_id,
      invoice_id: inv.id,
      amount,
      occurred_at: at,
      reference: txt(p, "reference"),
      created_by: u.id,
    });
  } else if (action === "expenses") {
    const at = stamp(p.occurred_at);
    openPeriod(db, u, at);
    const cid = p.cycle_id || null;
    if (cid) activeCycle(db, u, cid, at);
    const category = txt(p, "category");
    if (!["benih", "energi", "tenaga kerja", "overhead"].includes(category))
      fail("CATEGORY", "Gunakan benih, energi, tenaga kerja, atau overhead; pakan dari ledger konsumsi.");
    const amount = integer(p, "amount");
    const r = record(
      db,
      u,
      "expense",
      { category, amount, reference: txt(p, "reference"), note: txt(p, "note") },
      at,
      cid,
    );
    cost(db, u, r, amount, category);
    result = r;
  } else if (action === "periods/lock") {
    const through = calendarDate(txt(p, "through_date"));
    const today = farmLocalDate(now(), db.farm.timezone);
    if (through >= today) fail("PERIOD_DATE", "Tutup periode hanya sampai hari kemarin.");
    if (db.approvals.some((a) => a.status === "submitted"))
      fail("PENDING_APPROVAL", "Selesaikan persetujuan sebelum mengunci periode.", 409);
    result = insert(db.periods, {
      id: uid(),
      farm_id: u.farm_id,
      through_date: through,
      created_by: u.id,
      created_at: now(),
    });
  } else if (action === "tasks") {
    const pid = p.pond_id || null;
    if (pid) obj(db, db.ponds, pid, u);
    else if (u.block !== "*") fail("SCOPE", "Pilih kolam dalam cakupan Anda.", 403);
    const assignee = obj(db, db.users, txt(p, "assignee_id"), u);
    if (!assignee.active || assignee.role === "Pembaca")
      fail("ASSIGNEE", "PIC harus anggota aktif yang dapat bekerja.");
    if (assignee.block !== "*" && (!pid || one(db.ponds, pid)?.block !== assignee.block))
      fail("ASSIGNEE_SCOPE", "PIC tidak memiliki izin lokasi tugas.");
    const priority = txt(p, "priority", "normal");
    if (!["normal", "high", "critical"].includes(priority)) fail("PRIORITY", "Prioritas tidak valid.");
    const labels = p.checklist ?? ["Catat hasil pemeriksaan"];
    if (
      !Array.isArray(labels) ||
      labels.length < 1 ||
      labels.length > 30 ||
      labels.some((x) => typeof x !== "string" || !x.trim() || x.length > 200)
    )
      fail("CHECKLIST", "Checklist tidak valid.");
    result = insert(db.tasks, {
      id: uid(),
      farm_id: u.farm_id,
      pond_id: pid,
      title: txt(p, "title"),
      assignee_id: assignee.id,
      priority,
      due_at: stamp(p.due_at, true),
      status: "scheduled",
      checklist: labels.map((x: string) => ({ label: x, done: false })),
      evidence: "",
      requires_verification: 1,
      version: 1,
      created_by: u.id,
      source_id: p.source_id || null,
    });
  } else if (action === "tasks/update") {
    const t = obj(db, db.tasks, txt(p, "id"), u, true);
    version(t, p);
    if (u.role === "Operator" && t.assignee_id !== u.id)
      fail("TASK_ASSIGNEE", "Hanya PIC dapat mengerjakan tugas ini.", 403);
    const target = txt(p, "status");
    const transitions: Record<string, string[]> = {
      scheduled: ["working", "cancelled"],
      working: ["awaiting_verification", "cancelled"],
      awaiting_verification: ["done", "working"],
      done: [],
      cancelled: [],
    };
    if (!transitions[t.status]?.includes(target)) fail("TASK_TRANSITION", "Perubahan status tidak valid.", 409);
    if (target === "done" || target === "cancelled") manage(u);
    if (target === "done" && t.assignee_id === u.id)
      fail("SELF_REVIEW", "Verifikasi harus oleh orang lain.", 403);
    const checks = p.checklist ?? t.checklist;
    if (
      !Array.isArray(checks) ||
      checks.length !== t.checklist.length ||
      checks.some(
        (x: Row, i: number) =>
          !x || x.label !== t.checklist[i].label || typeof x.done !== "boolean",
      )
    )
      fail("CHECKLIST_VERSION", "Checklist berubah; muat ulang.", 409);
    const evidence = p.evidence ?? t.evidence;
    if (typeof evidence !== "string" || evidence.length > 200)
      fail("EVIDENCE", "Bukti teks maksimum 200 karakter pada versi skema ini.");
    if (
      (target === "awaiting_verification" || target === "done") &&
      (!checks.every((x: Row) => x.done) || !String(evidence).trim())
    )
      fail("EVIDENCE_REQUIRED", "Lengkapi semua checklist dan catatan bukti.");
    t.status = target;
    t.checklist = checks;
    t.evidence = evidence;
    t.version += 1;
    result = t;
  } else if (action === "approvals") {
    const r = obj(db, db.records, txt(p, "record_id"), u);
    if (r.kind !== "feed" || r.status !== "posted")
      fail("CORRECTION_TYPE", "Koreksi tersedia untuk pakan posted.");
    if (db.approvals.some((a) => a.record_id === r.id && a.status === "submitted"))
      fail("PENDING_APPROVAL", "Catatan sedang ditinjau.", 409);
    const g = grams(p);
    const pay = { grams: g, record_version: r.version };
    result = insert(db.approvals, {
      id: uid(),
      farm_id: u.farm_id,
      record_id: r.id,
      created_by: u.id,
      reason: txt(p, "reason"),
      payload: pay,
      payload_hash: payloadHash(pay),
      status: "submitted",
      version: 1,
      reviewer_id: null,
      decision_reason: "",
    });
  } else if (action === "approvals/decide") {
    const a = obj(db, db.approvals, txt(p, "id"), u);
    const r = obj(db, db.records, a.record_id, u);
    version(a, p);
    if (a.created_by === u.id)
      fail("SELF_REVIEW", "Pengaju tidak boleh menyetujui atau menolak pengajuannya sendiri.", 403);
    if (a.status !== "submitted" || a.payload_hash !== txt(p, "payload_hash") || r.version !== a.payload.record_version)
      fail("REVIEW_STALE", "Versi persetujuan berubah.", 409);
    const decision = txt(p, "decision");
    const reason = txt(p, "reason");
    if (decision !== "approved" && decision !== "rejected") fail("DECISION", "Keputusan tidak valid.");
    if (decision === "approved") {
      const cy = activeCycle(db, u, r.cycle_id!, r.occurred_at);
      const lot = obj(db, db.lots, r.data.lot_id, u);
      const rev = record(
        db,
        u,
        "feed_reversal",
        { grams: r.data.grams, lot_id: lot.id },
        r.occurred_at,
        cy.id,
        "posted",
        r.id,
      );
      stockMove(db, u, lot, rev, r.data.grams);
      cost(db, u, rev, -money(r.data.grams, lot.unit_cost), "pakan");
      feed(
        db,
        u,
        {
          cycle_id: cy.id,
          lot_id: lot.id,
          kg: String(a.payload.grams / 1000),
          occurred_at: r.occurred_at,
          note: a.reason,
        },
        r.id,
      );
      r.status = "corrected";
      r.version += 1;
    }
    a.status = decision;
    a.reviewer_id = u.id;
    a.decision_reason = reason;
    a.version += 1;
    result = a;
  } else if (action === "users/password") {
    const current = txt(p, "current_password");
    const replacement = txt(p, "new_password");
    if (hashPassword(current) !== u.password_hash)
      fail("PASSWORD_INVALID", "Password saat ini tidak cocok.", 403);
    if (replacement.length < 12) fail("PASSWORD_LENGTH", "Password baru minimal 12 karakter.");
    u.password_hash = hashPassword(replacement);
    u.version += 1;
    result = { id: u.id, password_changed: true };
  } else if (action === "users") {
    const email = txt(p, "email").toLowerCase();
    const password = txt(p, "password");
    if (!email.includes("@") || password.length < 12)
      fail("CREDENTIALS", "Email valid dan password minimal 12 karakter wajib.");
    if (db.users.some((x) => x.email === email)) fail("EMAIL_TAKEN", "Email sudah terdaftar.", 409);
    const roleName = txt(p, "role") as User["role"];
    if (!["Admin", "Manajer", "Operator", "Pembaca"].includes(roleName)) fail("ROLE", "Peran tidak valid.");
    result = publicUser(
      insert(db.users, {
        id: uid(),
        farm_id: u.farm_id,
        email,
        name: txt(p, "name"),
        password_hash: hashPassword(password),
        role: roleName,
        block: txt(p, "block", "*"),
        active: 1,
        finance: integer(p, "finance", 0, 1, 0),
        device_control: integer(p, "device_control", 0, 1, 0),
        version: 1,
      }),
    );
  } else if (action === "users/update") {
    const target = obj(db, db.users, txt(p, "id"), u, true);
    version(target, p);
    const ro = txt(p, "role", target.role) as User["role"];
    const active = integer(p, "active", 0, 1, target.active);
    if (!["Admin", "Manajer", "Operator", "Pembaca"].includes(ro)) fail("ROLE", "Peran tidak valid.");
    const admins = db.users.filter((x) => x.role === "Admin" && x.active && x.block === "*");
    const nextBlock = txt(p, "block", target.block);
    if (
      target.role === "Admin" &&
      target.block === "*" &&
      target.active &&
      (!active || ro !== "Admin" || nextBlock !== "*") &&
      admins.length <= 1
    )
      fail("LAST_ADMIN", "Admin aktif terakhir dengan akses seluruh farm wajib dipertahankan.", 409);
    if (
      !active &&
      db.tasks.some((t) => t.assignee_id === target.id && !["done", "cancelled"].includes(t.status))
    )
      fail("OPEN_TASKS", "Selesaikan atau batalkan tugas PIC sebelum menonaktifkan.", 409);
    target.role = ro;
    target.active = active;
    target.block = nextBlock;
    target.finance = integer(p, "finance", 0, 1, target.finance);
    target.device_control = integer(p, "device_control", 0, 1, target.device_control);
    target.version += 1;
    result = publicUser(target);
  } else if (action === "farm") {
    version(db.farm, p);
    const tz = txt(p, "timezone", db.farm.timezone);
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz }).format(new Date());
    } catch {
      fail("TIMEZONE", "Zona waktu IANA tidak valid.");
    }
    if (
      tz !== db.farm.timezone &&
      (db.records.length || db.periods.length || db.invoices.length || db.payments.length)
    )
      fail(
        "TIMEZONE_HISTORY",
        "Zona waktu tidak dapat diubah setelah ada transaksi atau periode terkunci. Perubahan memerlukan migrasi riwayat yang ditinjau.",
        409,
      );
    db.farm.name = txt(p, "name");
    db.farm.address = txt(p, "address");
    db.farm.timezone = tz;
    db.farm.version += 1;
    result = db.farm;
  } else if (action === "sops") {
    const param = txt(p, "parameter");
    const spec = PARAMETERS[param];
    if (!spec) fail("PARAMETER", "Parameter tidak valid.");
    const lo = decimal(p, "min_value", spec[1], spec[2], false);
    const hi = decimal(p, "max_value", spec[1], spec[2], false);
    if (lo >= hi) fail("RANGE", "Batas minimum harus lebih rendah dari maksimum.");
    const at = stamp(p.effective_at, true);
    if (at < now()) fail("SOP_BACKDATE", "SOP baru hanya berlaku ke depan.");
    result = insert(db.sops, {
      id: uid(),
      farm_id: u.farm_id,
      species: txt(p, "species"),
      parameter: param,
      method: txt(p, "method", "manual"),
      min_value: String(lo),
      max_value: String(hi),
      effective_at: at,
      stale_minutes: integer(p, "stale_minutes", 1, 1e9, 120),
      version: 1,
      created_by: u.id,
    });
  } else if (action === "devices") {
    const po = obj(db, db.ponds, txt(p, "pond_id"), u);
    const token = uid() + uid();
    const dev = insert(db.devices, {
      id: uid(),
      farm_id: u.farm_id,
      pond_id: po.id,
      name: txt(p, "name"),
      kind: txt(p, "kind", "sensor"),
      token_hash: hashPassword(token),
      control_enabled: 0,
      last_seen: "",
      actual_state: "unknown",
      state_measured_at: "",
      version: 1,
    });
    result = { ...dev, token_hash: undefined, provisioning_token: token };
  } else if (action === "devices/rotate-token") {
    const dev = obj(db, db.devices, txt(p, "id"), u);
    version(dev, p);
    if (
      db.commands.some(
        (c) => c.device_id === dev.id && ["created", "received"].includes(c.status) && c.expires_at > now(),
      )
    )
      fail("COMMAND_PENDING", "Tunggu perintah aktif selesai sebelum mengganti token.", 409);
    const token = uid() + uid();
    dev.token_hash = hashPassword(token);
    dev.version += 1;
    result = { ...dev, token_hash: undefined, provisioning_token: token };
  } else if (action === "device-commands") {
    const dev = obj(db, db.devices, txt(p, "device_id"), u);
    version(dev, p);
    if (!dev.control_enabled)
      fail("CONTROL_NOT_COMMISSIONED", "Kontrol belum diaktifkan melalui commissioning alat.", 409);
    result = insert(db.commands, {
      id: uid(),
      farm_id: u.farm_id,
      device_id: dev.id,
      target: txt(p, "target"),
      status: "created",
      issued_at: now(),
      expires_at: stamp(p.expires_at, true),
      reason: txt(p, "reason"),
      created_by: u.id,
      version: 1,
    });
  } else fail("UNKNOWN_ACTION", "Aksi tidak dikenal.", 404);

  log(db, u, action, result.id || u.id, { action });
  return result;
}

function cycleMetrics(db: Database, cy: Cycle, at = now()) {
  const ev = db.population.filter((x) => x.cycle_id === cy.id && x.occurred_at <= at);
  const rr = db.records.filter((x) => x.cycle_id === cy.id && x.occurred_at <= at);
  const sample = rr
    .filter((r) => r.kind === "sampling" && r.status === "posted")
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  const abw = sample[0] ? Number(sample[0].data.abw_g) : null;
  const n = ev.reduce((s, x) => s + x.count, 0);
  const biomass = abw != null ? (n * abw) / 1000 : null;
  const recOf = (id: string) => one(db.records, id);
  const transferred = ev.some((x) => x.grams && x.count && recOf(x.record_id)?.kind === "transfer");
  const harvested = ev
    .filter((x) => recOf(x.record_id)?.kind === "harvest")
    .reduce((s, x) => s - x.count, 0);
  const sr = !transferred && cy.initial_count ? ((n + harvested) / cy.initial_count) * 100 : null;
  const feedGrams = rr
    .filter((r) => r.kind === "feed" && r.status === "posted")
    .reduce((s, r) => s + Number(r.data.grams || 0), 0);
  const harvestGrams = rr
    .filter((r) => r.kind === "harvest" && r.status === "posted")
    .reduce((s, r) => s + Number(r.data.grams || 0), 0);
  const transferGrams = ev
    .filter((x) => recOf(x.record_id)?.kind === "transfer")
    .reduce((s, x) => s + x.grams, 0);
  const initial = (cy.initial_count * cy.initial_abw_mg) / 1_000_000;
  const den = biomass != null ? biomass + (harvestGrams - transferGrams) / 1000 - initial : null;
  const stale =
    !sample[0] || new Date(sample[0].occurred_at).getTime() < new Date(at).getTime() - 7 * 86400000;
  const fcr = den != null && den > 0 && !stale ? feedGrams / 1000 / den : null;
  return {
    ...cy,
    population: n,
    abw_g: abw,
    biomass_kg: biomass,
    sampling_at: sample[0]?.occurred_at ?? null,
    sampling_stale: stale,
    sr_percent: sr,
    fcr,
    fcr_denominator_kg: fcr != null ? den : null,
    feed_kg: feedGrams / 1000,
  };
}

function waterStatus(db: Database, r: RecordRow) {
  const cy = r.cycle_id ? one(db.cycles, r.cycle_id) : undefined;
  const data = r.data;
  const versions = db.sops.filter(
    (s) =>
      cy &&
      s.species === cy.species &&
      s.parameter === data.parameter &&
      s.method === data.method &&
      s.effective_at <= r.occurred_at,
  );
  const sop = versions.sort((a, b) => (a.effective_at < b.effective_at ? 1 : -1))[0];
  const age = (Date.now() - new Date(r.occurred_at).getTime()) / 60000;
  let status = "Belum dinilai";
  if (data.quality !== "valid") status = "Perlu verifikasi";
  else if (age > (sop?.stale_minutes ?? 120)) status = "Data terlambat";
  else if (!sop) status = "Belum dinilai";
  else
    status =
      Number(sop.min_value) <= Number(data.value) && Number(data.value) <= Number(sop.max_value)
        ? "Stabil"
        : "Perlu cek";
  return { ...r, assessment: status, sop_id: sop?.id ?? null, age_minutes: Math.round(age) };
}

export function snapshot(db: Database, u: User): Row {
  const pos = db.ponds.filter((p) => u.block === "*" || p.block === u.block);
  const pids = new Set(pos.map((p) => p.id));
  const cys = db.cycles.filter((c) => pids.has(c.pond_id));
  const cids = new Set(cys.map((c) => c.id));
  const metrics = cys.map((c) => cycleMetrics(db, c));
  let rr = db.records
    .filter((r) => (r.cycle_id && cids.has(r.cycle_id)) || (!r.cycle_id && u.block === "*"))
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : b.id.localeCompare(a.id)))
    .slice(0, 100);
  const canFin = !!(u.finance && u.block === "*");
  if (!canFin) rr = rr.filter((r) => r.kind !== "expense" && r.kind !== "shipment");
  const latest: Row[] = [];
  for (const cy of cys) {
    for (const param of Object.keys(PARAMETERS)) {
      const candidates = db.records.filter(
        (r) => r.cycle_id === cy.id && r.kind === "water" && r.data.parameter === param,
      );
      if (candidates.length) {
        const newest = candidates.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))[0];
        latest.push(waterStatus(db, newest));
      }
    }
  }
  const ponds = pos.map((po) => {
    const active = metrics.find((x) => x.pond_id === po.id && x.status === "active");
    const checks = latest.filter((r) => active && r.cycle_id === active.id).map((r) => r.assessment);
    const condition = checks.some((x) =>
      ["Perlu cek", "Data terlambat", "Perlu verifikasi"].includes(x),
    )
      ? "Perlu cek"
      : checks.length && checks.every((x) => x === "Stabil")
        ? "Stabil"
        : "Belum dinilai";
    return { ...po, cycle: active, condition };
  });
  const lots = db.lots.map((l) => {
    const stock_kg = balance(db.stock.filter((s) => s.lot_id === l.id), "grams") / 1000;
    if (!canFin) return { id: l.id, name: l.name, received_at: l.received_at, expires_at: l.expires_at, stock_kg, version: l.version };
    return { ...l, stock_kg };
  });
  const tasks = db.tasks.filter((t) => (t.pond_id && pids.has(t.pond_id)) || (!t.pond_id && u.block === "*"));
  const team = db.users
    .filter((x) => x.active || u.role === "Admin")
    .map((x) =>
      u.role === "Admin" && u.block === "*"
        ? publicUser(x)
        : { id: x.id, name: x.name, block: x.block, active: x.active, role: x.role, version: x.version },
    );
  const aps = db.approvals
    .filter((a) => {
      const src = one(db.records, a.record_id);
      return src && src.cycle_id && cids.has(src.cycle_id) && (u.role === "Admin" || u.role === "Manajer" || a.created_by === u.id);
    })
    .map((a) => {
      const source = one(db.records, a.record_id)!;
      return {
        ...a,
        before_grams: source.data.grams,
        stock_delta_grams: source.data.grams - a.payload.grams,
      };
    });
  const dvs = db.devices
    .filter((d) => pids.has(d.pond_id))
    .map((d) => {
      const { token_hash: _, ...rest } = d;
      const connection = !d.last_seen
        ? "Belum terhubung"
        : new Date(d.last_seen).getTime() < Date.now() - 2 * 60000
          ? "Data terlambat"
          : "Terhubung";
      return { ...rest, connection };
    });
  const cmds = db.commands
    .filter((c) => dvs.some((d) => d.id === c.device_id))
    .map((c) =>
      ["created", "received"].includes(c.status) && c.expires_at < now()
        ? { ...c, status: "expired_unverified" }
        : c,
    );
  const hs = db.harvestLots
    .filter((h) => {
      const rec = one(db.records, h.record_id);
      return rec?.cycle_id && cids.has(rec.cycle_id);
    })
    .map((h) => ({
      ...h,
      available_kg:
        (h.grams - db.allocations.filter((x) => x.lot_id === h.id).reduce((s, x) => s + x.grams, 0)) / 1000,
    }));
  const today = farmLocalDate(now(), db.farm.timezone);
  const daily =
    db.records
      .filter(
        (x) =>
          x.kind === "feed" &&
          x.status === "posted" &&
          x.cycle_id &&
          cids.has(x.cycle_id) &&
          farmLocalDate(x.occurred_at, db.farm.timezone) === today,
      )
      .reduce((s, x) => s + Number(x.data.grams || 0), 0) / 1000;
  const active = metrics.filter((x) => x.status === "active");
  const known = active.filter((x) => x.biomass_kg != null);
  const valid = active.filter((x) => x.fcr != null);
  const den = valid.reduce((s, x) => s + Number(x.fcr_denominator_kg || 0), 0);
  return {
    user: publicUser(u),
    farm: db.farm,
    ponds,
    cycles: metrics,
    records: rr,
    record_limit: 100,
    lots,
    tasks,
    team,
    approvals: aps,
    water: latest,
    devices: dvs,
    commands: cmds,
    telemetry: db.telemetry.filter((t) => dvs.some((d) => d.id === t.device_id)).slice(-100).reverse(),
    incidents: db.incidents.filter((i) => dvs.some((d) => d.id === i.device_id)),
    harvest_lots: hs,
    sops: db.sops,
    as_of: now(),
    kpis: {
      active_ponds: active.length,
      biomass_kg: known.length ? known.reduce((s, x) => s + Number(x.biomass_kg), 0) : null,
      biomass_coverage: `${known.length}/${active.length}`,
      feed_today_kg: daily,
      fcr: den && valid.length === active.length ? valid.reduce((s, x) => s + x.feed_kg, 0) / den : null,
    },
    demo: true,
    standalone: true,
  };
}

export function report(db: Database, u: User, from_date: string, to_date: string) {
  finance(u);
  const start = calendarDate(from_date);
  const end = calendarDate(to_date);
  if (start > end) fail("RANGE", "Awal periode harus sebelum akhir.");
  const included = (iso: string) => {
    const d = farmLocalDate(iso, db.farm.timezone);
    return start <= d && d <= end;
  };
  const inv = db.invoices.map((v) => {
    const paid = db.payments.filter((x) => x.invoice_id === v.id).reduce((s, x) => s + x.amount, 0);
    return { ...v, paid, balance: v.amount - paid };
  });
  const period_inv = inv.filter((x) => included(x.occurred_at));
  const period_cost = db.costs.filter((x) => included(x.occurred_at));
  const period_pay = db.payments.filter((x) => included(x.occurred_at));
  const revenue = period_inv.reduce((s, x) => s + x.amount, 0);
  const costSum = period_cost.reduce((s, x) => s + x.amount, 0);
  return {
    from: from_date,
    to: to_date,
    timezone: db.farm.timezone,
    as_of: now(),
    basis:
      "Invoice sah dan biaya konsumsi/operasi; kas masuk ditampilkan terpisah. Piutang adalah saldo saat ini. Mode mandiri — data di perangkat.",
    method_version: "BFG-OP-1",
    revenue,
    cost: costSum,
    difference: revenue - costSum,
    cash_received: period_pay.reduce((s, x) => s + x.amount, 0),
    receivables_current: inv.reduce((s, x) => s + x.balance, 0),
    invoices: inv,
    period_invoices: period_inv,
    payments: period_pay,
    costs: period_cost,
    orders: db.orders,
    periods: db.periods,
  };
}

export function auditLog(db: Database, u: User) {
  roleOk(u, "Admin");
  if (u.block !== "*") fail("FORBIDDEN_SCOPE", "Audit memerlukan cakupan seluruh farm.", 403);
  return db.audit.slice().reverse().slice(0, 100);
}

export function login(db: Database, email: string, password: string): User {
  const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && x.active);
  if (!u || hashPassword(password) !== u.password_hash)
    fail("LOGIN", "Email atau password tidak cocok.", 401);
  return u;
}

export function seedDemo(): Database {
  const db = emptyDb();
  const hash = hashPassword(DEMO_PASSWORD);
  const admin: User = {
    id: "admin",
    email: "admin@bioflog.local",
    name: "Admin Farm",
    password_hash: hash,
    role: "Admin",
    farm_id: db.farm.id,
    block: "*",
    active: 1,
    finance: 1,
    device_control: 0,
    version: 1,
  };
  db.users.push(admin);
  for (const [id, name, role, block, fin] of [
    ["manager", "Manajer Farm", "Manajer", "*", 1],
    ["operator", "Operator Blok A", "Operator", "A", 0],
    ["reader", "Pembaca Farm", "Pembaca", "*", 0],
  ] as const) {
    db.users.push({
      id,
      email: id + "@bioflog.local",
      name,
      password_hash: hash,
      role: role as User["role"],
      farm_id: db.farm.id,
      block,
      active: 1,
      finance: fin,
      device_control: 0,
      version: 1,
    });
  }
  const started = new Date(Date.now() - 64 * 86400000).toISOString();
  const at = new Date(Date.now() - 15 * 60000).toISOString();
  const mortAt = new Date(Date.now() - 2 * 86400000).toISOString();
  const staleAt = new Date(Date.now() - 5 * 3600000).toISOString();
  const due = new Date(Date.now() + 2 * 3600000).toISOString();
  for (let i = 1; i <= 12; i++) {
    const po = dispatch(db, admin, "ponds", {
      code: `A${String(i).padStart(2, "0")}`,
      name: `Kolam A${String(i).padStart(2, "0")}`,
      block: "A",
      capacity: 5000,
    }) as Pond;
    const cy = dispatch(db, admin, "cycles", {
      pond_id: po.id,
      species: "Nila",
      seed_batch: "DEMO-COHORT-01",
      started_at: started,
      count: 3500,
      abw_g: "10",
    }) as Cycle;
    dispatch(db, admin, "mortalities", {
      cycle_id: cy.id,
      count: 170,
      note: "Data demonstrasi historis",
      occurred_at: mortAt,
    });
    dispatch(db, admin, "samplings", {
      cycle_id: cy.id,
      count: 30,
      total_weight_g: 4260,
      occurred_at: at,
    });
    if (i === 1) {
      for (const [parameter, min, max] of [
        ["do", "4", "10"],
        ["ph", "6", "9"],
        ["temperature", "20", "35"],
      ] as const) {
        insert(db.sops, {
          id: uid(),
          farm_id: db.farm.id,
          species: "Nila",
          parameter,
          method: "manual",
          min_value: min,
          max_value: max,
          effective_at: started,
          stale_minutes: 120,
          version: 1,
          created_by: "admin",
        });
      }
    }
    for (const [parameter, v] of [
      ["do", "5.6"],
      ["ph", "7.8"],
      ["temperature", "28.4"],
    ] as const) {
      dispatch(db, admin, "water-readings", {
        cycle_id: cy.id,
        parameter,
        value: v,
        occurred_at: i === 7 || i === 11 ? staleAt : at,
      });
    }
    if (i === 7 || i === 11) {
      dispatch(db, admin, "tasks", {
        pond_id: po.id,
        title: i === 7 ? "Periksa air dan catat ulang" : "Jadwalkan sampling lanjutan",
        assignee_id: "operator",
        priority: "high",
        due_at: due,
        checklist: ["Periksa kondisi kolam", "Catat hasil di aplikasi"],
      });
    }
  }
  const expiry = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  for (const [name, kg] of [
    ["Pakan Apung • Lot DEMO-01", 800],
    ["Pakan Grower • Lot DEMO-02", 450],
  ] as const) {
    dispatch(db, admin, "lots", {
      name,
      supplier: "Pemasok contoh",
      document: "DEMO-PO-" + kg,
      kg,
      unit_cost: 10000,
      received_at: started,
      expires_at: expiry,
    });
  }
  dispatch(db, admin, "devices", {
    pond_id: db.ponds[0].id,
    name: "Sensor uji — belum dipasangkan",
    kind: "sensor",
  });
  return db;
}
