import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ModalDisetorInfo } from "@siskop/types";
import { apiFetch, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AUDIT_THRESHOLD = 5_000_000;

export function ModalDisetorConfigTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const canEdit = can("config", "update");

  const [value, setValue] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["config", "modal-disetor"],
    queryFn: () => apiFetch<ModalDisetorInfo>("/config/modal-disetor")
  });

  useEffect(() => {
    if (!data) return;
    setValue(data.modalDisetor ?? "");
  }, [data]);

  const numericValue = Number(value) || 0;
  const overThreshold = value !== "" && numericValue >= AUDIT_THRESHOLD;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError("");
    setIsSaving(true);
    try {
      await apiPut("/config/modal-disetor", { modalDisetor: value === "" ? null : numericValue });
      toast({ title: "Modal disetor disimpan" });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSaving(false);
    }
  };

  if (isPending) return <PageLoading />;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Modal Disetor</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {apiError && <FormError error={apiError} />}
          <p className="text-sm text-muted-foreground">
            Nilai modal disetor koperasi — field kepatuhan Permenkop UKM No. 2/2024 Pasal 12. Koperasi dengan modal
            disetor ≥ Rp{AUDIT_THRESHOLD.toLocaleString("id-ID")} wajib diaudit.
          </p>

          <div className="space-y-1.5 max-w-xs">
            <Label>Modal Disetor (Rp)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              disabled={!canEdit}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>

          {overThreshold && (
            <p className="text-sm font-medium text-amber-600">
              Modal disetor telah mencapai ambang batas wajib audit (Rp{AUDIT_THRESHOLD.toLocaleString("id-ID")}).
            </p>
          )}

          {data?.auditThresholdNotifiedAt && (
            <p className="text-xs text-muted-foreground">
              Notifikasi ambang audit terakhir dikirim:{" "}
              {new Date(data.auditThresholdNotifiedAt).toLocaleDateString("id-ID")}
            </p>
          )}

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
