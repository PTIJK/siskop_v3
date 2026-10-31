import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import type { MigrationPreview, PlatformTenantSummary } from "@siskop/types";
import { apiDownload, apiFetch, apiUpload, ApiRequestError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/shared/FormError";
import { TenantPicker } from "./TenantPicker";

type TemplateMode = "sistem" | "laporan";
type Destination = "baru" | "ada";

async function downloadTemplate(mode: TemplateMode) {
  const blob = await apiDownload(`/platform/migration/templates/${mode}`);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `SISKOP-Template-Migrasi-${mode === "sistem" ? "Sistem" : "Laporan"}.xlsx`
  });
  a.click();
  URL.revokeObjectURL(url);
}

export function UploadStep({ onPreview }: { onPreview: (file: File, preview: MigrationPreview) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [destination, setDestination] = useState<Destination>("baru");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Same query key as the Koperasi page, so the list is shared and cached.
  const tenants = useQuery({
    queryKey: ["platform", "tenants"],
    queryFn: () => apiFetch<PlatformTenantSummary[]>("/platform/tenants"),
    enabled: destination === "ada"
  });

  async function download(mode: TemplateMode) {
    setError("");
    try {
      await downloadTemplate(mode);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Template gagal diunduh");
    }
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (destination === "ada" && tenantId) form.append("tenantId", tenantId);
      onPreview(file, await apiUpload<MigrationPreview>("/platform/migration/preview", form));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Pratinjau gagal");
    } finally {
      setBusy(false);
    }
  }

  const ready = !!file && (destination === "baru" || !!tenantId);

  return (
    <div className="space-y-6 rounded-lg border bg-card p-5">
      <div className="space-y-2">
        <p className="text-sm font-semibold">1. Unduh template yang sesuai</p>
        <p className="text-sm text-muted-foreground">
          Pakai template Sistem bila koperasi punya data rinci dari sistem lama. Pakai template Laporan bila hanya ada Neraca dan lampiran RAT.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void download("sistem")}>
            <Download className="mr-2 h-4 w-4" />
            Template Sistem
          </Button>
          <Button variant="outline" onClick={() => void download("laporan")}>
            <Download className="mr-2 h-4 w-4" />
            Template Laporan
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold">2. Pilih koperasi tujuan</p>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="destination" className="mt-1" checked={destination === "baru"} onChange={() => setDestination("baru")} />
            <span>
              <span className="font-medium">Koperasi baru</span>
              <span className="block text-muted-foreground">Dibuat dari sheet 1_Koperasi, termasuk akun admin pertamanya.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="destination" className="mt-1" checked={destination === "ada"} onChange={() => setDestination("ada")} />
            <span>
              <span className="font-medium">Koperasi yang sudah terdaftar</span>
              <span className="block text-muted-foreground">
                Data dimuat ke koperasi yang masih kosong (belum ada anggota, simpanan, pinjaman, atau jurnal). Subdomain di file harus sama.
              </span>
            </span>
          </label>
        </div>
        {destination === "ada" && (
          <div className="space-y-1.5 pl-6">
            <Label htmlFor="tenantPicker">Cari koperasi</Label>
            <TenantPicker
              inputId="tenantPicker"
              tenants={tenants.data?.map((t) => ({ id: t.id, name: t.name, slug: t.slug, registrationNo: t.registrationNo, isActive: t.isActive }))}
              selectedId={tenantId}
              onSelect={(t) => setTenantId(t.id)}
              onClear={() => setTenantId(null)}
              loading={tenants.isPending}
              error={tenants.isError ? "Daftar koperasi gagal dimuat" : undefined}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">3. Unggah file yang sudah diisi admin koperasi</p>
        <Input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <FormError error={error} />
        <Button onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? "Memeriksa..." : "Pratinjau"}
        </Button>
      </div>
    </div>
  );
}
