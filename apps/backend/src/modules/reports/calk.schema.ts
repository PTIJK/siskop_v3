import { z } from 'zod';
import { CalkSection } from '@prisma/client';

export const UpsertCalkNarrativeSchema = z.object({
  section: z.nativeEnum(CalkSection),
  content: z.string().max(20000),
});

export type UpsertCalkNarrativeInput = z.infer<typeof UpsertCalkNarrativeSchema>;
