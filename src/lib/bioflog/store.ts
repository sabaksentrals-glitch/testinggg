import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Database, Row, User } from "./types";
import { DEMO_PASSWORD } from "./types";
import {
  Problem,
  auditLog,
  emptyDb,
  dispatch,
  login as engineLogin,
  report,
  seedDemo,
  snapshot,
} from "./engine";
import { loadFarmState, saveFarmState } from "./api";
import {
  STATE_UNAVAILABLE_MESSAGE,
  decideLoadMode,
  decideLoadModeOnError,
  mayMutate,
  mayPersist,
  maySeedDemo,
  type LoadMode,
} from "./load-policy";

type Store = {
  db: Database;
  sessionId: string | null;
  hydrated: boolean;
  dbSource: "neon" | "pglite" | "unknown";
  pondCount: number;
  syncError: string | null;
  /** What the client may do with the loaded state — see `load-policy.ts`. */
  loadMode: LoadMode;
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

/**
 * Persist, but only when the current mode allows it. The `mode` gate is the
 * last line of defence against writing demo state onto a production database
 * whose real state failed to load.
 */
function queueSave(db: Database, mode: LoadMode) {
  if (!mayPersist(mode)) return Promise.resolve();
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
      loadMode: "demo",
      setHydrated: (v) => {
        if (get().hydrated === v) return;
        set({ hydrated: v });
      },
      pullRemote: async () => {
        try {
          const res = await loadFarmState();
          const mode = decideLoadMode({ source: res.source, hasDb: Boolean(res.db) });
          if (res.db) {
            set({
              db: res.db,
              dbSource: res.source,
              pondCount: res.pondCount,
              syncError: null,
              loadMode: mode,
              hydrated: true,
            });
            return;
          }
          // A production backend that could not produce its state stays
          // read-only: no demo seed, nothing written back. Seeding here is what
          // used to let demo data become the production ledger on first edit.
          if (!maySeedDemo(mode)) {
            // Show an empty ledger, never the demo seed: demo rows on screen
            // here would read as real production data.
            set({
              db: emptyDb(),
              sessionId: null,
              dbSource: res.source,
              pondCount: 0,
              syncError: STATE_UNAVAILABLE_MESSAGE,
              loadMode: mode,
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
            loadMode: mode,
            hydrated: true,
          });
          void queueSave(seeded, mode);
        } catch (err) {
          set({
            dbSource: "unknown",
            syncError: err instanceof Error ? err.message : "Gagal memuat Neon",
            loadMode: decideLoadModeOnError(),
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
        // Blocked before dispatch, not merely before save: an unavailable
        // production state must not be edited even in memory, or the UI would
        // show changes it can never persist.
        if (!mayMutate(get().loadMode)) {
          throw new Problem("STATE_UNAVAILABLE", STATE_UNAVAILABLE_MESSAGE, 503);
        }
        const u = get().user();
        if (!u) throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        const db = structuredClone(get().db);
        const actor = db.users.find((x) => x.id === u.id);
        if (!actor) throw new Problem("UNAUTHENTICATED", "Sesi berakhir. Masuk kembali.", 401);
        const result = dispatch(db, actor, action, payload);
        set({ db, pondCount: db.ponds.length });
        if (action === "users/password" && actor.id === u.id) set({ sessionId: null });
        void queueSave(db, get().loadMode).catch((err) => {
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
        const mode = get().loadMode;
        // On Neon this is "reload from Neon", never "overwrite with demo".
        if (get().dbSource === "neon" || !maySeedDemo(mode)) {
          void get().pullRemote();
          set({ sessionId: null });
          return;
        }
        const db = seedDemo();
        set({ db, sessionId: null, pondCount: db.ponds.length });
        void queueSave(db, mode);
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
