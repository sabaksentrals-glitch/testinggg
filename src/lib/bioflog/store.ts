import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Row, Role } from "./types";
import { getFarmStatus, loginFarm, mutateFarm, resumeFarm } from "./api";
import { validatePasswordChange } from "./password-policy";

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
  login: (email: string, password: string) => ClientUser | null;
  logout: () => void;
  user: () => ClientUser | null;
  state: () => Row | null;
  mutate: (action: string, payload: Row) => Row;
  /**
   * Forced rotation for a legacy pilot credential. Async on purpose: the caller
   * must be able to await the server's verdict and show the real error, which
   * the fire-and-forget `mutate` shim cannot express.
   */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
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
let loginInFlight = false;
let mutationInFlight = false;

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
      ? "Akun ini masih memakai hash password pilot lama. Rotasi kredensial wajib dilakukan sebelum data farm dapat dibuka."
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
      login: (email, password) => {
        if (loginInFlight) return null;
        loginInFlight = true;
        set({ syncError: null });
        void loginFarm({ data: { email, password } })
          .then((response) => applySession(set, response as SessionResponse))
          .catch((error) => {
            set({
              sessionToken: null,
              userData: null,
              view: null,
              requiresPasswordChange: false,
              hydrated: true,
              syncError: errorMessage(error, "Gagal masuk."),
            });
          })
          .finally(() => {
            loginInFlight = false;
          });
        return null;
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
      mutate: (action, payload) => {
        const token = get().sessionToken;
        if (!token) {
          throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        }
        if (mutationInFlight) {
          throw new Problem("SAVE_BUSY", "Penyimpanan sebelumnya masih berjalan. Tunggu sebentar.", 409);
        }
        mutationInFlight = true;
        // The legacy UI calls mutate synchronously. Enter an explicit loading
        // state immediately so the screen never keeps presenting an optimistic
        // edit as authoritative while the server is still validating it.
        set({ hydrated: false, syncError: null });
        void mutateFarm({ data: { sessionToken: token, action, payload } })
          .then((rawResponse) => {
            const response = rawResponse as SessionResponse & { result: Row };
            const nextUser = asClientUser(response.view?.user) ?? get().userData;
            const provisioningToken = response.result?.provisioning_token;
            if (provisioningToken && typeof window !== "undefined") {
              window.alert(
                "Simpan token perangkat ini sekali. Token tidak akan ditampilkan lagi:\n\n" +
                  provisioningToken,
              );
            }
            if (action === "users/password") {
              set({
                sessionToken: null,
                userData: null,
                view: null,
                dbSource: response.source,
                pondCount: response.pondCount,
                requiresPasswordChange: false,
                hydrated: true,
                syncError: "Password berhasil diganti. Silakan masuk kembali.",
              });
              return;
            }
            set({
              sessionToken: response.sessionToken,
              userData: nextUser,
              view: response.view,
              dbSource: response.source,
              pondCount: response.pondCount,
              requiresPasswordChange: response.requiresPasswordChange,
              hydrated: true,
              syncError: response.requiresPasswordChange
                ? "Rotasi password wajib sebelum melanjutkan."
                : null,
            });
          })
          .catch((error) => {
            // Fail visibly. We deliberately drop the local session instead of
            // leaving the operator on a screen that claimed a rejected write
            // had succeeded.
            set({
              sessionToken: null,
              userData: null,
              view: null,
              requiresPasswordChange: false,
              hydrated: true,
              syncError: errorMessage(
                error,
                "Perubahan ditolak server dan tidak disimpan. Silakan masuk kembali.",
              ),
            });
          })
          .finally(() => {
            mutationInFlight = false;
          });
        return {};
      },
      changePassword: async (currentPassword, newPassword) => {
        const token = get().sessionToken;
        if (!token) {
          throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        }
        const invalid = validatePasswordChange({
          current: currentPassword,
          next: newPassword,
        });
        if (invalid) throw new Problem(invalid.code, invalid.message);
        if (mutationInFlight) {
          throw new Problem("SAVE_BUSY", "Permintaan sebelumnya masih berjalan.", 409);
        }
        mutationInFlight = true;
        set({ syncError: null });
        try {
          await mutateFarm({
            data: {
              sessionToken: token,
              action: "users/password",
              payload: {
                current_password: currentPassword,
                new_password: newPassword,
              },
            },
          });
          // The rotation bumps the user version, so the restricted token is
          // spent. Drop it and make the operator sign in with the new password.
          set({
            sessionToken: null,
            userData: null,
            view: null,
            requiresPasswordChange: false,
            hydrated: true,
            syncError: "Password berhasil diganti. Silakan masuk kembali.",
          });
        } catch (error) {
          // Keep the restricted session on failure — a mistyped current
          // password must not eject the operator back to a login form they
          // cannot get past.
          throw error instanceof Error
            ? error
            : new Problem("PASSWORD_CHANGE", "Gagal mengganti password.");
        } finally {
          mutationInFlight = false;
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
        set({ hydrated: false });
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

// Compatibility export for the old login component. The real pilot no longer
// pre-fills or publishes the historical demo password.
export const DEMO_PASSWORD = "";
