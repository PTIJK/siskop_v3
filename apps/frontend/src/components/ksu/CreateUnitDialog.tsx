import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CooperativeType } from "@siskop/types";
import { apiPost, ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Deliberately a small dedicated create-only form rather than reusing
// UnitsTab's dialog: that one is a private inline component (create + edit,
// toggle-active) not exported for reuse, and UnitsTab is out of scope to
// modify for this task. Same `POST /config/units` endpoint, same
// react-hook-form + zod pattern, same CooperativeType options.
const UNIT_TYPES = ["KSP", "KONSUMEN", "PRODUSEN", "JASA", "PEMASARAN"] as const satisfies readonly CooperativeType[];

const UNIT_TYPE_OPTION_LABEL: Record<CooperativeType, string> = {
  KSP: "KSP — Simpan Pinjam",
  KONSUMEN: "Konsumen — Toko",
  PRODUSEN: "Produsen",
  JASA: "Jasa",
  PEMASARAN: "Pemasaran"
};

const schema = z.object({
  type: z.enum(UNIT_TYPES),
  name: z.string().min(1, "Nama unit wajib diisi")
});
type FormValues = z.infer<typeof schema>;

export function CreateUnitDialog({
  open,
  onOpenChange,
  defaultType = "KSP"
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: CooperativeType;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors }
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { type: defaultType, name: "" } });
  const values = watch();

  const mutation = useMutation({
    mutationFn: (input: FormValues) => apiPost("/config/units", input),
    onSuccess: () => {
      toast({ title: "Unit koperasi ditambahkan" });
      void qc.invalidateQueries({ queryKey: ["config", "units"] });
      reset({ type: defaultType, name: "" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Gagal menambah unit",
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
        if (!next) reset({ type: "KSP", name: "" });
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Unit Usaha</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {mutation.isError && (
            <FormError error={mutation.error instanceof ApiRequestError ? mutation.error.message : "Terjadi kesalahan"} />
          )}

          <div className="space-y-1.5">
            <Label>Nama Unit *</Label>
            <Input placeholder="Simpan Pinjam" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Jenis *</Label>
            <Select value={values.type} onValueChange={(v: FormValues["type"]) => setValue("type", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {UNIT_TYPE_OPTION_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
