import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModalDisetorInfo, UpdateModalDisetorRequest } from "@siskop/types";
import { apiFetch, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { formatRupiah } from "@/lib/format";
import { FormError } from "@/components/shared/FormError";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const QUERY_KEY = ["config", "modal-disetor"] as const;

export function ModalDisetorConfigTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = can("config", "update");

  const [value, setValue] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<ModalDisetorInfo>("/config/modal-disetor")
  });

  useEffect(() => {
    if (!data) return;
    setValue(data.modalDisetor ?? "");
  }, [data]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError("");
    setIsSaving(true);
    try {
      // Sent as the raw decimal string — money never round-trips through a JS float.
      const body: UpdateModalDisetorRequest = { modalDisetor: value.trim() === "" ? null : value.trim() };
      const saved = await apiPut<ModalDisetorInfo>("/config/modal-disetor", body);
      queryClient.setQueryData(QUERY_KEY, saved);
      toast({ title: "Modal disetor disimpan" });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSaving(false);
    }
  };

  if (isPending) return <PageLoading />;

  const threshold = data ? formatRupiah(data.auditThreshold) : "";

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
            disetor ≥ {threshold} wajib diaudit akuntan publik.
          </p>

          <div className="space-y-1.5 max-w-xs">
            <Label>Modal Disetor (Rp)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              disabled={!canEdit}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>

          {/* Status reflects the saved value, not the unsaved input. */}
          {data?.modalDisetor != null &&
            (data.auditRequired ? (
              <p className="text-sm font-medium text-amber-600">
                Modal disetor telah mencapai ambang batas wajib audit ({threshold}).
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Modal disetor di bawah ambang batas wajib audit ({threshold}).
              </p>
            ))}

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
