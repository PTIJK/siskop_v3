import { useState } from "react";
import { Navigate } from "react-router-dom";
import type { MigrationPreview, MigrationResult } from "@siskop/types";
import { useAuth } from "@/stores/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Stepper } from "@/components/shared/Stepper";
import { UploadStep } from "./migration/UploadStep";
import { PreviewStep } from "./migration/PreviewStep";
import { ResultStep } from "./migration/ResultStep";

const STEPS = ["Unggah", "Pratinjau", "Eksekusi", "Selesai"] as const;

export function PlatformMigrationPage() {
  const role = useAuth((s) => s.user?.role);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);

  if (role !== "super_admin") return <Navigate to="/dashboard" replace />;

  const step = result ? 3 : preview ? 1 : 0;
  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Migrasi Koperasi" description="Pindahkan data koperasi dari template standar. Pratinjau tidak menyimpan apa pun." />
      <Stepper steps={STEPS} current={step} />
      {!preview && !result && (
        <UploadStep
          onPreview={(f, p) => {
            setFile(f);
            setPreview(p);
          }}
        />
      )}
      {preview && file && !result && <PreviewStep file={file} preview={preview} onBack={reset} onDone={setResult} />}
      {result && <ResultStep result={result} onAnother={reset} />}
    </div>
  );
}
