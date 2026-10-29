import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AttentionItem, AttentionTone } from "./attention";

const TONE_TILE: Record<AttentionTone, string> = {
  bad: "bg-destructive/[0.13] text-destructive",
  warn: "bg-warning/15 text-warning",
  info: "bg-info/[0.13] text-info"
};

// Words next to the colour, so the level never depends on colour alone.
const TONE_WORD: Record<AttentionTone, string> = { bad: "Mendesak", warn: "Perlu ditinjau", info: "Info" };

function Task({ item }: { item: AttentionItem }) {
  return (
    <li className="flex gap-3 rounded-[14px] border border-hero-line p-2.5">
      <div
        aria-hidden="true"
        className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-lg font-extrabold tabular-nums", TONE_TILE[item.tone])}
      >
        {item.count}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <h3 className="text-[14px] font-extrabold leading-tight">{item.title}</h3>
          <span className={cn("text-[12px] font-bold", TONE_TILE[item.tone].split(" ")[1])}>{TONE_WORD[item.tone]}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-hero-muted">{item.detail}</p>
        <Button asChild size="sm" variant="outline" className="mt-1.5">
          <Link to={item.to}>
            {item.actionLabel}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </li>
  );
}

interface AttentionPanelProps {
  items: AttentionItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

const VISIBLE = 4;

/** "Perlu perhatian hari ini" (design.md §10): at most four tasks in view, ordered by risk. */
export function AttentionPanel({ items, isLoading, isError, onRetry }: AttentionPanelProps) {
  const shown = items.slice(0, VISIBLE);
  const rest = items.slice(VISIBLE);
  return (
    <section aria-labelledby="attention-heading" className="rounded-[20px] border border-hero-line bg-hero p-[18px] text-hero-foreground">
      <h2 id="attention-heading" className="text-[17px] font-extrabold tracking-tight">
        Perlu perhatian hari ini
      </h2>
      <p className="mb-3 mt-0.5 text-[12.5px] text-hero-muted">Diurutkan dari yang paling berisiko.</p>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" role="status">
          <span className="sr-only">Memuat tugas hari ini</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] w-full rounded-[14px]" />
          ))}
        </div>
      ) : isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-[14px] border border-destructive/40 p-4 text-sm">
          <p className="flex items-center gap-2 font-bold text-destructive">
            <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
            Ringkasan belum bisa dimuat.
          </p>
          <p className="text-hero-muted">Periksa koneksi Anda, lalu coba lagi.</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Coba lagi
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-start gap-3 rounded-[14px] border border-hero-line p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="text-sm font-extrabold">Tidak ada yang perlu ditindaklanjuti hari ini.</p>
            <p className="mt-0.5 text-[12.5px] text-hero-muted">Pinjaman, pendaftaran, dan tagihan sedang dalam keadaan baik.</p>
          </div>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {shown.map((item) => (
              <Task key={item.id} item={item} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer rounded-md py-1 text-[13px] font-bold">Lihat {rest.length} hal lainnya</summary>
              <ul className="mt-2 space-y-2.5">
                {rest.map((item) => (
                  <Task key={item.id} item={item} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
