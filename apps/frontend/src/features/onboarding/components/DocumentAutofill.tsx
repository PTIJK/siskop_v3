import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileImage } from "lucide-react";
import { Label } from "@/components/ui/label";
import { readRegistrationFields } from "../document-autofill";

export function DocumentAutofill({ kind, onRead }: {
  kind: Parameters<typeof readRegistrationFields>[0];
  onRead: (fields: ReturnType<typeof readRegistrationFields>) => void;
}) {
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState("");
  const [recognizedText, setRecognizedText] = useState("");
  const current = useRef(0);
  useEffect(() => () => { current.current += 1; }, []);

  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setRecognizedText("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setStatus("Pilih foto JPG, PNG, atau WebP berukuran maksimal 8 MB.");
      return;
    }
    const request = ++current.current;
    setReading(true);
    setStatus("Membaca foto di perangkat Anda…");
    try {
      const { readRegistrationPhoto } = await import("../registration-image-reader");
      const { fields, recognizedText: resultText } = await readRegistrationPhoto(file, kind);
      if (current.current !== request) return;
      setRecognizedText(resultText);
      if (Object.values(fields).some(Boolean)) {
        onRead(fields);
        setStatus(kind === "cooperative"
          ? "Cocokkan nama, alamat, dan nomor badan hukum dengan foto. Perhatikan huruf I dan angka 1."
          : "Pembacaan selesai. Periksa hasil di kolom yang terisi dan lengkapi sisanya.");
      } else setStatus(resultText
        ? "Teks terbaca. Buka hasil pembacaan untuk menyalin data ke kolom yang sesuai."
        : "Teks belum terbaca. Coba foto yang terang, lurus, dan tajam, atau isi data secara manual.");
    } catch {
      if (current.current === request) setStatus("Foto belum dapat dibaca. Anda tetap bisa mengisi kolom secara manual.");
    } finally {
      if (current.current === request) setReading(false);
    }
  }

  return (
    <div className="registration-callout field field-wide">
      <p className="registration-callout-title">{kind === "ktp" ? "Isi dari foto KTP" : "Isi dari foto dokumen badan hukum"} (opsional)</p>
      <input id={`document-${kind}`} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={reading}
        aria-describedby={`document-${kind}-hint`} onChange={(event) => void read(event)} />
      <Label htmlFor={`document-${kind}`} className="registration-upload">
        <FileImage size={16} aria-hidden="true" />
        {reading ? "Membaca foto…" : kind === "ktp" ? "Pilih foto KTP" : "Pilih foto dokumen"}
      </Label>
      <p id={`document-${kind}-hint`} className="form-note">Foto diproses di perangkat Anda. Data yang terbaca dari foto baru menggantikan isian sebelumnya.</p>
      {kind === "cooperative" ? <p className="form-note">Pilih halaman yang memuat nama koperasi, nomor pengesahan, atau alamat.</p> : null}
      <p className="form-note" role="status">{status}</p>
      {recognizedText ? (
        <details className="form-note">
          <summary className="cursor-pointer font-semibold underline">Lihat teks hasil pembacaan</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{recognizedText}</pre>
        </details>
      ) : null}
    </div>
  );
}
