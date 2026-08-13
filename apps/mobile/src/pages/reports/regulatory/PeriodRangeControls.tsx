import { FileText } from "lucide-react";

// Shared by Arus Kas and Laporan Hasil Usaha (both take a from/to range) —
// mirrors apps/frontend's PeriodRangeControls.tsx. Neraca doesn't use this;
// it takes a single asOfDate.
export function PeriodRangeControls({
  from,
  to,
  onFromChange,
  onToChange,
  onSubmit,
  isLoading
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Periode</p>
      <div className="flex gap-2">
        <input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <button
        onClick={onSubmit}
        disabled={isLoading}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        <FileText className="h-4 w-4" /> {isLoading ? "Memuat..." : "Tampilkan"}
      </button>
    </div>
  );
}
