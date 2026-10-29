import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { BmppHeadroom, CreateLoanResponse, LoanConfig, Member, PreviewScheduleResult } from "@siskop/types";
import { apiFetch, apiFetchPage, apiPost, ApiRequestError } from "@/api/client";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { addMonths, differenceInCalendarDays } from "date-fns";
import { hitungAngsuranHarian, hitungAngsuranKonvensional, hitungAngsuranSyariah, type LoanCalculation } from "@/lib/loan-calc";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormError } from "@/components/shared/FormError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Stepper } from "@/components/shared/Stepper";
import { GlossaryTerm } from "@/components/shared/GlossaryTerm";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Search, ChevronRight, ChevronLeft } from "lucide-react";

const STEPS = ["Anggota", "Produk dan syarat", "Jadwal", "Tinjau"] as const;

interface MemberResult {
  id: string;
  memberId: string;
  fullName: string;
  accountNumber: string;
}

interface MemberWithSavings extends Member {
  savings: { savingConfig: { type: string }; isActive: boolean }[];
}

const step2Schema = z.object({
  loanConfigId: z.string().min(1, "Pilih jenis pembiayaan"),
  principalAmount: z.string().min(1, "Nominal wajib diisi").refine((v) => parseFloat(v) > 0, "Harus lebih dari 0"),
  // Required for a MONTHLY loan config; installmentCount is required instead for DAILY/WEEKLY
  // (checked imperatively in onStep2Submit, since that depends on the selected config).
  termMonths: z.string().optional(),
  installmentCount: z.string().optional(),
  rate: z.string().optional(),
  rateNote: z.string().optional(),
  disbursedAt: z.string().min(1, "Tanggal cair wajib diisi")
});

type Step2Form = z.infer<typeof step2Schema>;

