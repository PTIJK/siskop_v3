import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ReferralPartnerStatus } from "@siskop/types";
import { apiDownload } from "@/api/client";
import { Button } from "@/components/ui/button";

export const STATUS_LABEL: Record<ReferralPartnerStatus, string> = { PENDING: "Menunggu", ACTIVE: "Aktif", SUSPENDED: "Ditangguhkan", REJECTED: "Ditolak" };
export const STATUS_VARIANT: Record<ReferralPartnerStatus, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  ACTIVE: "default",
  SUSPENDED: "secondary",
  REJECTED: "destructive"
};

export const rupiah = (amount: string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(amount));
export const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(iso)) : "—");

/** Copies text; clipboard access can be refused, in which case the button just does nothing visible. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()} aria-label={label}>
      {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
      {copied ? "Tersalin" : label}
    </Button>
  );
}

/** Fetches an authenticated file and hands it to the browser as a download. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const blob = await apiDownload(path);
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}
