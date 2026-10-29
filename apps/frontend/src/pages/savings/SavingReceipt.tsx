import { useEffect, useRef } from "react";
import { Check, Printer, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRupiah, formatTanggalJamWib } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { MODE_LABEL, type FlowMode } from "./saving-flow";

export interface ReceiptData {
  mode: FlowMode;
  transactionId: string;
  postedAt: string;
  memberName: string;
  memberNumber: string;
  accountName: string;
  amount: number;
  /** Balance the server reports after posting; null when it could not be re-read. */
  balanceAfter: number | null;
  officer: string;
}

/** Short, readable transaction number derived from the real id (no invented numbering). */
export function receiptNumber(id: string): string {
  return id.slice(-8).toUpperCase();
}

function shareText(r: ReceiptData): string {
  const lines = [
    `${MODE_LABEL[r.mode].posted} (SISKOP)`,
    `No. transaksi: ${receiptNumber(r.transactionId)}`,
    `Tanggal: ${formatTanggalJamWib(r.postedAt)}`,
    `Anggota: ${r.memberName} (${r.memberNumber})`,
    `Rekening: ${r.accountName}`,
    `Nominal: ${formatRupiah(r.amount)}`,
    ...(r.balanceAfter !== null ? [`Saldo setelah transaksi: ${formatRupiah(r.balanceAfter)}`] : []),
    `Petugas: ${r.officer}`
  ];
  return lines.join("\n");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-bold">{children}</dd>
    </div>
  );
}

/** Success state after posting (design.md §9.2). Only this block prints. */
export function SavingReceipt({ receipt, onNext }: { receipt: ReceiptData; onNext: () => void }) {
  const { toast } = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the result so keyboard and screen-reader users land on it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function share() {
    const text = shareText(receipt);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: MODE_LABEL[receipt.mode].posted, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast({ title: "Ringkasan struk disalin", description: "Tempel ke pesan untuk membagikannya." });
    } catch {
      // The user dismissing the share sheet is not an error worth shouting about.
    }
  }

  return (
    <div className="mx-auto max-w-[520px] space-y-4">
      <div className="print-area rounded-[20px] border bg-card p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/[0.13] text-success">
            <Check className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-extrabold tracking-tight outline-none">
            {MODE_LABEL[receipt.mode].posted}
          </h2>
          <p className="text-sm text-muted-foreground">
            No. transaksi <span className="font-mono font-bold text-foreground">{receiptNumber(receipt.transactionId)}</span>
          </p>
        </div>

        <p className="my-5 text-center text-[30px] font-extrabold tracking-tight tabular-nums">{formatRupiah(receipt.amount)}</p>

        <dl className="divide-y border-y">
          <Row label="Tanggal">{formatTanggalJamWib(receipt.postedAt)}</Row>
          <Row label="Anggota">
            {receipt.memberName} <span className="font-mono text-xs font-medium text-muted-foreground">{receipt.memberNumber}</span>
          </Row>
          <Row label="Jenis">
            {MODE_LABEL[receipt.mode].noun} · {receipt.accountName}
          </Row>
          <Row label="Saldo setelah transaksi">
            <span className="tabular-nums">{receipt.balanceAfter !== null ? formatRupiah(receipt.balanceAfter) : "Muat ulang untuk melihat"}</span>
          </Row>
          <Row label="Petugas">{receipt.officer}</Row>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden="true" /> Cetak struk
        </Button>
        <Button variant="outline" onClick={() => void share()}>
          <Share2 aria-hidden="true" /> Bagikan
        </Button>
        <Button variant="default" size="lg" className="ml-auto" onClick={onNext}>
          Transaksi berikutnya
        </Button>
      </div>
    </div>
  );
}
