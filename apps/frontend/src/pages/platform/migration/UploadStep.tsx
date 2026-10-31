import { useState } from "react";
import { Download } from "lucide-react";
import type { MigrationPreview } from "@siskop/types";
import { apiDownload, apiUpload, ApiRequestError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/shared/FormError";
import { HelpHint } from "@/components/shared/HelpHint";

type TemplateMode = "sistem" | "laporan";

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

/** Step 1: only the file. The destination koperasi is chosen in the preview step, once the data has been checked. */
export function UploadStep({ onPreview }: { onPreview: (file: File, preview: MigrationPreview) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      onPreview(file, await apiUpload<MigrationPreview>("/platform/migration/preview", form));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Pratinjau gagal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 rounded-lg border bg-card p-5">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold">1. Unduh template yang sesuai</p>
          <HelpHint label="Bantuan: pilih template">
            Pakai template Sistem bila koperasi punya data rinci dari sistem lama. Pakai template Laporan bila hanya ada Neraca dan lampiran RAT.
          </HelpHint>
        </div>
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

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold">2. Unggah file yang sudah diisi admin koperasi</p>
          <HelpHint label="Bantuan: unggah file">Koperasi tujuan dipilih di langkah berikutnya, setelah data diperiksa.</HelpHint>
        </div>
        <Input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <FormError error={error} />
        <Button onClick={() => void submit()} disabled={!file || busy}>
          {busy ? "Memeriksa..." : "Pratinjau"}
        </Button>
      </div>
    </div>
  );
}