export function NewLoanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [reviewed, setReviewed] = useState(false);
  const [stepError, setStepError] = useState("");
  const [configs, setConfigs] = useState<LoanConfig[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<MemberResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(() => searchParams.get("memberId"));
  const [hasPokokSaving, setHasPokokSaving] = useState<boolean | null>(null);
  const [memberCheckError, setMemberCheckError] = useState("");
  const [memberCheckAttempt, setMemberCheckAttempt] = useState(0);
  const memberRequest = useRef(0);
  const [bmpp, setBmpp] = useState<BmppHeadroom | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<LoanConfig | null>(null);
  const [calc, setCalc] = useState<LoanCalculation | null>(null);
  const [schedulePreview, setSchedulePreview] = useState<PreviewScheduleResult | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [apiError, setApiError] = useState("");
  const [existingLoanDialog, setExistingLoanDialog] = useState(false);
  const [existingLoanInfo, setExistingLoanInfo] = useState<{ amount: string; remaining: string } | null>(null);
  const [pendingFormData, setPendingFormData] = useState<Step2Form | null>(null);
  // Set when the API asks to confirm a loan over the 15% BMPP; "force" carries
  // over so the resubmit doesn't ask the existing-loan question again.
  const [bmppWarning, setBmppWarning] = useState<(BmppHeadroom & { requested: string; force: boolean }) | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors, isSubmitting }
  } = useForm<Step2Form>({
    resolver: zodResolver(step2Schema),
    defaultValues: { disbursedAt: new Date().toISOString().split("T")[0] }
  });

  const principal = watch("principalAmount");
  const termMonths = watch("termMonths");
  const installmentCount = watch("installmentCount");
  const rateOverride = watch("rate");
  const disbursedAt = watch("disbursedAt");
  const isMonthly = !selectedConfig || selectedConfig.installmentFrequency === "MONTHLY";
  const canContinue = selectedMember !== null && selectedMember.id === selectedMemberId && hasPokokSaving === true && !memberCheckError;

  useEffect(() => {
    apiFetch<LoanConfig[]>("/loans/configs")
      .then((data) => setConfigs(data.filter((c) => c.isActive)))
      .catch((err) => {
        const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
        toast({ title: "Gagal memuat jenis pembiayaan", description: message, variant: "destructive" });
      });

  }, []);

  useEffect(() => {
    if (!selectedMemberId) return;
    const request = ++memberRequest.current;
    const controller = new AbortController();
    let active = true;
    const isCurrent = () => active && request === memberRequest.current;
    setHasPokokSaving(null);
    setMemberCheckError("");
    setBmpp(null);
    void (async () => {
      try {
        const member = await apiFetch<MemberWithSavings>(`/members/${encodeURIComponent(selectedMemberId)}`, { signal: controller.signal });
        if (!isCurrent()) return;
        setSelectedMember({ id: member.id, memberId: member.memberId, fullName: member.fullName, accountNumber: member.accountNumber });
        setHasPokokSaving(member.savings?.some((saving) => saving.savingConfig.type === "POKOK" && saving.isActive) ?? false);
        // BMPP is advisory here; the server recalculates and enforces it on submission.
        try {
          const headroom = await apiFetch<BmppHeadroom>(`/loans/bmpp-headroom?memberId=${encodeURIComponent(member.id)}`, { signal: controller.signal });
          if (isCurrent()) setBmpp(headroom);
        } catch {
          if (isCurrent()) setBmpp(null);
        }
      } catch {
        if (isCurrent()) setMemberCheckError("Belum dapat memeriksa simpanan pokok anggota. Coba lagi sebelum melanjutkan.");
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [selectedMemberId, memberCheckAttempt]);

  useEffect(() => {
    if (!selectedConfig || !principal || !termMonths) {
      setCalc(null);
      return;
    }
    const p = parseFloat(principal);
    const t = parseInt(termMonths);
    if (isNaN(p) || isNaN(t) || p <= 0 || t <= 0) {
      setCalc(null);
      return;
    }
    const rate = parseFloat(selectedConfig.rate);

    if (selectedConfig.rateType === "HARIAN") {
      const disbursed = disbursedAt ? new Date(disbursedAt) : new Date();
      const termDays = differenceInCalendarDays(addMonths(disbursed, t), disbursed);
      setCalc(hitungAngsuranHarian(p, rate, t, termDays));
      return;
    }

    const result =
      selectedConfig.type === "SYARIAH" || selectedConfig.rateType === "MARGIN"
        ? hitungAngsuranSyariah(p, rate, t)
        : hitungAngsuranKonvensional(p, rate, t);
    setCalc(result);
  }, [selectedConfig, principal, termMonths, disbursedAt]);

  // DAILY/WEEKLY loans have no client-side formula (D8's Rp500 rounding and
  // operating-day due dates live in buildSchedule on the backend), so their
  // preview comes from the same endpoint createLoan will use.
  useEffect(() => {
    if (!selectedConfig || selectedConfig.installmentFrequency === "MONTHLY") {
      setSchedulePreview(null);
      setPreviewError("");
      return;
    }
    const p = parseFloat(principal);
    const count = parseInt(installmentCount ?? "");
    if (isNaN(p) || p <= 0 || isNaN(count) || count <= 0) {
      setSchedulePreview(null);
      return;
    }
    const timer = setTimeout(() => {
      apiPost<PreviewScheduleResult>("/loans/configs/preview-schedule", {
        loanConfigId: selectedConfig.id,
        principalAmount: p,
        installmentCount: count,
        rate: rateOverride ? parseFloat(rateOverride) : undefined,
        disbursedAt: disbursedAt || undefined
      })
        .then((result) => {
          setSchedulePreview(result);
          setPreviewError("");
        })
        .catch((err) => {
          setSchedulePreview(null);
          setPreviewError(err instanceof ApiRequestError ? err.message : "Gagal memuat pratinjau jadwal");
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [selectedConfig, principal, installmentCount, rateOverride, disbursedAt]);

  const searchMembers = async (q: string) => {
    if (q.length < 2) {
      setMemberResults([]);
      return;
    }
    try {
      const { items } = await apiFetchPage<Member[]>(`/members?search=${encodeURIComponent(q)}&limit=5`);
      setMemberResults(items);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal mencari anggota", description: message, variant: "destructive" });
    }
  };

  const resetMemberCheck = () => {
    // Invalidate immediately, before effect cleanup, when selection changes.
    memberRequest.current += 1;
    setHasPokokSaving(null);
    setMemberCheckError("");
    setBmpp(null);
  };

  const selectMember = (m: MemberResult | null) => {
    resetMemberCheck();
    setSelectedMember(m);
    setSelectedMemberId(m?.id ?? null);
    setMemberCheckAttempt((attempt) => attempt + 1);
    setMemberResults([]);
    setMemberSearch("");
  };

  const submitLoan = async (data: Step2Form, force = false, acknowledgeBmpp = false) => {
    if (!canContinue) { setStep(1); return; }
    setApiError("");
    const configFrequency = configs.find((c) => c.id === data.loanConfigId)?.installmentFrequency ?? "MONTHLY";
    if (configFrequency === "MONTHLY" && !data.termMonths) {
      setApiError("Tenor (bulan) wajib diisi");
      return;
    }
    if (configFrequency !== "MONTHLY" && !data.installmentCount) {
      setApiError("Jumlah cicilan wajib diisi");
      return;
    }
    try {
      const result = await apiPost<CreateLoanResponse>("/loans", {
        memberId: selectedMember!.id,
        loanConfigId: data.loanConfigId,
        principalAmount: parseFloat(data.principalAmount),
        termMonths: configFrequency === "MONTHLY" ? parseInt(data.termMonths!) : undefined,
        installmentCount: configFrequency !== "MONTHLY" ? parseInt(data.installmentCount!) : undefined,
        rate: data.rate ? parseFloat(data.rate) : undefined,
        rateNote: data.rateNote || undefined,
        disbursedAt: data.disbursedAt,
        force,
        acknowledgeBmpp
      });

      // The member already has an active/pending loan — a 200 with this flag,
      // not an error, is how the API asks for confirmation before a second one.
      // (Checking only `in`, not `&& result.hasExistingLoan`, is what lets TS
      // narrow `result` back to `Loan` for the code after this block.)
      if ("hasExistingLoan" in result) {
        setExistingLoanInfo({
          amount: result.existingLoan.principalAmount,
          remaining: result.existingLoan.remainingAmount
        });
        setPendingFormData(data);
        setExistingLoanDialog(true);
        return;
      }

      // Over 15% of Modal Sendiri for a non-pengurus member: a warning to confirm, not a rejection.
      if ("bmppExceeded" in result) {
        setPendingFormData(data);
        setBmppWarning({ ...result.bmpp, force });
        return;
      }

      toast({ title: "Pinjaman berhasil diajukan" });
      navigate(`/loans/${result.id}`);
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onStep2Submit = (data: Step2Form) => submitLoan(data, false);

  // Step 2 -> 3: the same field checks the single submit used to do, moved to the "Lanjut" button.
  const goToSchedule = async () => {
    setStepError("");
    const valid = await trigger();
    if (!valid) return;
    if (isMonthly && !termMonths) {
      setStepError("Tenor (bulan) wajib diisi");
      return;
    }
    if (!isMonthly && !installmentCount) {
      setStepError("Jumlah cicilan wajib diisi");
      return;
    }
    setStep(3);
  };

  const scheduleReady = isMonthly ? calc !== null : schedulePreview !== null;
  const firstInstallment = schedulePreview?.installments[0]
    ? Number(schedulePreview.installments[0].principalDue) + Number(schedulePreview.installments[0].interestDue)
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pinjaman baru"
        description="Empat langkah: pilih anggota, atur produk dan syarat, periksa jadwal, lalu tinjau dan ajukan."
        breadcrumb={[{ label: "Pinjaman", href: "/loans" }, { label: "Pinjaman baru" }]}
      />

      <Stepper steps={STEPS} current={step - 1} />

      {step === 1 && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Pilih anggota</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedMember ? (
              <div className="rounded-[14px] border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-extrabold">{selectedMember.fullName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{selectedMember.memberId}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => selectMember(null)}
                  >
                    Ganti
                  </Button>
                </div>
                {hasPokokSaving !== null && (
                  <div className={`mt-3 flex items-center gap-2 text-sm font-semibold ${hasPokokSaving ? "text-success" : "text-destructive"}`}>
                    {hasPokokSaving ? (
                      <>
                        <CheckCircle className="h-4 w-4" aria-hidden="true" /> Memiliki simpanan pokok aktif
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" aria-hidden="true" /> Belum memiliki simpanan pokok
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-[13px] h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />
                <Input
                  placeholder="Cari nama anggota..."
                  aria-label="Cari anggota"
                  className="pl-10"
                  value={memberSearch}
                  onChange={(e) => {
                    setMemberSearch(e.target.value);
                    void searchMembers(e.target.value);
                  }}
                />
                {memberResults.length > 0 && (
                  <div className="mt-1 divide-y overflow-hidden rounded-[14px] border bg-card">
                    {memberResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="flex min-h-[56px] w-full flex-col items-start justify-center px-4 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        onClick={() => selectMember(m)}
                      >
                        <span className="text-sm font-bold">{m.fullName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{m.memberId}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedMemberId && hasPokokSaving === null && !memberCheckError && (
              <p role="status" className="text-sm text-muted-foreground">Memeriksa simpanan pokok anggota…</p>
            )}
            {memberCheckError && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{memberCheckError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  resetMemberCheck();
                  setMemberCheckAttempt((attempt) => attempt + 1);
                }}>Coba lagi</Button>
              </div>
            )}
            <Button className="w-full" disabled={!canContinue} onClick={() => { if (canContinue) setStep(2); }}>
              Lanjut <ChevronRight aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      )}

      {step >= 2 && (
        <form onSubmit={handleSubmit(onStep2Submit)} noValidate className="space-y-4">
          {apiError && <FormError error={apiError} />}

          {step === 2 && (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>Produk dan syarat</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {bmpp?.isRelatedParty && (
                  <div role="note" className="rounded-[12px] border border-warning/50 bg-warning/10 p-3 text-sm">
                    <p className="font-bold text-warning">Anggota ini pengurus/pengawas: batas pinjaman pihak terkait berlaku</p>
                    <p className="mt-0.5 text-xs">
                      Pinjaman aktif {formatRupiah(bmpp.existingPrincipal)} dari batas {formatRupiah(bmpp.limit)} (10% <GlossaryTerm term="Modal Sendiri" />
                      {bmpp.basis === "UNIT" ? " unit" : ""}, Permenkop UKM 8/2023). Sisa ruang: <strong>{formatRupiah(bmpp.headroom)}</strong>.
                    </p>
                  </div>
                )}
                {bmpp && !bmpp.isRelatedParty && Number(bmpp.modalSendiri) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Batas konsentrasi pinjaman (<GlossaryTerm term="BMPP" /> 15% modal sendiri{bmpp.basis === "UNIT" ? " unit" : ""}): sisa ruang{" "}
                    {formatRupiah(bmpp.headroom)} dari {formatRupiah(bmpp.limit)}.
                  </p>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="loan-config">Jenis pembiayaan</Label>
                  <Select
                    value={watch("loanConfigId") ?? ""}
                    onValueChange={(v) => {
                      setValue("loanConfigId", v, { shouldValidate: true });
                      setSelectedConfig(configs.find((c) => c.id === v) ?? null);
                    }}
                  >
                    <SelectTrigger id="loan-config" aria-invalid={errors.loanConfigId ? true : undefined}>
                      <SelectValue placeholder="Pilih jenis" />
                    </SelectTrigger>
                    <SelectContent>
                      {configs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} · {c.rateType} {c.rate}% ·{" "}
                          {c.installmentFrequency === "MONTHLY"
                            ? `Maks ${c.maxTermMonths} bln`
                            : `${c.installmentFrequency === "DAILY" ? "Harian" : "Mingguan"}${c.maxInstallments ? `, maks ${c.maxInstallments}x` : ""}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.loanConfigId && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.loanConfigId.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="loan-principal">Nominal pinjaman</Label>
                  <MoneyInput
                    id="loan-principal"
                    value={principal ?? ""}
                    onValueChange={(digits) => setValue("principalAmount", digits, { shouldValidate: true })}
                    error={errors.principalAmount?.message}
                    quickAmounts={[5_000_000, 10_000_000, 25_000_000, 50_000_000]}
                  />
                </div>

                {isMonthly ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="loan-term">Tenor (bulan)</Label>
                    <Input
                      id="loan-term"
                      type="number"
                      inputMode="numeric"
                      placeholder={`1–${selectedConfig?.maxTermMonths ?? 60}`}
                      min="1"
                      max={selectedConfig?.maxTermMonths}
                      {...register("termMonths")}
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="loan-count">Jumlah cicilan ({selectedConfig?.installmentFrequency === "DAILY" ? "hari" : "minggu"})</Label>
                    <Input
                      id="loan-count"
                      type="number"
                      inputMode="numeric"
                      placeholder={selectedConfig?.maxInstallments ? `1–${selectedConfig.maxInstallments}` : undefined}
                      min="1"
                      max={selectedConfig?.maxInstallments ?? undefined}
                      {...register("installmentCount")}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="loan-date">Tanggal cair</Label>
                  <Input id="loan-date" type="date" {...register("disbursedAt")} />
                </div>

                <fieldset className="grid grid-cols-1 gap-4 rounded-[12px] border p-3 sm:grid-cols-2">
                  <legend className="px-1 text-xs font-semibold text-muted-foreground">
                    Ubah rate (opsional): kosongkan untuk memakai rate produk ({selectedConfig?.rate ?? "-"}%)
                  </legend>
                  <div className="space-y-1.5">
                    <Label htmlFor="loan-rate">Rate (%)</Label>
                    <Input id="loan-rate" type="number" step="0.01" placeholder={selectedConfig?.rate} {...register("rate")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="loan-rate-note">Catatan {rateOverride && "(wajib)"}</Label>
                    <Input id="loan-rate-note" placeholder="Alasan perubahan rate" {...register("rateNote")} />
                  </div>
                </fieldset>

                {stepError && <FormError error={stepError} />}

                <div className="sticky bottom-0 -mx-[18px] -mb-[18px] flex gap-3 rounded-b-[16px] border-t bg-card p-4">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">
                    <ChevronLeft aria-hidden="true" /> Kembali
                  </Button>
                  <Button type="button" className="flex-1" onClick={() => void goToSchedule()}>
                    Lanjut <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 3 && (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>Jadwal angsuran</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {isMonthly ? (
                  calc ? (
                    <dl className="divide-y text-sm">
                      {[
                        { label: "Pokok pinjaman", value: formatRupiah(parseFloat(principal)) },
                        {
                          label:
                            selectedConfig?.rateType === "HARIAN"
                              ? "Bunga harian"
                              : selectedConfig?.type === "SYARIAH"
                                ? "Margin"
                                : "Bunga",
                          value: formatRupiah(calc.totalInterest)
                        },
                        { label: "Total kewajiban", value: formatRupiah(calc.totalAmount), bold: true },
                        { label: "Angsuran per bulan", value: formatRupiah(calc.monthlyPayment), highlight: true },
                        { label: "Tenor", value: `${termMonths} bulan` }
                      ].map((item) => (
                        <div key={item.label} className={`flex justify-between gap-4 py-2.5 ${item.bold ? "font-extrabold" : ""}`}>
                          <dt className="text-muted-foreground">{item.label}</dt>
                          <dd className={`tabular-nums ${item.highlight ? "text-xl font-extrabold" : "font-bold"}`}>{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">Jadwal belum bisa dihitung. Kembali dan lengkapi nominal, tenor, dan jenis pembiayaan.</p>
                  )
                ) : (
                  <div className="space-y-3 text-sm">
                    {previewError && <FormError error={previewError} />}
                    {!schedulePreview && !previewError && (
                      <p role="status" className="text-muted-foreground">Menghitung jadwal cicilan…</p>
                    )}
                    {schedulePreview && (
                      <dl className="divide-y">
                        <div className="flex justify-between gap-4 py-2.5 font-extrabold">
                          <dt className="text-muted-foreground">Total kewajiban</dt>
                          <dd className="tabular-nums">{formatRupiah(schedulePreview.totalAmount)}</dd>
                        </div>
                        <div className="flex justify-between gap-4 py-2.5">
                          <dt className="text-muted-foreground">Total jasa/bunga</dt>
                          <dd className="font-bold tabular-nums">{formatRupiah(schedulePreview.totalInterest)}</dd>
                        </div>
                        <div className="flex justify-between gap-4 py-2.5">
                          <dt className="text-muted-foreground">Cicilan pertama</dt>
                          <dd className="text-xl font-extrabold tabular-nums">{formatRupiah(firstInstallment ?? 0)}</dd>
                        </div>
                        <div className="flex justify-between gap-4 py-2.5">
                          <dt className="text-muted-foreground">Jatuh tempo pertama</dt>
                          <dd className="font-bold">{schedulePreview.installments[0]?.dueDate}</dd>
                        </div>
                        <div className="flex justify-between gap-4 py-2.5">
                          <dt className="text-muted-foreground">Jatuh tempo terakhir</dt>
                          <dd className="font-bold">{schedulePreview.installments.at(-1)?.dueDate}</dd>
                        </div>
                      </dl>
                    )}
                    {schedulePreview && (
                      <p className="text-xs text-muted-foreground">
                        {schedulePreview.installments.length} cicilan, dibulatkan ke Rp500 terdekat (cicilan terakhir menyerap sisa).
                      </p>
                    )}
                  </div>
                )}

                <div className="sticky bottom-0 -mx-[18px] -mb-[18px] flex gap-3 rounded-b-[16px] border-t bg-card p-4">
                  <Button type="button" variant="outline" onClick={() => setStep(2)} className="flex-1">
                    <ChevronLeft aria-hidden="true" /> Kembali
                  </Button>
                  <Button type="button" className="flex-1" disabled={!scheduleReady} onClick={() => setStep(4)}>
                    Lanjut <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 4 && (
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>Tinjau pengajuan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <dl className="divide-y rounded-[12px] border px-3 text-sm">
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">Anggota</dt>
                    <dd className="text-right font-bold">
                      {selectedMember?.fullName} <span className="font-mono text-xs font-medium text-muted-foreground">{selectedMember?.memberId}</span>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">Produk</dt>
                    <dd className="text-right font-bold">{selectedConfig?.name}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">Nominal</dt>
                    <dd className="text-right text-lg font-extrabold tabular-nums">{formatRupiah(parseFloat(principal || "0"))}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">{isMonthly ? "Tenor" : "Jumlah cicilan"}</dt>
                    <dd className="text-right font-bold">{isMonthly ? `${termMonths} bulan` : `${installmentCount} ${selectedConfig?.installmentFrequency === "DAILY" ? "hari" : "minggu"}`}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">{isMonthly ? "Angsuran per bulan" : "Cicilan pertama"}</dt>
                    <dd className="text-right font-extrabold tabular-nums">
                      {isMonthly ? formatRupiah(calc?.monthlyPayment ?? 0) : formatRupiah(firstInstallment ?? 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">Total kewajiban</dt>
                    <dd className="text-right font-bold tabular-nums">{formatRupiah(isMonthly ? (calc?.totalAmount ?? 0) : (schedulePreview?.totalAmount ?? 0))}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">Tanggal cair</dt>
                    <dd className="text-right font-bold">{disbursedAt ? formatTanggalPendek(disbursedAt) : "-"}</dd>
                  </div>
                </dl>

                <div className="flex items-start gap-3 rounded-[12px] border p-3">
                  <Checkbox id="loan-reviewed" checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} className="mt-0.5" />
                  <Label htmlFor="loan-reviewed" className="cursor-pointer text-sm font-semibold leading-snug">
                    Saya sudah memeriksa data anggota, simpanan pokok, dan syarat pinjaman di atas.
                  </Label>
                </div>

                <div className="sticky bottom-0 -mx-[18px] -mb-[18px] flex gap-3 rounded-b-[16px] border-t bg-card p-4">
                  <Button type="button" variant="outline" onClick={() => setStep(3)} className="flex-1">
                    <ChevronLeft aria-hidden="true" /> Kembali
                  </Button>
                  <Button type="submit" className="flex-1" disabled={!reviewed} loading={isSubmitting}>
                    {isSubmitting ? "Memproses…" : "Ajukan pinjaman"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </form>
      )}

      <Dialog open={bmppWarning !== null} onOpenChange={(open) => !open && setBmppWarning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Melebihi Batas Konsentrasi Pinjaman (BMPP)</DialogTitle>
            <DialogDescription>
              Pinjaman aktif anggota {formatRupiah(bmppWarning?.existingPrincipal ?? 0)} ditambah pengajuan ini{" "}
              {formatRupiah(bmppWarning?.requested ?? 0)} melebihi batas <strong>{formatRupiah(bmppWarning?.limit ?? 0)}</strong>{" "}
              (15% dari modal sendiri {formatRupiah(bmppWarning?.modalSendiri ?? 0)}, Permenkop UKM 8/2023 Pasal 45). Lanjutkan
              hanya jika pengurus telah menyetujui pengecualian ini.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBmppWarning(null)}>
              Batal
            </Button>
            <Button
              onClick={async () => {
                const force = bmppWarning?.force ?? false;
                setBmppWarning(null);
                if (pendingFormData) await submitLoan(pendingFormData, force, true);
              }}
            >
              Tetap Ajukan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={existingLoanDialog} onOpenChange={setExistingLoanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anggota Sudah Memiliki Pinjaman Aktif</DialogTitle>
            <DialogDescription>
              Anggota ini sudah memiliki pinjaman aktif sebesar <strong>{formatRupiah(existingLoanInfo?.amount ?? 0)}</strong> dengan
              sisa <strong>{formatRupiah(existingLoanInfo?.remaining ?? 0)}</strong>. Apakah Anda tetap ingin mengajukan pinjaman baru?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExistingLoanDialog(false)}>
              Batal
            </Button>
            <Button
              onClick={async () => {
                setExistingLoanDialog(false);
                if (pendingFormData) await submitLoan(pendingFormData, true);
              }}
            >
              Lanjutkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
