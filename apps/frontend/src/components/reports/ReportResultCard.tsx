import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { useAccessibleUnits } from "@/hooks/useAccessibleUnits";
import { ALL_UNITS } from "@/lib/unit";

/** Name of the selected unit for a result header, or null when consolidated / single-unit. */
export function useUnitLabel(unitId: string): string | null {
  const { data: units } = useAccessibleUnits();
  if (unitId === ALL_UNITS || !units || units.length <= 1) return null;
  return units.find((u) => u.id === unitId)?.name ?? null;
}

interface ReportResultProps {
  /** Report name as shown in the empty state ("Tidak Ada Data Neraca"). */
  reportName: string;
  title: string;
  /** Applied-filter summary, e.g. "1 Oktober 2026 – 10 Oktober 2026 · Unit Toko". */
  subtitle?: string;
  /** Print / balance chip etc., right-aligned in the header. */
  actions?: ReactNode;
  isLoading: boolean;
  /** Has a run finished? false shows the "set a period" prompt instead of "no data". */
  hasRun: boolean;
  /** Does the loaded report contain anything to show? */
  hasData: boolean;
  children: ReactNode;
}

export function ReportResultCard({ reportName, title, subtitle, actions, isLoading, hasRun, hasData, children }: ReportResultProps) {
  if (isLoading) return <PageLoading />;

  if (!hasRun) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
        <FileText className="h-10 w-10" />
        <p className="text-sm">Pilih periode dan klik &quot;Tampilkan&quot;</p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
        <FileText className="h-10 w-10" />
        <p className="text-sm font-semibold">Tidak Ada Data {reportName}</p>
        {subtitle && <p className="text-xs">{subtitle}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
