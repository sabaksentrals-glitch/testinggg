import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Database, Row, User } from "./types";
import { DEMO_PASSWORD } from "./types";
import {
  Problem,
  auditLog,
  dispatch,
  login as engineLogin,
  report,
  seedDemo,
  snapshot,
} from "./engine";
import { loadFarmState, saveFarmState } from "./api";

type Store = {
  db: Database;
  sessionId: string | null;
  hydrated: boolean;
  dbSource: "neon" | "pglite" | "unknown";
  pondCount: number;
  syncError: string | null;
  setHydrated: (v: boolean) => void;
  pullRemote: () => Promise<void>;
  login: (email: string, password: string) => User;
  logout: () => void;
  user: () => User | null;
  state: () => Row | null;
  mutate: (action: string, payload: Row) => Row;
  financeReport: (from: string, to: string) => Row;
  audit: () => Row[];
  resetDemo: () => void;
};

let saveChain: Promise<void> = Promise.resolve();

function queueSave(db: Database) {
  saveChain = saveChain
    .catch(() => undefined)
    .then(async () => {
      await saveFarmState({ data: { db } });
    });
  return saveChain;
}

export const useBioflog = create<Store>()(
  persist(
    (set, get) => ({
      db: seedDemo(),
      sessionId: null,
      hydrated: false,
      dbSource: "unknown",
      pondCount: 0,
      syncError: null,
      setHydrated: (v) => {
        if (get().hydrated === v) return;
        set({ hydrated: v });
      },
      pullRemote: async () => {
        try {
          const res = await loadFarmState();
          if (res.db) {
            set({
              db: res.db,
              dbSource: res.source,
              pondCount: res.pondCount,
              syncError: null,
              hydrated: true,
            });
            return;
          }
          const seeded = seedDemo();
          set({
            db: seeded,
            dbSource: res.source,
            pondCount: seeded.ponds.length,
            syncError: null,
            hydrated: true,
          });
          if (res.source === "pglite") void queueSave(seeded);
        } catch (err) {
          set({
            dbSource: "unknown",
            syncError: err instanceof Error ? err.message : "Gagal memuat Neon",
            hydrated: true,
          });
        }
      },
      login: (email, password) => {
        const u = engineLogin(get().db, email, password);
        set({ sessionId: u.id });
        return u;
      },
      logout: () => set({ sessionId: null }),
      user: () => {
        const { db, sessionId } = get();
        if (!sessionId) return null;
        return db.users.find((u) => u.id === sessionId && u.active) ?? null;
      },
      state: () => {
        const u = get().user();
        if (!u) return null;
        return snapshot(get().db, u);
      },
      mutate: (action, payload) => {
        const u = get().user();
        if (!u) throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        const db = structuredClone(get().db);
        const actor = db.users.find((x) => x.id === u.id);
        if (!actor) throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        const result = dispatch(db, actor, action, payload);
        set({ db, pondCount: db.ponds.length });
        if (action === "users/password" && actor.id === u.id) set({ sessionId: null });
        void queueSave(db).catch((err) => {
          set({
            syncError: err instanceof Error ? err.message : "Gagal menyimpan ke Neon",
          });
        });
        return result;
      },
      financeReport: (from, to) => {
        const u = get().user();
        if (!u) throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        return report(get().db, u, from, to);
      },
      audit: () => {
        const u = get().user();
        if (!u) throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        return auditLog(get().db, u);
      },
      resetDemo: () => {
        if (get().dbSource === "neon") {
          void get().pullRemote();
          set({ sessionId: null });
          return;
        }
        const db = seedDemo();
        set({ db, sessionId: null, pondCount: db.ponds.length });
        void queueSave(db);
      },
    }),
    {
      name: "bioflog-sabak-v1",
      partialize: (s) => ({ sessionId: s.sessionId }),
      onRehydrateStorage: () => () => {
        void useBioflog.getState().pullRemote();
      },
    },
  ),
);

export { Problem, DEMO_PASSWORD };
