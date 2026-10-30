import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WhitelabelConfig } from "@siskop/types";
import { apiFetch, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { applyBrandColor, brandCheckMessage, checkBrandColor } from "@/lib/brand";
import { AlertCircle, CheckCircle2 } from "lucide-react";

const DOMAIN_STATUS_LABEL: Record<WhitelabelConfig["domainStatus"], string> = {
  PENDING: "Menunggu verifikasi",
  VERIFIED: "Terverifikasi",
  FAILED: "Verifikasi gagal"
};

export function WhitelabelConfigTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const canEdit = can("config", "update");

  const [customDomain, setCustomDomain] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [hideBranding, setHideBranding] = useState(false);
  const [emailSenderName, setEmailSenderName] = useState("");
  const [emailSenderAddress, setEmailSenderAddress] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["config", "whitelabel"],
    queryFn: () => apiFetch<WhitelabelConfig | null>("/config/whitelabel")
  });

  useEffect(() => {
    if (!data) return;
    setCustomDomain(data.customDomain ?? "");
    setPrimaryColor(data.primaryColor ?? "");
    setHideBranding(data.hideBranding);
    setEmailSenderName(data.emailSenderName ?? "");
    setEmailSenderAddress(data.emailSenderAddress ?? "");
  }, [data]);

  // Brand colour: measured against white text; a failing colour cannot be saved (design.md §2.5).
  const colorCheck = primaryColor.trim() === "" ? null : checkBrandColor(primaryColor);

  useEffect(() => {
    // Live preview while typing; the saved colour comes back via BrandStyle when this tab unmounts.
    if (colorCheck?.ok) applyBrandColor(colorCheck.hex);
    else if (primaryColor.trim() === "") applyBrandColor(null);
  }, [primaryColor]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError("");
    if (colorCheck && !colorCheck.ok) {
      setApiError(brandCheckMessage(colorCheck));
      return;
    }
    setIsSaving(true);
    try {
      await apiPut("/config/whitelabel", {
        customDomain: customDomain || null,
        primaryColor: primaryColor || null,
        hideBranding,
        emailSenderName: emailSenderName || null,
        emailSenderAddress: emailSenderAddress || null
      });
      toast({ title: "Konfigurasi whitelabel disimpan" });
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
        <CardTitle>Whitelabel</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {apiError && <FormError error={apiError} />}
          <p className="text-sm text-muted-foreground">
            Sesuaikan domain kustom dan tampilan platform dengan identitas koperasi Anda. Fitur ini memerlukan paket
            langganan dengan entitlement whitelabel.
          </p>

          <div className="space-y-1.5">
            <Label>Domain Kustom</Label>
            <Input
              placeholder="koperasi-anda.com"
              disabled={!canEdit}
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
            />
            {data?.customDomain && (
              <Badge variant={data.domainStatus === "VERIFIED" ? "ok" : data.domainStatus === "FAILED" ? "bad" : "warn"}>
                {DOMAIN_STATUS_LABEL[data.domainStatus]}
              </Badge>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wl-color">Warna merek</Label>
            <div className="flex items-center gap-2">
              <Input
                id="wl-color"
                type="text"
                placeholder="#1D4ED8"
                disabled={!canEdit}
                value={primaryColor}
                aria-invalid={colorCheck && !colorCheck.ok ? true : undefined}
                aria-describedby="wl-color-msg"
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
              {colorCheck?.ok && (
                <span aria-hidden="true" className="h-[42px] w-[42px] shrink-0 rounded-md border" style={{ backgroundColor: colorCheck.hex }} />
              )}
            </div>
            <p id="wl-color-msg" className={colorCheck && !colorCheck.ok ? "flex items-start gap-1.5 text-[12.5px] font-semibold text-destructive" : "flex items-start gap-1.5 text-[12.5px] text-muted-foreground"}>
              {colorCheck ? (colorCheck.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />) : null}
              {colorCheck ? brandCheckMessage(colorCheck) : "Satu warna menggantikan warna aksen (tombol aksi, fokus, logo). Warna terlalu terang akan ditolak agar teks tetap terbaca."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="hideBranding"
              checked={hideBranding}
              disabled={!canEdit}
              onCheckedChange={(checked) => setHideBranding(checked === true)}
            />
            <Label htmlFor="hideBranding" className="cursor-pointer font-normal">
              Sembunyikan branding "SISKOP" dari tampilan koperasi
            </Label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nama Pengirim Email</Label>
              <Input
                placeholder="Koperasi Anda"
                disabled={!canEdit}
                value={emailSenderName}
                onChange={(e) => setEmailSenderName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Alamat Email Pengirim</Label>
              <Input
                type="email"
                placeholder="noreply@koperasi-anda.com"
                disabled={!canEdit}
                value={emailSenderAddress}
                onChange={(e) => setEmailSenderAddress(e.target.value)}
              />
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end pt-2">
              <Button type="submit" loading={isSaving}>
                {isSaving ? "Menyimpan…" : "Simpan"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
