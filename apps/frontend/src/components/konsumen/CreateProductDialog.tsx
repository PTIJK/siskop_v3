import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createProduct } from "@/api/konsumen";
import { ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Create-only form, same react-hook-form + zod + useMutation pattern as
// components/ksu/CreateUnitDialog.tsx. sellPrice/costPrice are Decimal on
// the wire (string) but z.coerce.number() on a plain <Input type="number">
// matches CreateProductRequest's `string | number` field type and
// product.schema.ts's own z.coerce.number() server-side validation.
const schema = z.object({
  sku: z.string().min(1, "SKU wajib diisi"),
  name: z.string().min(1, "Nama produk wajib diisi"),
  category: z.string().optional(),
  uom: z.string().optional(),
  sellPrice: z.coerce.number().nonnegative("Harga jual tidak boleh negatif"),
  costPrice: z.coerce.number().nonnegative("Harga beli tidak boleh negatif")
});
type FormValues = z.infer<typeof schema>;

const DEFAULT_VALUES: FormValues = { sku: "", name: "", category: "", uom: "", sellPrice: 0, costPrice: 0 };

export function CreateProductDialog({
  unitId,
  open,
  onOpenChange
}: {
  unitId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULT_VALUES });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      createProduct(unitId, {
        sku: values.sku,
        name: values.name,
        category: values.category ? values.category : undefined,
        uom: values.uom ? values.uom : undefined,
        sellPrice: values.sellPrice,
        costPrice: values.costPrice
      }),
    onSuccess: () => {
      toast({ title: "Produk ditambahkan" });
      void qc.invalidateQueries({ queryKey: ["konsumen", "products", unitId] });
      reset(DEFAULT_VALUES);
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Gagal menambah produk",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  });

  const onSubmit = (values: FormValues) => mutation.mutate(values);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset(DEFAULT_VALUES);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Produk</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {mutation.isError && (
            <FormError error={mutation.error instanceof ApiRequestError ? mutation.error.message : "Terjadi kesalahan"} />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>SKU *</Label>
              <Input placeholder="BRG-001" {...register("sku")} />
              {errors.sku && <p className="text-xs text-destructive">{errors.sku.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Satuan</Label>
              <Input placeholder="pcs" {...register("uom")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Nama Produk *</Label>
            <Input placeholder="Beras 5kg" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Kategori</Label>
            <Input placeholder="Sembako" {...register("category")} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Harga Beli *</Label>
              <Input type="number" min="0" step="1" {...register("costPrice")} />
              {errors.costPrice && <p className="text-xs text-destructive">{errors.costPrice.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Harga Jual *</Label>
              <Input type="number" min="0" step="1" {...register("sellPrice")} />
              {errors.sellPrice && <p className="text-xs text-destructive">{errors.sellPrice.message}</p>}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
