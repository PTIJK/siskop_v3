import type { LoanStatus } from "@siskop/types";
import { Badge } from "./Badge";

// Status carries a shape marker plus a word (design.md §2.3), never colour alone.
const STATUS: Record<LoanStatus, { label: string; variant: "ok" | "warn" | "bad" | "info" }> = {
  PENDING: { label: "Menunggu", variant: "warn" },
  ACTIVE: { label: "Aktif", variant: "info" },
  COMPLETED: { label: "Lunas", variant: "ok" },
  DEFAULTED: { label: "Gagal bayar", variant: "bad" }
};

export function LoanStatusBadge({ status }: { status: LoanStatus | string }) {
  const config = STATUS[status as LoanStatus];
  if (!config) return <Badge variant="outline">{status}</Badge>;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
