import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Member, MemberSavingsSummary, SavingTransaction } from "@siskop/types";
import { AlertTriangle } from "lucide-react";
import { apiFetch, apiFetchPage, apiPost, ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { digitsToNumber } from "@/lib/money-input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { MemberPicker, type PickerMember } from "@/components/shared/MemberPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import { SavingReceipt, type ReceiptData } from "./SavingReceipt";
import {
  MODE_LABEL,
  QUICK_AMOUNTS,
  balanceAfter,
  canReview,
  defaultAccountId,
  validateAmount,
  type AccountOption,
  type FlowMode
} from "./saving-flow";

interface FlowMember extends PickerMember {
  accounts: AccountOption[];
  totalBalance: number;
}

function fromSummary(s: MemberSavingsSummary): FlowMember {
  return {
    id: s.memberId,
    memberNumber: s.memberNumber,
    fullName: s.fullName,
    accountNumber: s.accountNumber,
    accounts: s.savings.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance })),
    totalBalance: Number(s.totalBalance)
  };
}

interface MemberWithSavings extends Member {
  savings: { id: string; savingConfig: { name: string; type: string }; balance: string; isActive: boolean }[];
}

function fromMember(m: MemberWithSavings): FlowMember {
  const accounts = m.savings.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.savingConfig.name, type: s.savingConfig.type, balance: s.balance }));
  return {
    id: m.id,
    memberNumber: m.memberId,
    fullName: m.fullName,
    accountNumber: m.accountNumber,
    accounts,
    totalBalance: accounts.reduce((sum, a) => sum + Number(a.balance), 0)
  };
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[11px] bg-muted p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className="min-h-[38px] rounded-[8px] px-5 text-[13.5px] font-bold text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-card aria-checked:text-foreground aria-checked:shadow-sm max-[900px]:min-h-11"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pilih anggota, isi nominal, tinjau, posting, struk (design.md §9.1). */
export function DepositWithdrawFlow() {
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<FlowMode>(params.get("jenis") === "tarik" ? "tarik" : "setor");
  const [member, setMember] = useState<FlowMember | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [digits, setDigits] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [prefillError, setPrefillError] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const postRef = useRef<HTMLButtonElement>(null);

  // Arriving from the member drawer (?memberId=): load that member so the teller starts at the amount.
  useEffect(() => {
    const prefillId = params.get("memberId");
    if (!prefillId) return;
    apiFetch<MemberWithSavings>(`/members/${prefillId}`)
      .then((m) => {
        const picked = fromMember(m);
        setMember(picked);
        setAccountId(defaultAccountId(picked.accounts, params.get("jenis") === "tarik" ? "tarik" : "setor"));
      })
      .catch(() => setPrefillError("Data anggota belum bisa dimuat. Cari anggota secara manual."));
    // Once on mount.
  }, []);

  const account = useMemo(() => member?.accounts.find((a) => a.id === accountId) ?? null, [member, accountId]);
  const balance = account ? Number(account.balance) : 0;
  const error = account ? validateAmount(mode, digits, balance) : undefined;
  const ready = canReview(mode, digits, balance, accountId);
  const amount = digitsToNumber(digits);
  const label = MODE_LABEL[mode];

  // Once a member is chosen the amount is the next thing to type.
  useEffect(() => {
    if (member && account) amountRef.current?.focus();
  }, [member?.id, account?.id]);

  const searchMembers = async (q: string): Promise<FlowMember[]> => {
    const { items } = await apiFetchPage<MemberSavingsSummary[]>(`/savings/by-member?page=1&limit=4&search=${encodeURIComponent(q)}`);
    return items.map(fromSummary);
  };

  function pickMember(m: FlowMember) {
    setMember(m);
    setAccountId(defaultAccountId(m.accounts, mode));
    setDigits("");
  }

  function changeMode(next: FlowMode) {
    setMode(next);
    if (member) setAccountId(defaultAccountId(member.accounts, next));
  }

  function reset() {
    setReceipt(null);
    setMember(null);
    setAccountId(null);
    setDigits("");
    setNote("");
    setShowNote(false);
    setPostError("");
    setReviewOpen(false);
  }

  async function post() {
    if (!member || !account || posting) return;
    setPosting(true);
    setPostError("");
    try {
      const tx = await apiPost<SavingTransaction>(`/savings/${account.id}/${mode === "setor" ? "deposit" : "withdraw"}`, {
        amount: Number(digits),
        note: note.trim() || undefined
      });
      // The receipt shows the balance the server reports; fall back to "unknown" rather than guessing.
      let after: number | null = null;
      try {
        const detail = await apiFetch<{ balance: string }>(`/savings/${account.id}`);
        after = Number(detail.balance);
      } catch {
        after = null;
      }
      void queryClient.invalidateQueries({ queryKey: ["savings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setReceipt({
        mode,
        transactionId: tx.id,
        postedAt: tx.createdAt,
        memberName: member.fullName,
        memberNumber: member.memberNumber,
        accountName: account.name,
        amount,
        balanceAfter: after,
        officer: user?.name ?? "-"
      });
      setReviewOpen(false);
    } catch (err) {
      setPostError(err instanceof ApiRequestError ? err.message : "Transaksi belum berhasil diposting. Periksa koneksi lalu coba lagi.");
    } finally {
      setPosting(false);
    }
  }

  if (receipt) return <SavingReceipt receipt={receipt} onNext={reset} />;

  const pokokWithdraw = mode === "tarik" && account?.type === "POKOK";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) {
          setPostError("");
          setReviewOpen(true);
        }
      }}
      noValidate
      className="grid items-start gap-4 min-[1181px]:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>1. Pilih anggota</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <MemberPicker
              selected={member}
              search={searchMembers}
              onSelect={pickMember}
              onClear={() => {
                setMember(null);
                setAccountId(null);
                setDigits("");
              }}
              trailing={(m) => formatRupiah(m.totalBalance)}
            />
            {prefillError && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{prefillError}</p>}
          </CardContent>
        </Card>

        {member && (
          <Card>
            <CardHeader>
              <CardTitle>2. Jenis dan nominal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Segmented
                label="Jenis transaksi"
                value={mode}
                onChange={changeMode}
                options={[
                  { value: "setor", label: "Setor" },
                  { value: "tarik", label: "Tarik" }
                ]}
              />

              {member.accounts.length === 0 ? (
                <div role="note" className="rounded-[12px] border bg-muted/50 p-3 text-sm">
                  <p className="font-bold">Anggota ini belum punya rekening simpanan.</p>
                  <p className="mt-0.5 text-muted-foreground">
                    Buka rekening dulu, lalu kembali ke sini.{" "}
                    <Link to={`/savings/new?mode=buka&memberId=${member.id}`} className="font-bold underline">
                      Buka rekening
                    </Link>
                  </p>
                </div>
              ) : (
                <>
                  {member.accounts.length > 1 && (
                    <div className="space-y-1.5">
                      <p id="account-label" className="text-[13px] font-bold">
                        Rekening
                      </p>
                      <div role="radiogroup" aria-labelledby="account-label" className="flex flex-wrap gap-2">
                        {member.accounts.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            role="radio"
                            aria-checked={accountId === a.id}
                            onClick={() => setAccountId(a.id)}
                            className={cn(
                              "min-h-[44px] rounded-[12px] border border-input bg-card px-3.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              accountId === a.id && "border-primary ring-1 ring-primary"
                            )}
                          >
                            <span className="block text-[13px] font-bold">{a.name}</span>
                            <span className="block text-xs tabular-nums text-muted-foreground">{formatRupiah(a.balance)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {pokokWithdraw && (
                    <p role="note" className="flex items-start gap-2 rounded-[12px] bg-warning/15 p-3 text-sm font-semibold text-warning">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      Simpanan pokok tidak dapat ditarik jika ada pinjaman aktif.
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="nominal">Nominal {label.noun.toLowerCase()}</Label>
                    <MoneyInput
                      ref={amountRef}
                      id="nominal"
                      value={digits}
                      onValueChange={setDigits}
                      error={error}
                      quickAmounts={QUICK_AMOUNTS}
                      hint={mode === "tarik" ? `Saldo rekening ${formatRupiah(balance)}.` : undefined}
                    />
                  </div>

                  {showNote ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="catatan">Catatan (opsional)</Label>
                      <Textarea id="catatan" rows={2} placeholder="Keterangan transaksi" value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                  ) : (
                    <button type="button" onClick={() => setShowNote(true)} className="min-h-11 text-[13px] font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Tambah catatan
                    </button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <aside aria-label="Ringkasan transaksi" className="min-[1181px]:sticky min-[1181px]:top-[84px]">
        <Card>
          <CardHeader>
            <CardTitle>Ringkasan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="divide-y text-sm">
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Anggota</dt>
                <dd className="text-right font-bold">{member ? member.fullName : "Belum dipilih"}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Jenis</dt>
                <dd className="text-right font-bold">{account ? `${label.noun} · ${account.name}` : label.noun}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Saldo sekarang</dt>
                <dd className="text-right font-bold tabular-nums">{account ? formatRupiah(balance) : "-"}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Nominal</dt>
                <dd className="text-right text-lg font-extrabold tabular-nums">{amount > 0 ? formatRupiah(amount) : "-"}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Saldo setelah</dt>
                <dd className="text-right font-bold tabular-nums">{account && amount > 0 && !error ? formatRupiah(balanceAfter(mode, balance, digits)) : "-"}</dd>
              </div>
            </dl>
            <Button type="submit" size="lg" className="w-full" disabled={!ready}>
              Tinjau {label.noun.toLowerCase()}
            </Button>
            {!ready && <p className="text-center text-xs text-muted-foreground">Pilih anggota dan isi nominal untuk melanjutkan.</p>}
          </CardContent>
        </Card>
      </aside>

      <Dialog open={reviewOpen} onOpenChange={(open) => !posting && setReviewOpen(open)}>
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            postRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Tinjau {label.noun.toLowerCase()}</DialogTitle>
            <DialogDescription>Periksa sekali lagi sebelum diposting.</DialogDescription>
          </DialogHeader>
          {member && account && (
            <dl className="divide-y rounded-[12px] border px-3 text-sm">
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">Anggota</dt>
                <dd className="text-right font-bold">
                  {member.fullName} <span className="font-mono text-xs font-medium text-muted-foreground">{member.memberNumber}</span>
                </dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">Jenis</dt>
                <dd className="text-right font-bold">
                  {label.noun} · {account.name}
                </dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">Nominal</dt>
                <dd className="text-right text-xl font-extrabold tabular-nums">{formatRupiah(amount)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">Saldo setelah transaksi</dt>
                <dd className="text-right font-bold tabular-nums">{formatRupiah(balanceAfter(mode, balance, digits))}</dd>
              </div>
            </dl>
          )}
          <p className="text-[12.5px] text-muted-foreground">
            Setelah diposting, transaksi langsung tercatat di rekening anggota dan jurnal, dan tidak bisa diubah dari layar ini. Jika ada yang salah, hubungi manajer untuk koreksi.
          </p>
          {postError && (
            <p role="alert" className="flex items-start gap-2 rounded-[10px] bg-destructive/[0.13] p-3 text-sm font-semibold text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {postError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={posting} onClick={() => setReviewOpen(false)}>
              Kembali
            </Button>
            <Button ref={postRef} type="button" loading={posting} onClick={() => void post()}>
              {posting ? "Memposting…" : `Posting ${label.noun.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
