import React, { useEffect, useState, useRef } from "react";
import {
  Fish,
  LayoutDashboard,
  Cylinder,
  Droplets,
  Package,
  TrendingUp,
  Wifi,
  ShoppingBasket,
  Wallet,
  ClipboardCheck,
  Settings,
  Plus,
  Search,
  LogOut,
  ChevronRight,
  ArrowUpRight,
  Menu,
  X,
  Check,
  AlertTriangle,
  Download,
  Clock,
  Activity,
} from "lucide-react";
import { useBioflog, DEMO_PASSWORD } from "@/lib/bioflog/store";
import { PASSWORD_MIN, validatePasswordChange } from "@/lib/bioflog/password-policy";
import { DEMO_ACCOUNTS, type Row } from "@/lib/bioflog/types";
import {
  kindNames,
  statusNames,
  fmt,
  rupiah,
  dateFmt as date,
  csvEscape,
} from "@/lib/bioflog/format";

const nav = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["ponds", "Kolam & siklus", Cylinder],
  ["water", "Kualitas air", Droplets],
  ["feed", "Pakan & persediaan", Package],
  ["growth", "Pertumbuhan & kesehatan", TrendingUp],
  ["devices", "Perangkat & peringatan", Wifi],
  ["harvest", "Panen & penjualan", ShoppingBasket],
  ["finance", "Keuangan & laporan", Wallet],
  ["tasks", "Tugas & persetujuan", ClipboardCheck],
  ["settings", "Pengaturan & hak akses", Settings],
] as const;

function Badge({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        (/cek|terlambat|conflict|rejected|gagal|Ditolak|expired|Offline/i.test(value)
          ? "warn"
          : "")
      }
    >
      {statusNames[value] || value}
    </span>
  );
}

