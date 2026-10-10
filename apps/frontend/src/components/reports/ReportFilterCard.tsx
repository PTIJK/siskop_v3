import type { ReactNode } from "react";
import { FileText, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PERIOD_PRESETS, presetRange, todayLocal, validatePeriod } from "@/pages/reports/regulatory/period";

interface ReportFilterCardProps {
  /** Lower-case report name, used in the hint line. */
  reportName: string;
  /** "range" = Tanggal Awal/Akhir; "asOf" = a single "Per Tanggal" (stored in `to`). */
  mode?: "range" | "asOf";
  from: string;
  to: string;
  onChange: (patch: { from?: string; to?: string }) => void;
  onApply: () => void;
  onReset: () => void;
  isLoading: boolean;
  /** Extra controls (e.g. UnitFilter) between the dates and the buttons. */
  extra?: ReactNode;
}

function asOfError(to: string, today: string): string | null {
  if (!to) return "Masukkan tanggal terlebih dahulu";
  if (to > today) return "Tanggal tidak boleh melebihi hari ini";
  return null;
}

export function ReportFilterCard({ reportName, mode = "range", from, to, onChange, onApply, onReset, isLoading, extra }: ReportFilterCardProps) {
  const today = todayLocal();
  const error = mode === "range" ? validatePeriod(from, to, today) : asOfError(to, today);

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-end gap-3">
          {mode === "range" ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Tanggal Awal</Label>
                <Input
                  type="date"
                  value={from}
                  max={today}
                  onChange={(e) => {
                    // A new start after the current end would make the pair invalid, so drag the end along.
                    const next = e.target.value;
                    onChange(next && to && next > to ? { from: next, to: next } : { from: next });
                  }}
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tanggal Akhir</Label>
                <Input
                  type="date"
                  value={to}
                  min={from || undefined}
                  max={today}
                  disabled={!from}
                  onChange={(e) => onChange({ to: e.target.value })}
                  className="w-40"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Per Tanggal</Label>
              <Input type="date" value={to} max={today} onChange={(e) => onChange({ to: e.target.value })} className="w-40" />
            </div>
          )}
          {extra}
          <Button onClick={onApply} disabled={isLoading || error !== null}>
            <FileText className="mr-2 h-4 w-4" />
            {isLoading ? "Memuat..." : "Tampilkan"}
          </Button>
          <Button variant="outline" onClick={onReset} disabled={isLoading}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
        </div>

        {mode === "range" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Cepat:</span>
            {PERIOD_PRESETS.map((p) => (
              <Button key={p.id} variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange(presetRange(p.id))}>
                {p.label}
              </Button>
            ))}
          </div>
        )}

        <p className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {error ?? `Atur filter lalu klik "Tampilkan" untuk menampilkan ${reportName}.`}
        </p>
      </CardContent>
    </Card>
  );
}
