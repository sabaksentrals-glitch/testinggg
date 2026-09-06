import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Row, Role } from "./types";
import { getFarmStatus, loginFarm, mutateFarm, resumeFarm } from "./api";

export class Problem extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type ClientUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  block: string;
  active: number;
  finance: number;
  device_control: number;
  version: number;
};

type DbSource = "neon" | "pglite" | "unknown";

type Store = {
  sessionToken: string | null;
  userData: ClientUser | null;
  view: Row | null;
  hydrated: boolean;
  dbSource: DbSource;
  pondCount: number;
  syncError: string | null;
  requiresPasswordChange: boolean;
  setHydrated: (v: boolean) => void;
  pullRemote: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  user: () => ClientUser | null;
  state: () => Row | null;
  mutate: (action: string, payload: Row) => Promise<Row>;
  financeReport: (from: string, to: string) => Row;
  audit: () => Row[];
  resetDemo: () => void;
};

type SessionResponse = {
  source: "neon" | "pglite";
  pondCount: number;
  updatedAt: string;
  sessionToken: string;
  requiresPasswordChange: boolean;
  user?: Row;
  view: Row | null;
};

let pullPromise: Promise<void> | null = null;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function asClientUser(value: unknown): ClientUser | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  if (!row.id || !row.email || !row.role) return null;
  return row as ClientUser;
}

function applySession(
  set: (partial: Partial<Store>) => void,
  response: SessionResponse,
) {
  const user = asClientUser(response.user ?? response.view?.user);
  set({
    sessionToken: response.sessionToken,
    userData: user,
    view: response.view,
    dbSource: response.source,
    pondCount: response.pondCount,
    syncError: response.requiresPasswordChange
      ? "Password awal masih merupakan password demo publik. Ganti password sebelum membuka data farm."
      : null,
    requiresPasswordChange: response.requiresPasswordChange,
    hydrated: true,
  });
}

function farmLocalDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

function buildFinanceReport(view: Row, from: string, to: string): Row {
  const finance = view.__finance as Row | undefined;
  if (!finance) {
    throw new Problem("FINANCE_FORBIDDEN", "Anda tidak memiliki izin keuangan.", 403);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Problem("RANGE", "Periode laporan tidak valid.");
  }
  const timeZone = String(finance.timezone || view.farm?.timezone || "Asia/Jakarta");
  const included = (iso: string) => {
    const day = farmLocalDate(iso, timeZone);
    return from <= day && day <= to;
  };
  const payments = Array.isArray(finance.payments) ? finance.payments : [];
  const invoices = (Array.isArray(finance.invoices) ? finance.invoices : []).map((invoice: Row) => {
    const paid = payments
      .filter((payment: Row) => payment.invoice_id === invoice.id)
      .reduce((sum: number, payment: Row) => sum + Number(payment.amount || 0), 0);
    return { ...invoice, paid, balance: Number(invoice.amount || 0) - paid };
  });
  const costs = Array.isArray(finance.costs) ? finance.costs : [];
  const orders = Array.isArray(finance.orders) ? finance.orders : [];
  const periods = Array.isArray(finance.periods) ? finance.periods : [];
  const periodInvoices = invoices.filter((invoice: Row) => included(invoice.occurred_at));
  const periodCosts = costs.filter((cost: Row) => included(cost.occurred_at));
  const periodPayments = payments.filter((payment: Row) => included(payment.occurred_at));
  const revenue = periodInvoices.reduce(
    (sum: number, invoice: Row) => sum + Number(invoice.amount || 0),
    0,
  );
  const cost = periodCosts.reduce(
    (sum: number, row: Row) => sum + Number(row.amount || 0),
    0,
  );
  return {
    from,
    to,
    timezone: timeZone,
    as_of: new Date().toISOString(),
    basis:
      "Invoice sah dan biaya konsumsi/operasi; kas masuk ditampilkan terpisah. Piutang adalah saldo saat ini. Data berasal dari state Neon yang telah diotorisasi server.",
    method_version: "BFG-OP-1",
    revenue,
    cost,
    difference: revenue - cost,
    cash_received: periodPayments.reduce(
      (sum: number, payment: Row) => sum + Number(payment.amount || 0),
      0,
    ),
    receivables_current: invoices.reduce(
      (sum: number, invoice: Row) => sum + Number(invoice.balance || 0),
      0,
    ),
    invoices,
    period_invoices: periodInvoices,
    payments: periodPayments,
    costs: periodCosts,
    orders,
    periods,
  };
}

