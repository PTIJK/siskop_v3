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
import { RupiahInput } from "@/components/ui/rupiah-input";
import { Label } from "@/components/ui/label";

const QUERY_KEY = ["config", "modal-disetor"] as const;

export function ModalDisetorConfigTab({ onSetupSaved }: { onSetupSaved?: () => Promise<void> }) {
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
      const body: UpdateModalDisetorRequest = { modalDisetor: value === "" ? null : value.replace(/\.$/, "") };
      const saved = await apiPut<ModalDisetorInfo>("/config/modal-disetor", body);
      queryClient.setQueryData(QUERY_KEY, saved);
      toast({ title: "Modal disetor disimpan" });
      if (onSetupSaved) await onSetupSaved();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSaving(false);
    }
  };

  if (isPending) return <PageLoading />;

  const threshold = data ? formatRupiah(data.auditThreshold) : "";

  return (
    <Card data-setup-target={onSetupSaved ? "form" : undefined} tabIndex={onSetupSaved ? -1 : undefined} className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Modal Disetor</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {apiError && <FormError error={apiError} />}
          <p className="text-sm text-muted-foreground">
            Masukkan total modal yang sudah disetor sesuai catatan koperasi.
          </p>

          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="modal-disetor-value">Modal disetor (Rp)</Label>
            <RupiahInput
              id="modal-disetor-value"
              required={Boolean(onSetupSaved)}
              maxIntegerDigits={13}
              placeholder="0"
              className={onSetupSaved ? "border-primary" : undefined}
              disabled={!canEdit}
              value={value}
              onValueChange={setValue}
            />
          </div>

          {/* Status reflects the saved value, not the unsaved input. */}
          {data?.modalDisetor != null &&
            (data.auditRequired ? (
              <p className="text-sm font-medium text-warning">
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
