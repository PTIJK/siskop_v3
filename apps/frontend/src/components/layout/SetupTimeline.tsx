import { useState } from "react";
import type { TenantSetupStep } from "@siskop/types";
import { Check, Lock, ArrowRight, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ModalDisetorConfigTab } from "@/pages/config/ModalDisetorConfigTab";
import { SavingConfigsTab } from "@/pages/config/SavingConfigsTab";
import { LoanConfigsTab } from "@/pages/config/LoanConfigsTab";

interface StepDef {
  key: TenantSetupStep;
  number: number;
  title: string;
  description: string;
  cta: string;
  dialogTitle: string;
  dialogDescription: string;
}

const STEPS: StepDef[] = [
  {
    key: "CAPITAL",
    number: 1,
    title: "Saldo Awal (Modal Disetor)",
    description:
      "Masukkan total modal yang sudah disetor sesuai catatan koperasi agar neraca awal tercatat dengan benar.",
    cta: "Isi Saldo Awal",
    dialogTitle: "Langkah 1: Saldo Awal (Modal Disetor)",
    dialogDescription: "Simpan nominal modal disetor koperasi untuk melanjutkan ke langkah berikutnya."
  },
  {
    key: "SAVINGS",
    number: 2,
    title: "Pengaturan Simpanan",
    description:
      "Tambahkan minimal satu jenis simpanan (Pokok, Wajib, atau Sukarela) beserta imbal hasil tahunannya.",
    cta: "Atur Simpanan",
    dialogTitle: "Langkah 2: Pengaturan Simpanan",
    dialogDescription: "Tambahkan minimal satu jenis simpanan agar koperasi siap menerima setoran anggota."
  },
  {
    key: "LOANS",
    number: 3,
    title: "Pengaturan Pinjaman",
    description:
      "Tambahkan minimal satu produk pinjaman (Konvensional atau Syariah) beserta bunga/margin dan tenor maksimal.",
    cta: "Atur Pinjaman",
    dialogTitle: "Langkah 3: Pengaturan Pinjaman",
    dialogDescription: "Tambahkan minimal satu jenis pinjaman untuk menyelesaikan pengaturan awal."
  }
];

interface SetupTimelineProps {
  setupStep: TenantSetupStep;
  onRefresh: () => Promise<void>;
}

export function SetupTimeline({ setupStep, onRefresh }: SetupTimelineProps) {
  const [openStep, setOpenStep] = useState<TenantSetupStep | null>(null);
  const [savingActionsEl, setSavingActionsEl] = useState<HTMLDivElement | null>(null);

  const currentIdx = Math.max(
    0,
    STEPS.findIndex((s) => s.key === setupStep)
  );
  const progressPct = Math.round((currentIdx / STEPS.length) * 100);
  const activeDialog = openStep ? STEPS.find((s) => s.key === openStep) ?? null : null;

  const handleSaved = async () => {
    await onRefresh();
    setOpenStep(null);
  };

  return (
    <section aria-label="Pengaturan awal koperasi" className="mx-auto max-w-3xl space-y-6">
      {/* Header banner */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0A6CFF] to-[#12B8F5] p-6 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-white/85">
              Pengaturan Awal Koperasi
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Lengkapi 3 langkah untuk memulai
            </h1>
            <p className="max-w-xl text-sm text-white/90">
              Selesaikan pengaturan saldo awal, simpanan, dan pinjaman di bawah ini. Setelah selesai,
              seluruh menu dan dashboard koperasi akan terbuka otomatis.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full bg-white/20 px-3.5 py-1.5 text-sm font-bold backdrop-blur-sm">
            Langkah {currentIdx + 1} dari {STEPS.length}
          </span>
        </div>

        <div className="mt-5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white transition-all duration-300"
              style={{ width: `${Math.max(8, progressPct)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Vertical 1-2-3 timeline */}
      <ol className="space-y-0">
        {STEPS.map((step, idx) => {
          const isDone = idx < currentIdx;
          const isActive = idx === currentIdx;
          const isLocked = idx > currentIdx;
          const isLast = idx === STEPS.length - 1;

          return (
            <li key={step.key} className="relative flex gap-4 pb-5 last:pb-0">
              {/* Left node + connector */}
              <div className="flex flex-col items-center">
                <div
                  aria-hidden="true"
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-base font-extrabold transition-colors",
                    isDone && "border-emerald-600 bg-emerald-600 text-white",
                    isActive && "border-primary bg-primary text-primary-foreground shadow-sm",
                    isLocked && "border-border bg-muted text-muted-foreground"
                  )}
                >
                  {isDone ? (
                    <Check className="h-5 w-5" strokeWidth={2.5} />
                  ) : isLocked ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    step.number
                  )}
                </div>
                {!isLast && (
                  <div
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 w-0.5 flex-1 rounded-full",
                      isDone ? "bg-emerald-500" : "bg-border"
                    )}
                  />
                )}
              </div>

              {/* Right step card */}
              <div
                className={cn(
                  "flex-1 rounded-2xl border p-5 transition-colors",
                  isActive && "border-primary/60 bg-card shadow-sm",
                  isDone && "border-emerald-200 bg-card dark:border-emerald-900/60",
                  isLocked && "border-border bg-muted/40 opacity-75"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-foreground">{step.title}</h2>
                      {isDone && (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300">
                          Selesai
                        </Badge>
                      )}
                      {isActive && <Badge>Sedang dikerjakan</Badge>}
                      {isLocked && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Menunggu langkah {step.number - 1}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>

                  {isActive && (
                    <Button onClick={() => setOpenStep(step.key)} className="shrink-0">
                      {step.cta}
                      <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}

                  {isDone && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOpenStep(step.key)}
                      className="shrink-0"
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Ubah
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Step detail dialog */}
      <Dialog open={openStep !== null} onOpenChange={(open) => !open && setOpenStep(null)}>
        <DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto">
          {activeDialog && (
            <>
              <DialogHeader>
                <DialogTitle>{activeDialog.dialogTitle}</DialogTitle>
                <DialogDescription>{activeDialog.dialogDescription}</DialogDescription>
              </DialogHeader>

              <div className="mt-2 space-y-4">
                {openStep === "CAPITAL" && <ModalDisetorConfigTab onSetupSaved={handleSaved} />}
                {openStep === "SAVINGS" && (
                  <>
                    <div ref={setSavingActionsEl} className="flex justify-end" />
                    <SavingConfigsTab
                      actionsTarget={savingActionsEl}
                      onSetupSaved={handleSaved}
                    />
                  </>
                )}
                {openStep === "LOANS" && <LoanConfigsTab onSetupSaved={handleSaved} />}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
