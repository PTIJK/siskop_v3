import { z } from "zod";

export const createSaleSchema = z.object({
  unitId: z.string().cuid("Unit ID tidak valid"),
  items: z
    .array(
      z.object({
        productId: z.string().cuid("Product ID tidak valid"),
        quantity: z.coerce.number().int().positive("Jumlah harus lebih dari 0")
      })
    )
    .min(1, "Minimal satu item diperlukan"),
  paymentMethod: z.enum(["CASH", "TRANSFER", "MEMBER_CREDIT"], {
    errorMap: () => ({ message: "Metode pembayaran harus CASH, TRANSFER, atau MEMBER_CREDIT" })
  }),
  memberId: z.string().cuid("Member ID tidak valid").optional()
});

export const listSalesQuerySchema = z.object({
  unitId: z.string().cuid("Unit ID tidak valid")
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQueryInput = z.infer<typeof listSalesQuerySchema>;
