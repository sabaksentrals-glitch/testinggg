import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Database } from "./types";

export const loadFarmState = createServerFn({ method: "GET" }).handler(async () => {
  const { loadFarmStateFromDb } = await import("./persist.server");
  return loadFarmStateFromDb();
});

export const saveFarmState = createServerFn({ method: "POST" })
  .validator(z.object({ db: z.any() }))
  .handler(async ({ data }) => {
    const { saveFarmStateToDb } = await import("./persist.server");
    return saveFarmStateToDb(data.db as Database);
  });
