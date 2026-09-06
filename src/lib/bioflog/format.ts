export const kindNames: Record<string, string> = {
  feed: "Pakan diberikan",
  water: "Pengukuran air",
  sampling: "Sampling pertumbuhan",
  mortality: "Mortalitas",
  stocking: "Tebar benih",
  receipt: "Penerimaan pakan",
  harvest: "Hasil panen",
  health: "Pengamatan kesehatan",
  transfer: "Transfer ikan",
  feed_reversal: "Pembalik pakan",
  harvest_plan: "Rencana panen",
  expense: "Biaya operasional",
  shipment: "Pengiriman",
};

export const statusNames: Record<string, string> = {
  active: "Aktif",
  closed: "Selesai",
  posted: "Disahkan",
  draft: "Draf",
  corrected: "Dikoreksi",
  scheduled: "Terjadwal",
  working: "Dikerjakan",
  awaiting_verification: "Menunggu verifikasi",
  done: "Selesai",
  cancelled: "Dibatalkan",
  submitted: "Diajukan",
  approved: "Disetujui",
  rejected: "Ditolak",
  confirmed: "Dikonfirmasi",
  shipped: "Dikirim",
  created: "Menunggu gateway",
  received: "Diterima, belum terverifikasi",
  verified: "Terverifikasi",
  expired_unverified: "Kedaluwarsa, hasil belum diketahui",
  unknown: "Belum diketahui",
  on: "Menyala",
  off: "Mati",
  planned: "Rencana",
  Online: "Online",
  Offline: "Mandiri",
  "Data demo / pilot": "Data demo / pilot",
  Stabil: "Stabil",
  "Perlu cek": "Perlu cek",
  "Belum dinilai": "Belum dinilai",
  "Data terlambat": "Data terlambat",
  "Perlu verifikasi": "Perlu verifikasi",
  Persiapan: "Persiapan",
  high: "Tinggi",
  critical: "Kritis",
  normal: "Normal",
};

export const fmt = (n: unknown, d = 1) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("id-ID", { maximumFractionDigits: d });

export const rupiah = (n: unknown) => "Rp" + fmt(n, 0);

export const dateFmt = (s: string) =>
  s
    ? new Date(s).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Belum tersedia";

export function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}
