import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getFarmStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { farmStatus } = await import("./secure.server");
  return farmStatus();
});

export const loginFarm = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().email().max(320),
      password: z.string().min(1).max(256),
    }),
  )
  .handler(async ({ data }) => {
    const { loginFarmSession } = await import("./secure.server");
    return loginFarmSession(data.email, data.password);
  });

export const resumeFarm = createServerFn({ method: "POST" })
  .validator(z.object({ sessionToken: z.string().min(20).max(4096) }))
  .handler(async ({ data }) => {
    const { resumeFarmSession } = await import("./secure.server");
    return resumeFarmSession(data.sessionToken);
  });

export const mutateFarm = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionToken: z.string().min(20).max(4096),
      action: z.string().min(1).max(80),
      payload: z.any(),
    }),
  )
  .handler(async ({ data }) => {
    const { mutateFarmSession } = await import("./secure.server");
    return mutateFarmSession(data.sessionToken, data.action, data.payload);
  });
