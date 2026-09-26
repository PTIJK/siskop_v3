import { z } from "zod";

export const listAuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  actorUserId: z.string().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export type ListAuditLogQueryInput = z.infer<typeof listAuditLogQuerySchema>;
