import { z } from 'zod';

export const UpdateModalDisetorSchema = z.object({
  modalDisetor: z.coerce.number().nullable(),
});

export type UpdateModalDisetorInput = z.infer<typeof UpdateModalDisetorSchema>;
