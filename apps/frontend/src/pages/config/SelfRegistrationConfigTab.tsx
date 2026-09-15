import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SelfRegistrationConfig } from "@siskop/types";
import { apiFetch, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function SelfRegistrationConfigTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const canEdit = can("config", "update");

  const [enabled, setEnabled] = useState(true);
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["config", "self-registration"],
    queryFn: () => apiFetch<SelfRegistrationConfig>("/config/self-registration")
  });

  useEffect(() => {
    if (data) setEnabled(data.selfRegistrationEnabled);
  }, [data]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError("");
    setIsSaving(true);
    try {
      await apiPut("/config/self-registration", { selfRegistrationEnabled: enabled });
      toast({ title: "Pengaturan pendaftaran mandiri disimpan" });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSaving(false);
    }
  }

  if (isPending) return <PageLoading />;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Pendaftaran Mandiri</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {apiError && <FormError error={apiError} />}
          <p className="text-sm text-muted-foreground">
            Saat aktif, calon anggota dapat mengisi data mereka sendiri melalui QR pendaftaran mandiri di halaman
            Anggota. Pendaftaran tetap menunggu persetujuan teller/admin sebelum menjadi anggota resmi.
          </p>

          <div className="flex items-center gap-2">
            <Checkbox
              id="selfRegistrationEnabled"
              checked={enabled}
              disabled={!canEdit}
              onCheckedChange={(checked) => setEnabled(checked === true)}
            />
            <Label htmlFor="selfRegistrationEnabled" className="cursor-pointer font-normal">
              Aktifkan pendaftaran mandiri via QR
            </Label>
          </div>

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
