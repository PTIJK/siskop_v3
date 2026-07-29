import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ShuDistributionConfig } from "@siskop/types";
import { apiFetch, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FIELDS = [
  { key: "jasaSimpananPercent", label: "Jasa Simpanan (%)" },
  { key: "jasaPinjamanPercent", label: "Jasa Pinjaman (%)" },
  { key: "cadanganPercent", label: "Cadangan (%)" },
  { key: "lainnyaPercent", label: "Lainnya (%)" }
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function ShuConfigTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const canEdit = can("accounting", "update");
  const [values, setValues] = useState<Record<FieldKey, string>>({
    jasaSimpananPercent: "25",
    jasaPinjamanPercent: "25",
    cadanganPercent: "40",
    lainnyaPercent: "10"
  });
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ["config", "shu-distribution"],
    queryFn: () => apiFetch<ShuDistributionConfig | null>("/config/shu-distribution"),
    retry: (failureCount, err) => err instanceof ApiRequestError && err.code === "FEATURE_NOT_ENTITLED" ? false : failureCount < 3
  });

  useEffect(() => {
    if (!data) return;
    setValues({
      jasaSimpananPercent: data.jasaSimpananPercent,
      jasaPinjamanPercent: data.jasaPinjamanPercent,
      cadanganPercent: data.cadanganPercent,
      lainnyaPercent: data.lainnyaPercent
    });
  }, [data]);

  const total = FIELDS.reduce((sum, f) => sum + (Number(values[f.key]) || 0), 0);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError("");
    setIsSaving(true);
    try {
      await apiPut("/config/shu-distribution", {
        jasaSimpananPercent: Number(values.jasaSimpananPercent),
        jasaPinjamanPercent: Number(values.jasaPinjamanPercent),
        cadanganPercent: Number(values.cadanganPercent),
        lainnyaPercent: Number(values.lainnyaPercent)
      });
      toast({ title: "Konfigurasi SHU disimpan" });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSaving(false);
    }
  };

  if (isPending) return <PageLoading />;

  if (error instanceof ApiRequestError && error.code === "FEATURE_NOT_ENTITLED") {
    return <EntitlementNotice message={error.message} />;
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Alokasi Pembagian SHU</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {apiError && <FormError error={apiError} />}
          <p className="text-sm text-muted-foreground">
            Persentase pembagian Sisa Hasil Usaha (SHU) per periode, dipakai oleh Laporan Regulasi &gt; Pembagian SHU. Total
            keempat pos harus 100%.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  disabled={!canEdit}
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <p className={`text-sm font-medium ${Math.abs(total - 100) < 0.01 ? "text-green-700" : "text-destructive"}`}>
            Total: {total}%
          </p>

          {canEdit && (
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
