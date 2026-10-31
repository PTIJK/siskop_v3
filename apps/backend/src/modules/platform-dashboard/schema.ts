import { z } from "zod";
import { DASHBOARD_RANGES } from "@siskop/types";

export const dashboardQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES).default("30d")
});
