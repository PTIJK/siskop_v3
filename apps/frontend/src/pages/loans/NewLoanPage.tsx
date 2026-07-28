import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { CreateLoanResponse, LoanConfig, Member } from "@siskop/types";
import { apiFetch, apiFetchPage, apiPost, ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { hitungAngsuranKonvensional, hitungAngsuranSyariah, type LoanCalculation } from "@/lib/loan-calc";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormError } from "@/components/shared/FormError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Search, ChevronRight, ChevronLeft } from "lucide-react";

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
  termMonths: z.string().min(1, "Tenor wajib diisi").refine((v) => parseInt(v) > 0, "Harus lebih dari 0"),
  disbursedAt: z.string().min(1, "Tanggal cair wajib diisi")
});

type Step2Form = z.infer<typeof step2Schema>;

export function NewLoanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [configs, setConfigs] = useState<LoanConfig[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<MemberResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null);
  const [hasPokokSaving, setHasPokokSaving] = useState<boolean | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<LoanConfig | null>(null);
  const [calc, setCalc] = useState<LoanCalculation | null>(null);
  const [apiError, setApiError] = useState("");
  const [existingLoanDialog, setExistingLoanDialog] = useState(false);
  const [existingLoanInfo, setExistingLoanInfo] = useState<{ amount: string; remaining: string } | null>(null);
  const [pendingFormData, setPendingFormData] = useState<Step2Form | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<Step2Form>({
    resolver: zodResolver(step2Schema),
    defaultValues: { disbursedAt: new Date().toISOString().split("T")[0] }
  });

  const principal = watch("principalAmount");
  const termMonths = watch("termMonths");

  useEffect(() => {
    apiFetch<LoanConfig[]>("/loans/configs")
      .then((data) => setConfigs(data.filter((c) => c.isActive)))
      .catch((err) => {
        const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
        toast({ title: "Gagal memuat jenis pembiayaan", description: message, variant: "destructive" });
      });

    const prefillId = searchParams.get("memberId");
    if (prefillId) {
      apiFetch<MemberWithSavings>(`/members/${prefillId}`)
        .then((m) => {
          setSelectedMember({ id: m.id, memberId: m.memberId, fullName: m.fullName, accountNumber: m.accountNumber });
          const hasPokok = m.savings?.some((s) => s.savingConfig.type === "POKOK" && s.isActive);
          setHasPokokSaving(hasPokok ?? false);
        })
        .catch((err) => {
          const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
          toast({ title: "Gagal memuat data anggota", description: message, variant: "destructive" });
        });
    }
  }, []);

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
    const result = selectedConfig.type === "SYARIAH" ? hitungAngsuranSyariah(p, rate, t) : hitungAngsuranKonvensional(p, rate, t);
    setCalc(result);
  }, [selectedConfig, principal, termMonths]);

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

  const selectMember = async (m: MemberResult) => {
    setSelectedMember(m);
    setMemberResults([]);
    setMemberSearch("");
    try {
      const member = await apiFetch<MemberWithSavings>(`/members/${m.id}`);
      const hasPokok = member.savings?.some((s) => s.savingConfig.type === "POKOK" && s.isActive);
      setHasPokokSaving(hasPokok ?? false);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal memuat data anggota", description: message, variant: "destructive" });
    }
  };

  const submitLoan = async (data: Step2Form, force = false) => {
    setApiError("");
    try {
      const result = await apiPost<CreateLoanResponse>("/loans", {
        memberId: selectedMember!.id,
        loanConfigId: data.loanConfigId,
        principalAmount: parseFloat(data.principalAmount),
        termMonths: parseInt(data.termMonths),
        disbursedAt: data.disbursedAt,
        force
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

      toast({ title: "Pinjaman berhasil diajukan" });
      navigate(`/loans/${result.id}`);
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onStep2Submit = (data: Step2Form) => submitLoan(data, false);

  return (
    <div className="space-y-6">
      <PageHeader title="Ajukan Pinjaman" breadcrumb={[{ label: "Pinjaman", href: "/loans" }, { label: "Ajukan Pinjaman" }]} />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={step >= 1 ? "font-medium text-foreground" : ""}>1. Pilih Anggota</span>
        <ChevronRight className="h-4 w-4" />
        <span className={step >= 2 ? "font-medium text-foreground" : ""}>2. Detail Pinjaman</span>
      </div>

      {step === 1 && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">Pilih Anggota</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedMember ? (
              <div className="rounded-md border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{selectedMember.fullName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{selectedMember.memberId}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedMember(null);
                      setHasPokokSaving(null);
                    }}
                  >
                    Ganti
                  </Button>
                </div>
                {hasPokokSaving !== null && (
                  <div className={`mt-3 flex items-center gap-2 text-sm ${hasPokokSaving ? "text-green-700" : "text-red-700"}`}>
                    {hasPokokSaving ? (
                      <>
                        <CheckCircle className="h-4 w-4" /> Memiliki simpanan pokok aktif
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" /> Belum memiliki simpanan pokok
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cari nama anggota..."
                  className="pl-9"
                  value={memberSearch}
                  onChange={(e) => {
                    setMemberSearch(e.target.value);
                    void searchMembers(e.target.value);
                  }}
                />
                {memberResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md">
                    {memberResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="flex w-full flex-col items-start px-4 py-2.5 text-left hover:bg-muted"
                        onClick={() => selectMember(m)}
                      >
                        <span className="text-sm font-medium">{m.fullName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{m.memberId}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button className="w-full" disabled={!selectedMember} onClick={() => setStep(2)}>
              Lanjut <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detail Pinjaman</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onStep2Submit)} className="space-y-5">
                {apiError && <FormError error={apiError} />}

                <div className="space-y-1.5">
                  <Label>Jenis Pembiayaan *</Label>
                  <Select
                    onValueChange={(v) => {
                      setValue("loanConfigId", v);
                      setSelectedConfig(configs.find((c) => c.id === v) ?? null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih jenis" />
                    </SelectTrigger>
                    <SelectContent>
                      {configs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} — {c.rateType} {c.rate}% — Maks {c.maxTermMonths} bln
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.loanConfigId && <p className="text-xs text-destructive">{errors.loanConfigId.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Nominal Pinjaman (Rp) *</Label>
                  <Input type="number" placeholder="10000000" min="1" {...register("principalAmount")} />
                  {errors.principalAmount && <p className="text-xs text-destructive">{errors.principalAmount.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Tenor (bulan) *</Label>
                  <Input
                    type="number"
                    placeholder={`1–${selectedConfig?.maxTermMonths ?? 60}`}
                    min="1"
                    max={selectedConfig?.maxTermMonths}
                    {...register("termMonths")}
                  />
                  {errors.termMonths && <p className="text-xs text-destructive">{errors.termMonths.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Tanggal Cair *</Label>
                  <Input type="date" {...register("disbursedAt")} />
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">
                    <ChevronLeft className="mr-1 h-4 w-4" /> Kembali
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isSubmitting}>
                    {isSubmitting ? "Memproses..." : "Ajukan Pinjaman"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {calc && (
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-base">Simulasi Angsuran</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  {[
                    { label: "Pokok Pinjaman", value: formatRupiah(parseFloat(principal)) },
                    { label: selectedConfig?.type === "SYARIAH" ? "Margin" : "Bunga", value: formatRupiah(calc.totalInterest) },
                    { label: "Total Kewajiban", value: formatRupiah(calc.totalAmount), bold: true },
                    { label: "Angsuran per Bulan", value: formatRupiah(calc.monthlyPayment), highlight: true },
                    { label: "Tenor", value: `${termMonths} bulan` }
                  ].map((item) => (
                    <div key={item.label} className={`flex justify-between ${item.bold ? "border-t pt-3 font-semibold" : ""}`}>
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className={item.highlight ? "text-lg font-bold text-primary" : ""}>{item.value}</span>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      )}

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