function Empty({
  text = "Belum ada catatan untuk ditampilkan.",
}: {
  text?: string;
}) {
  return (
    <div className="empty">
      <Fish size={28} />
      <p>{text}</p>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  note,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  note: string;
  onClick?: () => void;
}) {
  const Container = onClick ? "button" : "div";
  return (
    <Container className="metric" onClick={onClick}>
      <span className="metric-icon">
        <Icon size={23} />
      </span>
      <div>
        <span className="muted">{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
      {onClick && <ArrowUpRight size={15} className="metric-arrow" />}
    </Container>
  );
}

function Table({
  columns,
  rows,
  action,
}: {
  columns: [string, string, ((v: any, r: Row) => React.ReactNode)?][];
  rows: Row[];
  action?: (r: Row) => React.ReactNode;
}) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(([k, l]) => (
              <th key={k + l}>{l}</th>
            ))}
            {action && <th>Aksi</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              {columns.map(([k, l, f]) => (
                <td key={k + l}>{f ? f(r[k], r) : String(r[k] ?? "—")}</td>
              ))}
              {action && (
                <td>
                  <div className="row-actions">{action(r)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}

type Field = {
  key: string;
  label: string;
  type?: string;
  options?: [string, string][];
  value?: any;
  required?: boolean;
  hint?: string;
};
type FormSpec = {
  title: string;
  action: string;
  fields: Field[];
  base?: Row;
  transform?: (p: Row) => Row;
  help?: string;
};

function Editor({
  spec,
  onClose,
  onDone,
}: {
  spec: FormSpec;
  onClose: () => void;
  onDone: (s: string) => void;
}) {
  const mutate = useBioflog((s) => s.mutate);
  const [values, setValues] = useState<Row>(
    Object.fromEntries(spec.fields.map((f) => [f.key, f.value ?? f.options?.[0]?.[0] ?? ""])),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      let p: Row = { ...spec.base, ...values };
      for (const f of spec.fields) {
        if (f.type === "datetime-local")
          p[f.key] = p[f.key] ? new Date(p[f.key]).toISOString() : new Date().toISOString();
        if (f.type === "json") p[f.key] = JSON.parse(p[f.key]);
      }
      if (spec.transform) p = spec.transform(p);
      // Awaited: the server must accept and persist the write before this form
      // reports success or closes. A rejection lands in the catch below, which
      // shows the error and leaves the form — and the operator's input — intact.
      const r = await mutate(spec.action, p);
      if (r.provisioning_token) {
        // Presented exactly as before this branch: a browser alert, with the
        // original wording. It now fires here rather than inside the store,
        // because the store no longer sees the result first — putting it back
        // there would show the token twice. Shown only after the server
        // confirmed the write, once, and the form stays open afterwards.
        if (typeof window !== "undefined") {
          window.alert(
            "Simpan token perangkat ini sekali. Token tidak akan ditampilkan lagi:\n\n" +
              r.provisioning_token,
          );
        }
        return;
      }
      onDone("Data berhasil disimpan di perangkat.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (confirm("Tutup form dan buang isian yang belum disimpan?")) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <small>BIOFLOG / CATATAN FARM</small>
            <h2>{spec.title}</h2>
          </div>
          <button
            type="button"
            className="icon"
            aria-label="Tutup form"
            onClick={() => {
              if (confirm("Tutup form dan buang isian yang belum disimpan?")) onClose();
            }}
          >
            <X />
          </button>
        </div>
        {spec.help && <p className="notice">{spec.help}</p>}
        <div className="form-grid">
          {spec.fields.map((f) => (
            <label key={f.key} className={f.type === "textarea" || f.type === "json" ? "full" : ""}>
              {f.label}
              {f.options ? (
                <select
                  required={f.required !== false}
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                >
                  {f.options.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" || f.type === "json" ? (
                <textarea
                  required={f.required !== false}
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              ) : (
                <input
                  autoFocus={spec.fields[0] === f}
                  required={f.required !== false}
                  type={f.type || "text"}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  step="any"
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              )}
              <small>{f.hint}</small>
            </label>
          ))}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          <small>Ledger lokal memeriksa izin, saldo, dan periode.</small>
          <button disabled={busy} className="primary">
            {busy ? "Memproses…" : "Simpan catatan"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function BioflogApp() {
  const store = useBioflog();
  const [page, setPage] = useState("dashboard");
  const [form, setForm] = useState<FormSpec | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [loginError, setLoginError] = useState("");
  const [audit, setAudit] = useState<Row[]>([]);
  const [tick, setTick] = useState(0);
  const dateToday = new Date().toLocaleDateString("en-CA");
  const [from, setFrom] = useState(dateToday.slice(0, 7) + "-01");
  const [to, setTo] = useState(dateToday);
  const [email, setEmail] = useState("admin@bioflog.local");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [ready, setReady] = useState(false);
  // Forced password rotation. Held in component state only — never persisted,
  // never logged.
  const [rotCurrent, setRotCurrent] = useState("");
  const [rotNext, setRotNext] = useState("");
  const [rotConfirm, setRotConfirm] = useState("");
  const [rotError, setRotError] = useState("");
  const [rotBusy, setRotBusy] = useState(false);

  useEffect(() => {
    setReady(true);
    void useBioflog.getState().pullRemote();
  }, []);

  const user = store.user();
  const state = store.state();

  function go(p: string) {
    setPage(p);
    setMenu(false);
    setQuery("");
  }
  function done(s: string) {
    setNotice(s);
    setTick((n) => n + 1);
  }
  function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoginError("");
    try {
      store.login(email, password);
      setPage("dashboard");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Gagal masuk");
    }
  }
  async function submitRotation(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRotError("");
    const invalid = validatePasswordChange({
      current: rotCurrent,
      next: rotNext,
      confirm: rotConfirm,
    });
    if (invalid) {
      setRotError(invalid.message);
      return;
    }
    setRotBusy(true);
    try {
      await store.changePassword(rotCurrent, rotNext);
      // Success clears the session in the store; drop the plaintext we held.
      setRotCurrent("");
      setRotNext("");
      setRotConfirm("");
      setPassword("");
      setPage("dashboard");
    } catch (err) {
      setRotError(err instanceof Error ? err.message : "Gagal mengganti password.");
    } finally {
      setRotBusy(false);
    }
  }

  function logout() {
    if (!confirm("Keluar dari farm?")) return;
    store.logout();
    setPage("dashboard");
    setNotice("");
    setError("");
    setSelected("");
  }

  if (!ready || !store.hydrated)
    return (
      <div className="loading">
        <Fish size={40} />
        <h2>Menyambungkan ke Neon…</h2>
      </div>
    );

  // Forced password rotation. A legacy pilot credential logs in successfully but
  // the server withholds the farm view until the password is rotated, so the
  // account has a user and no state. This branch MUST come before the login
  // gate below: sending it to the login form is what deadlocked the account,
  // because the only password form lived behind the view.
  if (user && !state && store.requiresPasswordChange)
    return (
      <div className="login">
        <div className="login-story">
          <div className="brand">
            <Fish size={40} />
            <div>
              BIOFLOG<small>SABAK SENTRAL</small>
            </div>
          </div>
          <div>
            <span className="eyebrow">KEAMANAN AKUN</span>
            <h1>
              Ganti password
              <br />
              pilot lama
              <br />
              <em>sekali saja.</em>
            </h1>
            <p>
              Akun ini masih memakai password pilot yang pernah dipublikasikan. Data farm
              dibuka setelah Anda memilih password baru.
            </p>
          </div>
          <small>BFG-SS-BP-001 · Rotasi kredensial wajib</small>
        </div>
        <form className="login-form" onSubmit={submitRotation}>
          <span className="eyebrow">ROTASI KREDENSIAL WAJIB</span>
          <h2>Buat password baru</h2>
          <p className="muted">
            Password baru minimal {PASSWORD_MIN} karakter dan harus berbeda dari password
            lama. Pilih sendiri — jangan bagikan kepada siapa pun.
          </p>
          <label>
            Akun
            <input type="email" value={user.email} readOnly disabled />
          </label>
          <label>
            Password saat ini
            <input
              type="password"
              required
              autoComplete="current-password"
              value={rotCurrent}
              onChange={(e) => setRotCurrent(e.target.value)}
            />
          </label>
          <label>
            Password baru
            <input
              type="password"
              required
              minLength={PASSWORD_MIN}
              autoComplete="new-password"
              value={rotNext}
              onChange={(e) => setRotNext(e.target.value)}
            />
          </label>
          <label>
            Konfirmasi password baru
            <input
              type="password"
              required
              minLength={PASSWORD_MIN}
              autoComplete="new-password"
              value={rotConfirm}
              onChange={(e) => setRotConfirm(e.target.value)}
            />
          </label>
          {rotError && <p className="error">{rotError}</p>}
          <button className="primary" disabled={rotBusy}>
            {rotBusy ? "Menyimpan…" : "Ganti password dan masuk kembali"}
            <ChevronRight size={18} />
          </button>
          <button type="button" className="secondary" onClick={() => store.logout()}>
            Batal dan keluar
          </button>
        </form>
      </div>
    );

  if (!user || !state)
    return (
      <div className="login">
        <div className="login-story">
          <div className="brand">
            <Fish size={40} />
            <div>
              BIOFLOG<small>SABAK SENTRAL</small>
            </div>
          </div>
          <div>
            <span className="eyebrow">CATAT DENGAN PASTI. RAWAT LEBIH BAIK.</span>
            <h1>
              Setiap kolam,
              <br />
              satu cerita
              <br />
              <em>pertumbuhan.</em>
            </h1>
            <p>Pakan, kualitas air, dan pekerjaan harian dalam satu catatan farm yang terhubung.</p>
            <div className="water-art">
              <div />
              <div />
              <div />
            </div>
          </div>
          <small>BFG-SS-BP-001 · Aplikasi mandiri v0.1</small>
        </div>
        <form className="login-form" onSubmit={login}>
          <span className="eyebrow">SELAMAT DATANG KEMBALI</span>
          <h2>Masuk ke farm Anda</h2>
          <p className="muted">
            {store.dbSource === "neon"
              ? `Tersimpan di Neon · ${store.pondCount} kolam Farm Utama.`
              : store.dbSource === "pglite"
                ? "Pratinjau lokal — data Neon dipakai saat DATABASE_URL tersedia."
                : "Menyambungkan database…"}
          </p>
          {store.syncError && <p className="error">{store.syncError}</p>}
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {loginError && <p className="error">{loginError}</p>}
          <button className="primary">
            Masuk ke BIOFLOG <ChevronRight size={18} />
          </button>
          <small>Akun demo · password sama: {DEMO_PASSWORD}</small>
          <div className="demo-accounts">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                type="button"
                key={a.email}
                className="secondary"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                {a.role} · {a.email}
              </button>
            ))}
          </div>
        </form>
      </div>
    );

  const canWrite = user.role !== "Pembaca";
  const manager = ["Admin", "Manajer"].includes(user.role);
  const ponds: Row[] = state.ponds;
  const cycles: Row[] = state.cycles;
  const active = cycles.filter((c) => c.status === "active");
  const cyOpts: [string, string][] = active.map((c) => [
    c.id,
    (ponds.find((p) => p.id === c.pond_id)?.code || "") + " · " + c.species,
  ]);
  const poOpts: [string, string][] = ponds.map((p) => [p.id, p.code + " · " + p.name]);
  const lotOpts: [string, string][] = state.lots.map((l: Row) => [
    l.id,
    l.name + " · " + fmt(l.stock_kg) + " kg",
  ]);
  const selectCycle: Field = {
    key: "cycle_id",
    label: "Kolam / siklus aktif",
    options: cyOpts,
    value: selected || cyOpts[0]?.[0],
  };
  const timeField: Field = {
    key: "occurred_at",
    label: "Waktu aktual",
    type: "datetime-local",
    required: false,
    hint: "Kosong = waktu saat formulir disimpan.",
  };
  const noteField: Field = { key: "note", label: "Catatan", type: "textarea", required: false };

  let report: Row | null = null;
  if (page === "finance" && user.finance) {
    try {
      report = store.financeReport(from, to);
    } catch {
      report = null;
    }
  }

  function recordForm(action: string) {
    const specs: Record<string, FormSpec> = {
      "feed-events": {
        title: "Catat pemberian pakan",
        action,
        fields: [
          selectCycle,
          { key: "lot_id", label: "Lot persediaan", options: lotOpts },
          { key: "kg", label: "Pakan aktual (kg)", type: "number" },
          timeField,
          {
            key: "response",
            label: "Respons ikan",
            options: [
              ["aktif", "Aktif"],
              ["kurang", "Kurang aktif"],
            ],
          },
          noteField,
        ],
      },
      "water-readings": {
        title: "Catat kualitas air",
        action,
        fields: [
          selectCycle,
          {
            key: "parameter",
            label: "Parameter",
            options: [
              ["do", "DO · mg/L"],
              ["ph", "pH"],
              ["temperature", "Suhu · °C"],
              ["floc", "Volume flok · mL/L"],
              ["tan", "TAN · mg/L"],
              ["alkalinity", "Alkalinitas · mg/L CaCO3"],
            ],
          },
          { key: "value", label: "Nilai pengukuran", type: "number" },
          { key: "method", label: "Metode / alat uji", value: "manual" },
          timeField,
          noteField,
        ],
      },
      samplings: {
        title: "Catat sampling",
        action,
        fields: [
          selectCycle,
          { key: "count", label: "Jumlah sampel (ekor)", type: "number", value: 30 },
          {
            key: "total_weight_g",
            label: "Berat total sampel (gram)",
            type: "number",
            hint: "Contoh: 4260 g / 30 ekor = 142 g per ekor.",
          },
          { key: "method", label: "Metode", value: "acak" },
          timeField,
          noteField,
        ],
      },
      mortalities: {
        title: "Catat mortalitas",
        action,
        fields: [
          selectCycle,
          { key: "count", label: "Jumlah ikan mati (ekor)", type: "number" },
          timeField,
          { ...noteField, required: true },
        ],
        help: "Catatan sah mengurangi populasi sekali. Pastikan kejadian belum pernah dicatat.",
      },
      health: {
        title: "Pengamatan kesehatan",
        action,
        fields: [
          selectCycle,
          { key: "observation", label: "Gejala / perilaku yang diamati", type: "textarea" },
          { key: "follow_up", label: "Tindak lanjut pemeriksaan", type: "textarea" },
          timeField,
        ],
        help: "Pengamatan ini bukan diagnosis otomatis.",
      },
      ponds: {
        title: "Tambah kolam",
        action,
        fields: [
          { key: "code", label: "Kode kolam", value: "A13" },
          { key: "name", label: "Nama kolam" },
          { key: "block", label: "Blok", value: "A" },
          {
            key: "shape",
            label: "Bentuk",
            options: [
              ["round", "Bulat"],
              ["rectangle", "Persegi panjang"],
            ],
          },
          { key: "diameter_mm", label: "Diameter (mm)", type: "number", value: 4000 },
          { key: "length_mm", label: "Panjang (mm)", type: "number", value: 4000 },
          { key: "width_mm", label: "Lebar (mm)", type: "number", value: 4000 },
          { key: "depth_mm", label: "Kedalaman air (mm)", type: "number", value: 1000 },
          { key: "capacity", label: "Kapasitas maksimum (ekor)", type: "number", value: 5000 },
        ],
      },
      cycles: {
        title: "Mulai siklus budidaya",
        action,
        fields: [
          { key: "pond_id", label: "Kolam", options: poOpts },
          { key: "species", label: "Spesies", value: "Nila" },
          { key: "seed_batch", label: "Batch / cohort benih" },
          { key: "count", label: "Jumlah tebar (ekor)", type: "number" },
          { key: "abw_g", label: "Bobot awal (g/ekor)", type: "number" },
          { ...timeField, key: "started_at", label: "Waktu tebar" },
        ],
      },
      lots: {
        title: "Terima lot pakan",
        action,
        fields: [
          { key: "name", label: "Nama pakan / nomor lot" },
          { key: "supplier", label: "Pemasok" },
          { key: "document", label: "Nomor dokumen pembelian" },
          { key: "kg", label: "Berat bersih (kg)", type: "number" },
          { key: "unit_cost", label: "Harga per kg (rupiah)", type: "number" },
          { key: "expires_at", label: "Tanggal kedaluwarsa", type: "date" },
          { ...timeField, key: "received_at", label: "Waktu diterima" },
        ],
      },
      "fish-transfers": {
        title: "Transfer ikan",
        action,
        fields: [
          { ...selectCycle, key: "source_cycle_id", label: "Siklus sumber" },
          { ...selectCycle, key: "destination_cycle_id", label: "Siklus tujuan" },
          { key: "count", label: "Jumlah ekor", type: "number" },
          { key: "kg", label: "Berat transfer (kg)", type: "number" },
          { key: "reason", label: "Alasan", type: "textarea" },
          timeField,
        ],
        help: "Sumber dan tujuan harus aktif, satu spesies dan satu cohort benih.",
      },
      "harvest-plans": {
        title: "Rencanakan panen",
        action,
        fields: [
          selectCycle,
          { key: "kg", label: "Estimasi berat (kg)", type: "number" },
          { ...timeField, label: "Rencana waktu panen", required: true },
          noteField,
        ],
        help: "Rencana tidak mengurangi populasi atau menambah pendapatan.",
      },
      harvests: {
        title: "Draf hasil panen",
        action,
        fields: [
          selectCycle,
          { key: "kg", label: "Total berat netto (kg)", type: "number" },
          { key: "count", label: "Jumlah ekor aktual", type: "number" },
          { key: "grade_a", label: "Grade A (kg)", type: "number" },
          { key: "grade_b", label: "Grade B (kg)", type: "number", value: 0 },
          timeField,
          noteField,
        ],
        transform: (p) => {
          const grades = [
            { grade: "A", kg: p.grade_a },
            { grade: "B", kg: p.grade_b },
          ].filter((g) => Number(g.kg) > 0);
          const { grade_a, grade_b, ...rest } = p;
          return { ...rest, grades, count_method: "counted" };
        },
        help: "Jumlah grade wajib sama dengan netto. Draf memerlukan pengesahan Manajer/Admin.",
      },
      orders: {
        title: "Buat pesanan penjualan",
        action,
        fields: [
          { key: "buyer", label: "Nama pembeli" },
          {
            key: "lot_id",
            label: "Lot panen / grade",
            options: state!.harvest_lots.map((l: Row) => [
              l.id,
              `Grade ${l.grade} · ${fmt(l.available_kg)} kg tersedia`,
            ]),
          },
          { key: "kg", label: "Berat dialokasikan (kg)", type: "number" },
          { key: "price_per_kg", label: "Harga jual per kg (rupiah)", type: "number" },
          timeField,
        ],
        transform: (p) => ({
          buyer: p.buyer,
          occurred_at: p.occurred_at,
          lines: [{ lot_id: p.lot_id, kg: p.kg, price_per_kg: p.price_per_kg }],
        }),
      },
      expenses: {
        title: "Catat biaya operasional",
        action,
        fields: [
          { ...selectCycle, options: [["", "Biaya farm / belum dialokasikan"], ...cyOpts] },
          {
            key: "category",
            label: "Kategori",
            options: [
              ["energi", "Energi"],
              ["benih", "Benih"],
              ["tenaga kerja", "Tenaga kerja"],
              ["overhead", "Overhead"],
            ],
          },
          { key: "amount", label: "Nilai rupiah", type: "number" },
          { key: "reference", label: "Nomor bukti" },
          timeField,
          { ...noteField, required: true },
        ],
        help: "Konsumsi pakan dihitung dari ledger pakan, jangan dicatat lagi sebagai biaya manual.",
      },
      payments: {
        title: "Terima pembayaran",
        action,
        fields: [
          {
            key: "invoice_id",
            label: "Invoice",
            options: (report?.invoices || [])
              .filter((i: Row) => i.balance > 0)
              .map((i: Row) => [i.id, `${i.id.slice(0, 8)} · sisa ${rupiah(i.balance)}`]),
          },
          { key: "amount", label: "Nilai pembayaran (rupiah)", type: "number" },
          { key: "reference", label: "Referensi pembayaran" },
          timeField,
        ],
      },
      "periods/lock": {
        title: "Kunci periode",
        action,
        fields: [{ key: "through_date", label: "Kunci sampai tanggal", type: "date" }],
        help: "Catatan dan koreksi bertanggal dalam periode terkunci akan ditolak.",
      },
      tasks: {
        title: "Buat tugas",
        action,
        fields: [
          { key: "pond_id", label: "Kolam", options: poOpts },
          { key: "title", label: "Judul tugas" },
          {
            key: "assignee_id",
            label: "PIC",
            options: state!.team
              .filter((u: Row) => u.active && u.role !== "Pembaca")
              .map((u: Row) => [u.id, u.name]),
          },
          {
            key: "priority",
            label: "Prioritas",
            options: [
              ["normal", "Normal"],
              ["high", "Tinggi"],
              ["critical", "Kritis"],
            ],
          },
          { key: "due_at", label: "Tenggat", type: "datetime-local", required: true },
          {
            key: "checklist_text",
            label: "Checklist · satu item setiap baris",
            type: "textarea",
            value: "Periksa kondisi kolam\nCatat hasil pemeriksaan",
          },
        ],
        transform: ({ checklist_text, ...p }) => ({
          ...p,
          checklist: String(checklist_text)
            .split("\n")
            .filter(Boolean),
        }),
      },
      devices: {
        title: "Daftarkan perangkat",
        action,
        fields: [
          { key: "pond_id", label: "Kolam", options: poOpts },
          { key: "name", label: "Nama perangkat" },
          {
            key: "kind",
            label: "Jenis",
            options: [
              ["sensor", "Sensor"],
              ["blower", "Blower cadangan"],
            ],
          },
        ],
        help: "Token hanya ditampilkan setelah pendaftaran. Kontrol alat nonaktif sampai commissioning teknisi.",
      },
      users: {
        title: "Tambah anggota",
        action,
        fields: [
          { key: "name", label: "Nama lengkap" },
          { key: "email", label: "Email", type: "email" },
          { key: "password", label: "Password awal ≥12 karakter", type: "password" },
          {
            key: "role",
            label: "Peran",
            options: [
              ["Operator", "Operator"],
              ["Manajer", "Manajer"],
              ["Pembaca", "Pembaca"],
              ["Admin", "Admin"],
            ],
          },
          { key: "block", label: "Cakupan blok (* = seluruh farm)", value: "A" },
          {
            key: "finance",
            label: "Izin keuangan",
            options: [
              ["0", "Tidak"],
              ["1", "Ya · perlu seluruh farm"],
            ],
          },
        ],
        help: "Pembuatan akun lokal. Tidak mengirim email undangan.",
      },
      sops: {
        title: "Terbitkan SOP pengukuran",
        action,
        fields: [
          { key: "species", label: "Spesies", value: "Nila" },
          {
            key: "parameter",
            label: "Parameter",
            options: [
              ["do", "DO"],
              ["ph", "pH"],
              ["temperature", "Suhu"],
              ["floc", "Flok"],
              ["tan", "TAN"],
              ["alkalinity", "Alkalinitas"],
            ],
          },
          { key: "method", label: "Metode", value: "manual" },
          { key: "min_value", label: "Batas minimum", type: "number" },
          { key: "max_value", label: "Batas maksimum", type: "number" },
          { key: "stale_minutes", label: "Batas kesegaran (menit)", type: "number", value: 120 },
          { key: "effective_at", label: "Mulai berlaku (waktu mendatang)", type: "datetime-local" },
        ],
        help: "Ambang harus mengikuti SOP farm yang telah ditinjau, bukan angka universal.",
      },
    };
    if (!specs[action]) return;
    setForm(specs[action]);
  }

  const button = (action: string, label: string, primary = false) => (
    <button className={primary ? "primary" : "secondary"} onClick={() => recordForm(action)}>
      <Plus size={16} />
      {label}
    </button>
  );
  const cycleCode = (id: string) => {
    const cy = cycles.find((c) => c.id === id);
    return ponds.find((p) => p.id === cy?.pond_id)?.code || "Farm";
  };
  const recordRows = (kinds: string[]) =>
    state.records.filter((r: Row) => kinds.includes(r.kind) && (!selected || r.cycle_id === selected));
  const recordValue = (r: Row) =>
    r.kind === "water"
      ? `${r.data.parameter}: ${r.data.value} ${r.data.unit}`
      : r.kind === "sampling"
        ? `${fmt(r.data.abw_g)} g/ekor · ${r.data.count} sampel`
        : r.data.grams
          ? `${fmt(r.data.grams / 1000)} kg`
          : r.data.count
            ? `${fmt(r.data.count, 0)} ekor`
            : r.data.observation || r.data.note || "—";
  const recordTable = (rr: Row[], actions?: (r: Row) => React.ReactNode) => (
    <Table
      rows={rr}
      columns={[
        ["occurred_at", "Waktu", (v) => date(v)],
        ["cycle_id", "Kolam", (v) => cycleCode(v)],
        ["kind", "Catatan", (v) => kindNames[v] || v],
        ["data", "Hasil", (_, r) => recordValue(r)],
        ["status", "Status", (v) => <Badge value={v} />],
      ]}
      action={actions}
    />
  );

  function downloadCsv() {
    if (!report) return;
    const lines = [
      ["Dasar", report.basis],
      ["Dari", report.from],
      ["Sampai", report.to],
      ["Pendapatan invoice", report.revenue],
      ["Biaya", report.cost],
      ["Selisih", report.difference],
      ["Kas masuk", report.cash_received],
      ["Piutang saat ini", report.receivables_current],
      [],
      ["Invoice", "Nilai", "Dibayar", "Sisa"],
      ...report.invoices.map((i: Row) => [i.id, i.amount, i.paid, i.balance]),
      [],
      ["Kategori", "Kolam", "Rupiah", "Waktu"],
      ...report.costs.map((c: Row) => [c.category, cycleCode(c.cycle_id), c.amount, c.occurred_at]),
    ];
    const csv = lines.map((row) => (row as unknown[]).map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bioflog-laporan-${from}-${to}.csv`;
    a.click();
  }

  void tick;
  let content: React.ReactNode;
  if (page === "dashboard") {
    const k = state.kpis;
    const filtered = ponds.filter((p) =>
      (p.code + " " + p.name).toLowerCase().includes(query.toLowerCase()),
    );
    content = (
      <>
        <div className="metrics">
          <Metric
            icon={Cylinder}
            label="Kolam aktif"
            value={fmt(k.active_ponds, 0)}
            note={`${ponds.filter((p) => p.condition === "Perlu cek").length} kolam perlu dicek`}
            onClick={() => go("ponds")}
          />
          <Metric
            icon={Fish}
            label="Estimasi biomassa"
            value={fmt(k.biomass_kg) + " kg"}
            note={`Sampling tersedia: ${k.biomass_coverage} siklus`}
            onClick={() => go("growth")}
          />
          <Metric
            icon={Package}
            label="Pakan hari ini"
            value={fmt(k.feed_today_kg) + " kg"}
            note="Realisasi yang telah disahkan"
            onClick={() => go("feed")}
          />
          <Metric
            icon={TrendingUp}
            label="FCR operasional"
            value={fmt(k.fcr, 2)}
            note="Pakan / pertambahan biomassa"
            onClick={() => go("growth")}
          />
        </div>
        <div className="dashboard-grid">
          <section className="card pond-map">
            <div className="section-head">
              <h2>Kondisi kolam</h2>
              <span className="muted">{ponds.length} kolam terdaftar</span>
            </div>
            <div className="pond-grid">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelected(p.cycle?.id || "");
                    go("ponds");
                  }}
                  className="pond-tile"
                >
                  <div className={"pond-art " + (p.condition === "Perlu cek" ? "amber" : "")}>
                    <span />
                    <i />
                    <b />
                  </div>
                  <strong>{p.code}</strong>
                  <small>{p.condition}</small>
                </button>
              ))}
            </div>
            <div className="legend">
              <span>● Stabil</span>
              <span>● Perlu cek</span>
              <span>○ Belum dinilai</span>
            </div>
          </section>
          <section className="card">
            <div className="section-head">
              <h2>Prioritas hari ini</h2>
              <button className="link" onClick={() => go("tasks")}>
                Lihat semua <ChevronRight size={14} />
              </button>
            </div>
            {state.tasks
              .filter((t: Row) => !["done", "cancelled"].includes(t.status))
              .slice(0, 4)
              .map((t: Row) => (
                <button className="priority-item" key={t.id} onClick={() => go("tasks")}>
                  <span className="alert-icon">
                    <AlertTriangle size={19} />
                  </span>
                  <div>
                    <strong>{t.title}</strong>
                    <small>{date(t.due_at)}</small>
                  </div>
                  <ChevronRight size={16} />
                </button>
              ))}
            {!state.tasks.filter((t: Row) => !["done", "cancelled"].includes(t.status)).length && (
              <Empty text="Belum ada tugas. Buat pekerjaan harian pertama." />
            )}
            <div className="quiet-note">
              Tugas selesai memerlukan checklist, catatan bukti, dan verifikasi.
            </div>
          </section>
          <section className="card">
            <div className="section-head">
              <h2>Biomassa per kolam</h2>
              <span className="muted">Sampling terakhir</span>
            </div>
            <div className="bar-chart" aria-label="Estimasi biomassa kilogram per kolam">
              {ponds
                .filter((p) => p.cycle)
                .map((p) => (
                  <div className="bar-item" key={p.id}>
                    <small>{fmt(p.cycle.biomass_kg, 0)}</small>
                    <div className="bar-track">
                      <span
                        style={{
                          height:
                            ((p.cycle.biomass_kg || 0) /
                              Math.max(1, ...active.map((c) => c.biomass_kg || 0))) *
                              100 +
                            "%",
                        }}
                      />
                    </div>
                    <small>{p.code}</small>
                  </div>
                ))}
            </div>
            <small className="muted">Estimasi kg · nilai belum tersedia tidak dianggap nol.</small>
          </section>
          <section className="card">
            <div className="section-head">
              <h2>Aktivitas terbaru</h2>
              <button className="link" onClick={() => go("history")}>
                Riwayat <ChevronRight size={14} />
              </button>
            </div>
            {state.records.slice(0, 4).map((r: Row) => (
              <div className="activity-item" key={r.id}>
                <span className="metric-icon">
                  <Activity size={18} />
                </span>
                <div>
                  <strong>{kindNames[r.kind] || r.kind}</strong>
                  <small>
                    {cycleCode(r.cycle_id)} · {recordValue(r)}
                  </small>
                </div>
                <time>
                  {new Date(r.occurred_at).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            ))}
          </section>
        </div>
      </>
    );
  } else if (page === "ponds") {
    const filtered = ponds.filter(
      (p) =>
        (p.code + " " + p.name).toLowerCase().includes(query.toLowerCase()) &&
        (!selected || p.cycle?.id === selected),
    );
    content = (
      <>
        <div className="toolbar">
          {manager && (
            <>
              {button("ponds", "Tambah kolam")}
              {button("cycles", "Mulai siklus")}
              {button("fish-transfers", "Transfer ikan")}
            </>
          )}
          <button className="secondary" onClick={() => setSelected("")}>
            Semua kolam
          </button>
        </div>
        <div className="pond-cards">
          {filtered.map((p) => (
            <section className="card" key={p.id}>
              <div className="section-head">
                <div>
                  <span className="eyebrow">BLOK {p.block}</span>
                  <h2>
                    {p.code} · {p.name}
                  </h2>
                </div>
                <Badge value={p.cycle ? "active" : "Persiapan"} />
              </div>
              <div className="pond-summary">
                <div className={"pond-art " + (p.condition === "Perlu cek" ? "amber" : "")}>
                  <span />
                  <i />
                  <b />
                </div>
                <div>
                  <Badge value={p.condition} />
                  <p className="muted">
                    {p.cycle?.species || "Belum ada siklus"}
                    <br />
                    Kapasitas {fmt(p.capacity, 0)} ekor
                  </p>
                </div>
              </div>
              {p.cycle && (
                <>
                  <div className="mini-metrics">
                    <div>
                      <small>Populasi</small>
                      <strong>{fmt(p.cycle.population, 0)} ekor</strong>
                    </div>
                    <div>
                      <small>ABW</small>
                      <strong>{fmt(p.cycle.abw_g)} g</strong>
                    </div>
                    <div>
                      <small>Biomassa</small>
                      <strong>{fmt(p.cycle.biomass_kg)} kg</strong>
                    </div>
                    <div>
                      <small>SR cohort</small>
                      <strong>{fmt(p.cycle.sr_percent)}%</strong>
                    </div>
                  </div>
                  <small className="muted">Sampling: {date(p.cycle.sampling_at)}</small>
                  <div className="toolbar">
                    {canWrite && (
                      <button
                        className="primary"
                        onClick={() => {
                          setSelected(p.cycle.id);
                          go("record");
                        }}
                      >
                        <Plus size={16} />
                        Catat aktivitas
                      </button>
                    )}
                    <button
                      className="link"
                      onClick={() => {
                        setSelected(p.cycle.id);
                        go("growth");
                      }}
                    >
                      Riwayat <ChevronRight size={15} />
                    </button>
                    {manager && p.cycle.population === 0 && (
                      <button
                        className="secondary"
                        onClick={() =>
                          setForm({
                            title: "Tutup siklus",
                            action: "cycles/close",
                            base: { cycle_id: p.cycle.id, expected_version: p.cycle.version },
                            fields: [],
                            help: "Memeriksa sisa populasi, draf, dan persetujuan sebelum menutup.",
                          })
                        }
                      >
                        Tutup siklus
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          ))}
        </div>
      </>
    );
  } else if (page === "water") {
    content = (
      <>
        <div className="toolbar">
          {canWrite && button("water-readings", "Catat pengukuran", true)}
          {manager && user.block === "*" && button("sops", "Terbitkan SOP")}
          <select aria-label="Filter kolam" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Semua kolam</option>
            {cyOpts.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <p className="notice">
          Nilai mengikuti waktu ukur dan metode. Tanpa SOP yang sesuai, kondisi ditandai “Belum
          dinilai”.
        </p>
        <Table
          rows={state.water.filter((r: Row) => !selected || r.cycle_id === selected)}
          columns={[
            ["cycle_id", "Kolam", (v) => cycleCode(v)],
            ["data", "Parameter", (v) => v.parameter],
            ["data", "Nilai", (v) => `${v.value} ${v.unit}`],
            ["data", "Sumber / metode", (v) => `${v.source} / ${v.method}`],
            ["occurred_at", "Waktu ukur", (v) => date(v)],
            ["assessment", "Kondisi", (v) => <Badge value={v} />],
          ]}
        />
        <section className="card spaced">
          <h2>Riwayat pengukuran manual</h2>
          {recordTable(recordRows(["water"]))}
        </section>
      </>
    );
  } else if (page === "feed") {
    content = (
      <>
        <div className="toolbar">
          {canWrite && button("feed-events", "Catat pakan", true)}
          {manager && !!user.finance && button("lots", "Terima lot pakan")}
        </div>
        <div className="card">
          <h2>Persediaan per lot</h2>
          <Table
            rows={state.lots}
            columns={[
              ["name", "Lot pakan"],
              ["stock_kg", "Saldo", (v) => fmt(v) + " kg"],
              ["expires_at", "Kedaluwarsa"],
              ...(user.finance
                ? ([["unit_cost", "Harga per kg", (v: any) => rupiah(v)]] as [
                    string,
                    string,
                    (v: any, r: Row) => React.ReactNode,
                  ][])
                : []),
            ]}
          />
        </div>
        <div className="card spaced">
          <h2>Riwayat pemberian pakan</h2>
          {recordTable(recordRows(["feed", "feed_reversal"]), (r) =>
            canWrite && r.kind === "feed" && r.status === "posted" ? (
              <button
                className="secondary"
                onClick={() =>
                  setForm({
                    title: "Ajukan koreksi pakan",
                    action: "approvals",
                    base: { record_id: r.id },
                    fields: [
                      {
                        key: "kg",
                        label: "Jumlah pengganti (kg)",
                        type: "number",
                        value: r.data.grams / 1000,
                      },
                      { key: "reason", label: "Alasan koreksi", type: "textarea" },
                    ],
                    help: "Koreksi baru mengubah stok dan biaya setelah reviewer lain menyetujui.",
                  })
                }
              >
                Koreksi
              </button>
            ) : null,
          )}
        </div>
      </>
    );
  } else if (page === "growth") {
    content = (
      <>
        <div className="toolbar">
          {canWrite && (
            <>
              {button("samplings", "Catat sampling", true)}
              {button("mortalities", "Mortalitas")}
              {button("health", "Pengamatan kesehatan")}
            </>
          )}
        </div>
        <Table
          rows={cycles.filter((c) => !selected || c.id === selected)}
          columns={[
            ["id", "Kolam", (v) => cycleCode(v)],
            ["population", "Populasi", (v) => fmt(v, 0)],
            ["abw_g", "ABW", (v) => fmt(v) + " g"],
            ["biomass_kg", "Biomassa", (v) => fmt(v) + " kg"],
            ["sr_percent", "SR", (v) => fmt(v) + "%"],
            ["fcr", "FCR", (v) => fmt(v, 2)],
            ["sampling_at", "Sampling terakhir", (v) => date(v)],
          ]}
        />
        <div className="notice">
          ABW = berat sampel / jumlah sampel. SR setelah transfer ditampilkan kosong karena belum
          mendukung campuran cohort. FCR tidak dihitung jika sampling lebih dari 7 hari.
        </div>
        <div className="card">{recordTable(recordRows(["sampling", "mortality", "health"]))}</div>
      </>
    );
  } else if (page === "devices") {
    content = (
      <>
        <div className="toolbar">{manager && button("devices", "Daftarkan perangkat")}</div>
        <p className="notice">
          Monitoring gateway tersedia. Kontrol fisik nonaktif secara bawaan dan memerlukan
          commissioning vendor. ACK diterima tidak berarti alat sudah menyala.
        </p>
        <Table
          rows={state.devices}
          columns={[
            ["name", "Perangkat"],
            ["connection", "Koneksi", (v) => <Badge value={v} />],
            ["actual_state", "Status aktual", (v) => <Badge value={v} />],
            ["last_seen", "Paket diterima", (v) => date(v)],
            ["state_measured_at", "Bukti status", (v) => date(v)],
          ]}
          action={(r) => (
            <>
              {manager && (
                <button
                  className="secondary"
                  onClick={() =>
                    setForm({
                      title: "Ganti token perangkat",
                      action: "devices/rotate-token",
                      base: { id: r.id, expected_version: r.version },
                      fields: [],
                      help: `Token lama ${r.name} langsung dicabut. Simpan token baru lalu pasang pada gateway perangkat yang sama.`,
                    })
                  }
                >
                  Ganti token
                </button>
              )}
              <small>Kontrol belum aktif</small>
            </>
          )}
        />
        <div className="card spaced">
          <h2>Pembacaan sensor</h2>
          <Table
            rows={state.telemetry || []}
            columns={[
              [
                "device_id",
                "Perangkat",
                (v) => state.devices.find((x: Row) => x.id === v)?.name || v,
              ],
              [
                "data",
                "Parameter / nilai",
                (v) =>
                  Object.entries(v.readings || {})
                    .map(([k, n]) => k + ": " + n)
                    .join(" · "),
              ],
              ["measured_at", "Waktu ukur", (v) => date(v)],
              ["received_at", "Waktu diterima", (v) => date(v)],
            ]}
          />
          <h2 className="spaced">Riwayat perintah</h2>
          <Table
            rows={state.commands}
            columns={[
              ["id", "ID perintah"],
              ["target", "Tujuan"],
              ["status", "Status", (v) => <Badge value={v} />],
              ["issued_at", "Dibuat", (v) => date(v)],
            ]}
          />
          <h2>Insiden koneksi</h2>
          <Table
            rows={state.incidents}
            columns={[
              ["kind", "Jenis"],
              ["status", "Status"],
              ["opened_at", "Terbuka", (v) => date(v)],
            ]}
          />
        </div>
      </>
    );
  } else if (page === "harvest") {
    content = (
      <>
        <div className="toolbar">
          {canWrite && (
            <>
              {button("harvest-plans", "Rencanakan panen")}
              {button("harvests", "Catat hasil panen", true)}
            </>
          )}
          {user.finance && canWrite && button("orders", "Buat pesanan")}
        </div>
        <div className="card">
          <h2>Rencana dan hasil panen</h2>
          {recordTable(recordRows(["harvest_plan", "harvest"]), (r) =>
            manager && r.status === "draft" ? (
              <button
                className="primary"
                onClick={() =>
                  setForm({
                    title: "Sahkan hasil panen",
                    action: "harvests/post",
                    base: { id: r.id, expected_version: r.version },
                    fields: [],
                    help: `Sahkan ${fmt(r.data.grams / 1000)} kg / ${r.data.count} ekor dari ${cycleCode(r.cycle_id)}. Populasi berkurang setelah disahkan.`,
                  })
                }
              >
                Sahkan
              </button>
            ) : null,
          )}
        </div>
        <div className="card spaced">
          <h2>Lot hasil siap dialokasikan</h2>
          <Table
            rows={state.harvest_lots}
            columns={[
              ["id", "Kode lot", (v) => v.slice(0, 8)],
              ["grade", "Grade"],
              ["grams", "Netto", (v) => fmt(v / 1000) + " kg"],
              ["available_kg", "Tersedia", (v) => fmt(v) + " kg"],
            ]}
          />
        </div>
        {user.finance && (
          <button className="secondary spaced" onClick={() => go("finance")}>
            Kelola pesanan, invoice & pembayaran <ChevronRight size={16} />
          </button>
        )}
      </>
    );
  } else if (page === "finance") {
    content = !user.finance ? (
      <Empty text="Anda tidak memiliki izin keuangan." />
    ) : (
      <>
        <div className="toolbar">
          <label>
            Dari
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Sampai
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {canWrite && (
            <>
              {button("expenses", "Catat biaya")}
              {button("payments", "Terima pembayaran")}
            </>
          )}
          <button className="secondary" onClick={downloadCsv}>
            <Download size={16} />
            Ekspor CSV
          </button>
        </div>
        {report ? (
          <>
            <div className="metrics">
              <Metric icon={Wallet} label="Pendapatan invoice" value={rupiah(report.revenue)} note="Invoice sah dalam periode" />
              <Metric icon={Package} label="Biaya operasional" value={rupiah(report.cost)} note="Konsumsi pakan + biaya operasi" />
              <Metric icon={TrendingUp} label="Selisih operasional" value={rupiah(report.difference)} note="Bukan laba bersih akuntansi" />
              <Metric
                icon={Clock}
                label="Piutang saat ini"
                value={rupiah(report.receivables_current)}
                note={"Kas masuk periode: " + rupiah(report.cash_received)}
              />
            </div>
            <p className="notice">{report.basis}</p>
            <section className="card">
              <h2>Pesanan & pengiriman</h2>
              <Table
                rows={report.orders}
                columns={[
                  ["buyer", "Pembeli"],
                  ["status", "Status", (v) => <Badge value={v} />],
                  ["occurred_at", "Waktu", (v) => date(v)],
                ]}
                action={(r) =>
                  manager && r.status === "confirmed" ? (
                    <button
                      className="primary"
                      onClick={() =>
                        setForm({
                          title: "Konfirmasi pengiriman & invoice",
                          action: "orders/ship",
                          base: { id: r.id, expected_version: r.version },
                          fields: [
                            { key: "reference", label: "Nomor bukti pengiriman" },
                            timeField,
                          ],
                          help: "Versi ini mengirim seluruh alokasi pesanan sekaligus.",
                        })
                      }
                    >
                      Kirim & buat invoice
                    </button>
                  ) : null
                }
              />
            </section>
            <section className="card spaced">
              <h2>Invoice & saldo pembayaran</h2>
              <Table
                rows={report.invoices}
                columns={[
                  ["id", "Invoice", (v) => v.slice(0, 8)],
                  ["amount", "Nilai", (v) => rupiah(v)],
                  ["paid", "Dibayar", (v) => rupiah(v)],
                  ["balance", "Sisa", (v) => rupiah(v)],
                ]}
              />
            </section>
            <section className="card spaced">
              <h2>Biaya periode terpilih</h2>
              <Table
                rows={report.costs}
                columns={[
                  ["category", "Kategori"],
                  ["cycle_id", "Kolam", (v) => cycleCode(v)],
                  ["amount", "Rupiah", (v) => rupiah(v)],
                  ["occurred_at", "Waktu", (v) => date(v)],
                ]}
              />
              {manager && button("periods/lock", "Kunci periode")}
            </section>
          </>
        ) : (
          <Empty text="Memuat laporan…" />
        )}
      </>
    );
  } else if (page === "tasks") {
    content = (
      <>
        <div className="toolbar">{canWrite && button("tasks", "Buat tugas", true)}</div>
        <div className="kanban">
          {["scheduled", "working", "awaiting_verification", "done"].map((status) => (
            <section key={status}>
              <h3>
                {statusNames[status]}{" "}
                <span>{state.tasks.filter((t: Row) => t.status === status).length}</span>
              </h3>
              {state.tasks
                .filter((t: Row) => t.status === status)
                .map((t: Row) => (
                  <article className="task-card" key={t.id}>
                    <Badge value={t.priority} />
                    <h3>{t.title}</h3>
                    <p>{state.team.find((u: Row) => u.id === t.assignee_id)?.name}</p>
                    <small>
                      <Clock size={12} /> {date(t.due_at)}
                    </small>
                    <ul>
                      {t.checklist.map((x: Row, i: number) => (
                        <li key={i}>
                          {x.done ? "✓" : "○"} {x.label}
                        </li>
                      ))}
                    </ul>
                    {canWrite && status !== "done" && (
                      <button
                        className="secondary"
                        onClick={() =>
                          setForm({
                            title:
                              status === "scheduled"
                                ? "Mulai tugas"
                                : status === "working"
                                  ? "Ajukan hasil tugas"
                                  : "Verifikasi hasil tugas",
                            action: "tasks/update",
                            base: {
                              id: t.id,
                              expected_version: t.version,
                              status:
                                status === "scheduled"
                                  ? "working"
                                  : status === "working"
                                    ? "awaiting_verification"
                                    : "done",
                              checklist: t.checklist,
                            },
                            fields:
                              status === "scheduled"
                                ? []
                                : [
                                    {
                                      key: "evidence",
                                      label: "Catatan bukti pelaksanaan",
                                      type: "textarea",
                                      value: t.evidence,
                                    },
                                    {
                                      key: "confirmed",
                                      label: "Checklist telah diperiksa",
                                      options: [
                                        ["no", "Pilih setelah semua item selesai"],
                                        ["yes", "Semua item checklist selesai"],
                                      ],
                                    },
                                  ],
                            transform: (p) => {
                              if (status !== "scheduled" && p.confirmed !== "yes")
                                throw new Error("Konfirmasikan checklist setelah pemeriksaan.");
                              const { confirmed, ...rest } = p;
                              return {
                                ...rest,
                                checklist:
                                  status === "scheduled"
                                    ? t.checklist
                                    : t.checklist.map((x: Row) => ({ ...x, done: true })),
                              };
                            },
                            help:
                              status === "awaiting_verification"
                                ? "Hanya Manajer/Admin selain PIC dapat memverifikasi."
                                : "",
                          })
                        }
                      >
                        {status === "scheduled"
                          ? "Mulai"
                          : status === "working"
                            ? "Ajukan verifikasi"
                            : "Verifikasi"}
                      </button>
                    )}
                  </article>
                ))}
            </section>
          ))}
        </div>
        <section className="card spaced">
          <h2>Persetujuan koreksi pakan</h2>
          <Table
            rows={state.approvals}
            columns={[
              ["reason", "Alasan"],
              ["payload", "Jumlah pengganti", (v) => fmt(v.grams / 1000) + " kg"],
              ["status", "Status", (v) => <Badge value={v} />],
            ]}
            action={(a) =>
              manager && a.status === "submitted" && a.created_by !== user.id ? (
                <button
                  className="secondary"
                  onClick={() =>
                    setForm({
                      title: "Tinjau koreksi pakan",
                      action: "approvals/decide",
                      base: {
                        id: a.id,
                        expected_version: a.version,
                        payload_hash: a.payload_hash,
                      },
                      fields: [
                        {
                          key: "decision",
                          label: "Keputusan",
                          options: [
                            ["approved", "Setujui"],
                            ["rejected", "Tolak"],
                          ],
                        },
                        { key: "reason", label: "Alasan keputusan", type: "textarea" },
                      ],
                      help: `Alasan pengaju: ${a.reason}. Sebelum ${fmt(a.before_grams / 1000)} kg → pengganti ${fmt(a.payload.grams / 1000)} kg.`,
                    })
                  }
                >
                  Tinjau
                </button>
              ) : null
            }
          />
        </section>
      </>
    );
  } else if (page === "settings") {
    content = (
      <>
        <div className="settings-grid">
          <section className="card">
            <span className="eyebrow">PROFIL FARM</span>
            <h2>{state.farm.name}</h2>
            <p>{state.farm.address}</p>
            <p className="muted">Zona waktu: {state.farm.timezone}</p>
            {manager && user.block === "*" && (
              <button
                className="secondary"
                onClick={() =>
                  setForm({
                    title: "Ubah profil farm",
                    action: "farm",
                    base: { expected_version: state.farm.version },
                    fields: [
                      { key: "name", label: "Nama farm", value: state.farm.name },
                      { key: "address", label: "Alamat", value: state.farm.address },
                      { key: "timezone", label: "Zona waktu IANA", value: state.farm.timezone },
                    ],
                  })
                }
              >
                Edit profil
              </button>
            )}
          </section>
          <section className="card">
            <span className="eyebrow">AKUN ANDA</span>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <Badge value={user.role} />
            <p>Cakupan blok: {user.block}</p>
            <button
              className="secondary"
              onClick={() =>
                setForm({
                  title: "Ganti password",
                  action: "users/password",
                  fields: [
                    { key: "current_password", label: "Password saat ini", type: "password" },
                    {
                      key: "new_password",
                      label: "Password baru (minimal 12 karakter)",
                      type: "password",
                    },
                  ],
                  help: "Sesi akan dicabut. Masuk kembali dengan password baru.",
                })
              }
            >
              Ganti password
            </button>
          </section>
        </div>
        <p className="notice spaced">
          {store.dbSource === "neon"
            ? "Ledger farm tersimpan di Neon (BIOFLOG Sabak Sentral). Kode sumber ada di GitHub sabaksentrals-glitch/testinggue."
            : "Pratinjau memakai database lokal. Setelah deploy, baris yang sama hidup di Neon."}
        </p>
        <section className="card spaced">
          <div className="section-head">
            <h2>Tim & hak akses</h2>
            {user.role === "Admin" && user.block === "*" && button("users", "Tambah anggota")}
          </div>
          <Table
            rows={state.team}
            columns={[
              ["name", "Nama"],
              ["role", "Peran"],
              ["block", "Blok"],
              ["active", "Status", (v) => (v ? "Aktif" : "Nonaktif")],
            ]}
            action={(t) =>
              user.role === "Admin" && user.block === "*" ? (
                <button
                  className="secondary"
                  onClick={() =>
                    setForm({
                      title: "Ubah akses anggota",
                      action: "users/update",
                      base: { id: t.id, expected_version: t.version },
                      fields: [
                        {
                          key: "role",
                          label: "Peran",
                          value: t.role,
                          options: [
                            ["Admin", "Admin"],
                            ["Manajer", "Manajer"],
                            ["Operator", "Operator"],
                            ["Pembaca", "Pembaca"],
                          ],
                        },
                        { key: "block", label: "Blok", value: t.block },
                        {
                          key: "active",
                          label: "Status",
                          value: String(t.active),
                          options: [
                            ["1", "Aktif"],
                            ["0", "Nonaktif"],
                          ],
                        },
                        {
                          key: "finance",
                          label: "Izin keuangan",
                          value: String(t.finance ?? 0),
                          options: [
                            ["0", "Tidak"],
                            ["1", "Ya"],
                          ],
                        },
                      ],
                      help: "Admin aktif terakhir tidak dapat dihapus.",
                    })
                  }
                >
                  Edit akses
                </button>
              ) : null
            }
          />
        </section>
        <section className="card spaced">
          <div className="section-head">
            <h2>Versi SOP</h2>
            {manager && user.block === "*" && button("sops", "Terbitkan SOP")}
          </div>
          <Table
            rows={state.sops}
            columns={[
              ["species", "Spesies"],
              ["parameter", "Parameter"],
              ["method", "Metode"],
              ["min_value", "Minimum"],
              ["max_value", "Maksimum"],
              ["effective_at", "Berlaku", (v) => date(v)],
            ]}
          />
        </section>
        {user.role === "Admin" && user.block === "*" && (
          <section className="card spaced">
            <div className="toolbar">
              <button
                className="secondary"
                onClick={() => {
                  try {
                    setAudit(store.audit());
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Gagal audit");
                  }
                }}
              >
                Muat jejak audit terbaru
              </button>
              <button
                className="secondary danger"
                onClick={() => {
                  if (store.dbSource === "neon") {
                    if (confirm("Muat ulang data farm dari Neon? Perubahan yang belum tersimpan di perangkat ini akan diganti.")) {
                      store.resetDemo();
                      setNotice("Data dimuat ulang dari Neon.");
                    }
                    return;
                  }
                  if (confirm("Hapus semua data farm ini dan muat ulang data demo?")) {
                    store.resetDemo();
                    setNotice("Data demo dimuat ulang.");
                  }
                }}
              >
                {store.dbSource === "neon" ? "Muat ulang dari Neon" : "Pulihkan data demo"}
              </button>
            </div>
            <Table
              rows={audit}
              columns={[
                ["occurred_at", "Waktu", (v) => date(v)],
                ["action", "Aksi"],
                ["actor_id", "Pelaku"],
                ["object_id", "Objek", (v) => String(v).slice(0, 12)],
              ]}
            />
          </section>
        )}
      </>
    );
  } else if (page === "history") {
    content = (
      <section className="card">
        <h2>Riwayat catatan</h2>
        {recordTable(state.records)}
      </section>
    );
  } else {
    content = (
      <div className="quick-grid">
        {(
          [
            ["feed-events", "Pakan aktual", Package],
            ["water-readings", "Ukur kualitas air", Droplets],
            ["samplings", "Sampling pertumbuhan", TrendingUp],
            ["mortalities", "Mortalitas", Fish],
            ["health", "Pengamatan kesehatan", Activity],
            ["tasks", "Tugas lapangan", ClipboardCheck],
          ] as const
        ).map(([a, l, Icon]) => (
          <button disabled={!canWrite} key={a} onClick={() => recordForm(a)}>
            <Icon size={30} />
            <h2>{l}</h2>
            <ChevronRight />
          </button>
        ))}
      </div>
    );
  }

  const title =
    page === "dashboard"
      ? "Ringkasan farm"
      : page === "history"
        ? "Riwayat aktivitas"
        : page === "record"
          ? "Catat aktivitas"
          : nav.find((n) => n[0] === page)?.[1] || "Catat aktivitas";

  return (
    <div className="app">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <Fish size={34} />
          <div>
            BIOFLOG<small>SABAK SENTRAL</small>
          </div>
        </div>
        <span className="nav-label">OPERASIONAL FARM</span>
        <nav>
          {nav
            .filter((n) => n[0] !== "finance" || user.finance)
            .map(([id, label, Icon]) => (
              <button key={id} className={page === id ? "active" : ""} onClick={() => go(id)}>
                <Icon size={18} />
                {label}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{user.name}</strong>
            <small>
              {user.role} · {state.farm.name}
            </small>
          </div>
          <button onClick={logout} className="icon" aria-label="Keluar">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      {menu && (
        <button className="scrim" aria-label="Tutup menu" onClick={() => setMenu(false)} />
      )}
      <div className="workspace">
        <header>
          <button className="icon mobile-menu" onClick={() => setMenu(!menu)} aria-label="Buka menu">
            <Menu />
          </button>
          <div className="farm-label">
            <Cylinder size={18} />
            {state.farm.name}
            <Badge value={store.dbSource === "neon" ? "Neon" : "Online"} />
          </div>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Cari kolam"
              placeholder="Cari kode atau nama kolam…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!["dashboard", "ponds"].includes(page)) go("ponds");
              }}
            />
          </label>
          <span className="avatar">SS</span>
        </header>
        <main>
          <div className="page-head">
            <div>
              <div className="heading-line">
                <h1>{title}</h1>
                {state.demo && <Badge value="Data demo / pilot" />}
              </div>
              <p>
                {new Date().toLocaleDateString("id-ID", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                <span className="dot">·</span>Rekap{" "}
                {new Date(state.as_of).toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            {canWrite && (
              <button className="primary" onClick={() => go("record")}>
                <Plus size={18} />
                Catat aktivitas
              </button>
            )}
          </div>
          {notice && (
            <div className="notice toast" role="status">
              <Check size={17} />
              <span>{notice}</span>
              <button className="icon" aria-label="Tutup pemberitahuan" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button className="link" onClick={() => setError("")}>
                Tutup
              </button>
            </div>
          )}
          {content}
          <footer>
            BIOFLOG · SABAK SENTRAL{" "}
            <span>Catatan terhubung. Keputusan tetap di tangan pengelola.</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav">
        <button onClick={() => go("dashboard")}>
          <LayoutDashboard />
          Beranda
        </button>
        <button onClick={() => go("ponds")}>
          <Cylinder />
          Kolam
        </button>
        <button className="record-nav" onClick={() => go("record")}>
          <span>
            <Plus />
          </span>
          Catat
        </button>
        <button onClick={() => go("tasks")}>
          <ClipboardCheck />
          Tugas
        </button>
        <button onClick={() => setMenu(!menu)}>
          <Menu />
          Lainnya
        </button>
      </nav>
      {form && (
        <Editor
          key={form.action + JSON.stringify(form.base)}
          spec={form}
          onClose={() => setForm(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
