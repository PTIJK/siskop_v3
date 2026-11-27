import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { CooperativeRegistryMatch } from "@siskop/types";
import { onboardingApi } from "../api";
import { FileImage, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { readRegistrationFields } from "../document-autofill";
import type { RegistrationPhotoProgress } from "../registration-image-reader";

type DocumentProgress = RegistrationPhotoProgress | { stage: "registry"; percent?: undefined };

const stageLabels: Record<DocumentProgress["stage"], string> = {
  preparing: "Menyiapkan pembaca foto…",
  reading: "Membaca teks pada foto…",
  checking_table: "Memeriksa data pada sertifikat…",
  retrying: "Memeriksa ulang teks yang belum terbaca…",
  extracting: "Mencocokkan teks dengan kolom pendaftaran…",
  registry: "Mencari NIK di ODS Koperasi…"
};

export function DocumentAutofill({ kind, onRead }: {
  kind: Parameters<typeof readRegistrationFields>[0];
  onRead: (fields: ReturnType<typeof readRegistrationFields>, match?: CooperativeRegistryMatch) => void;
}) {
  const [progress, setProgress] = useState<DocumentProgress | null>(null);
  const [status, setStatus] = useState("");
  const current = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => current.current?.abort(), []);

  function cancel() {
    current.current?.abort();
    current.current = null;
    setProgress(null);
    setStatus("Pembacaan dibatalkan. Anda dapat mengisi data secara manual.");
  }

  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setStatus("Pilih foto JPG, PNG, atau WebP berukuran maksimal 8 MB.");
      return;
    }
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setProgress({ stage: "preparing" });
    setStatus("");
    try {
      const { readRegistrationPhoto } = await import("../registration-image-reader");
      const fields = await readRegistrationPhoto(file, kind, {
        signal: controller.signal,
        onProgress: (update) => { if (current.current === controller) setProgress(update); }
      });
      if (controller.signal.aborted || current.current !== controller) return;
      if (Object.values(fields).some(Boolean)) {
        let match: CooperativeRegistryMatch | undefined;
        let message = "Pembacaan selesai. Periksa hasil di kolom yang terisi dan lengkapi sisanya.";
        if (kind === "cooperative") {
          message = "NIK belum terbaca. Periksa isian dari foto atau lanjutkan secara manual.";
          if (fields.cooperativeNik) {
            setProgress({ stage: "registry" });
            try {
              const result = await onboardingApi<{ match: CooperativeRegistryMatch | null }>(
                "/cooperative-registry", { nik: fields.cooperativeNik }, controller.signal
              );
              match = result.match ?? undefined;
              message = match
                ? "Nama dan nomor badan hukum diisi dari ODS. Periksa alamat dari foto."
                : "Data koperasi belum ditemukan di ODS. Anda bisa melanjutkan dengan data dari foto.";
            } catch {
              message = "ODS Koperasi belum dapat dihubungi. Anda bisa melanjutkan dengan data dari foto.";
            }
          }
        }
        if (controller.signal.aborted || current.current !== controller) return;
        onRead(fields, match);
        setStatus(message);
      } else setStatus("Data belum ditemukan. Coba foto yang lebih jelas atau isi secara manual.");
    } catch {
      if (!controller.signal.aborted && current.current === controller) setStatus("Foto belum dapat dibaca. Anda tetap bisa mengisi kolom secara manual.");
    } finally {
      if (current.current === controller) {
        current.current = null;
        setProgress(null);
      }
    }
  }

  return (
    <div className="registration-callout field field-wide">
      <p className="registration-callout-title">{kind === "ktp" ? "Isi dari foto KTP" : "Isi dari foto dokumen badan hukum"} (opsional)</p>
      <input ref={input} id={`document-${kind}`} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void read(event)} />
      <Button ref={trigger} type="button" variant="outline" className="self-start min-h-11"
        disabled={Boolean(progress)} onClick={() => input.current?.click()}>
        <FileImage size={16} aria-hidden="true" />
        {kind === "ktp" ? "Pilih foto KTP" : "Pilih foto dokumen"}
      </Button>
      <Dialog open={Boolean(progress)} onOpenChange={(open) => { if (!open && progress) cancel(); }}>
        <DialogContent className="text-foreground" onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
          <DialogHeader className="pr-6">
            <DialogTitle>{kind === "ktp" ? "Membaca foto KTP" : "Membaca dokumen koperasi"}</DialogTitle>
            <DialogDescription>
              {kind === "cooperative" ? "Foto dibaca di perangkat Anda. NIK koperasi dicari di ODS." : "Foto diproses di perangkat Anda."}
            </DialogDescription>
          </DialogHeader>
          {progress && <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {progress.percent === undefined && <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />}
              <p role="status" className="flex-1">{stageLabels[progress.stage]}</p>
              {progress.percent !== undefined && <span className="tabular-nums text-muted-foreground" aria-hidden="true">{progress.percent}%</span>}
            </div>
            {progress.percent !== undefined && <Progress className="h-2" value={progress.percent} aria-label={stageLabels[progress.stage]} />}
          </div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancel}>Isi manual</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {kind === "cooperative" ? <p className="form-note">Gunakan foto sertifikat yang menampilkan NIK koperasi.</p> : null}
      <p className="form-note" role="status">{status}</p>
    </div>
  );
}