export const useBioflog = create<Store>()(
  persist(
    (set, get) => ({
      sessionToken: null,
      userData: null,
      view: null,
      hydrated: false,
      dbSource: "unknown",
      pondCount: 0,
      syncError: null,
      requiresPasswordChange: false,
      setHydrated: (v) => {
        if (get().hydrated === v) return;
        set({ hydrated: v });
      },
      pullRemote: async () => {
        if (pullPromise) return pullPromise;
        pullPromise = (async () => {
          try {
            const token = get().sessionToken;
            if (token) {
              try {
                const response = (await resumeFarm({
                  data: { sessionToken: token },
                })) as SessionResponse;
                applySession(set, response);
                return;
              } catch (error) {
                set({
                  sessionToken: null,
                  userData: null,
                  view: null,
                  requiresPasswordChange: false,
                  syncError: errorMessage(error, "Sesi berakhir. Masuk kembali."),
                });
              }
            }

            const status = await getFarmStatus();
            set({
              dbSource: status.source,
              pondCount: status.pondCount,
              hydrated: true,
              syncError: status.available ? null : status.message || "State Neon tidak tersedia.",
            });
          } catch (error) {
            set({
              dbSource: "unknown",
              hydrated: true,
              syncError: errorMessage(error, "Gagal menyambungkan database."),
            });
          }
        })().finally(() => {
          pullPromise = null;
        });
        return pullPromise;
      },
      login: async (email, password) => {
        set({ syncError: null });
        const response = (await loginFarm({ data: { email, password } })) as SessionResponse;
        applySession(set, response);
      },
      logout: () =>
        set({
          sessionToken: null,
          userData: null,
          view: null,
          requiresPasswordChange: false,
          syncError: null,
        }),
      user: () => get().userData,
      state: () => get().view,
      mutate: async (action, payload) => {
        const token = get().sessionToken;
        if (!token) {
          throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        }
        try {
          const response = (await mutateFarm({
            data: { sessionToken: token, action, payload },
          })) as SessionResponse & { result: Row };
          const nextUser = asClientUser(response.view?.user) ?? get().userData;
          set({
            sessionToken: response.sessionToken,
            userData: nextUser,
            view: response.view,
            dbSource: response.source,
            pondCount: response.pondCount,
            requiresPasswordChange: response.requiresPasswordChange,
            syncError: response.requiresPasswordChange
              ? "Password awal wajib diganti sebelum membuka data farm."
              : null,
          });
          if (action === "users/password") {
            set({
              sessionToken: null,
              userData: null,
              view: null,
              requiresPasswordChange: false,
              syncError: "Password berhasil diganti. Silakan masuk kembali.",
            });
          }
          return response.result;
        } catch (error) {
          const message = errorMessage(error, "Gagal menyimpan ke server.");
          set({ syncError: message });
          throw error;
        }
      },
      financeReport: (from, to) => {
        const view = get().view;
        if (!view) throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        return buildFinanceReport(view, from, to);
      },
      audit: () => {
        const view = get().view;
        if (!view) throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        return Array.isArray(view.__audit) ? view.__audit : [];
      },
      resetDemo: () => {
        void get().pullRemote();
      },
    }),
    {
      name: "bioflog-sabak-v2",
      partialize: (s) => ({ sessionToken: s.sessionToken }),
      onRehydrateStorage: () => () => {
        void useBioflog.getState().pullRemote();
      },
    },
  ),
);
