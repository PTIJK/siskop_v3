import { useState } from "react";
import { NeracaTab } from "./regulatory/NeracaTab";
import { ArusKasTab } from "./regulatory/ArusKasTab";
import { LabaRugiTab } from "./regulatory/LabaRugiTab";
import { ShuDistribusiTab } from "./regulatory/ShuDistribusiTab";
import { CalkTab } from "./regulatory/CalkTab";
import { cn } from "@/lib/utils";

// FR-MOB-RPT-01 extension (docs/06-PRD-SISKOP-Mobile-Version.md §7/§12) —
// all 5 regulatory reports are now built, view-only. CALK's narrative
// sections use only the "read" half of desktop's own canEdit-gated
// NarrativeEditor (docs/06 §12) — editing is Fase 2 (input) work, not a
// missing screen. Desktop's RegulatoryReportsPage.tsx uses a `TabsList`
// that the original UI audit flagged as wrapping onto multiple rows at 5
// tabs (docs/06 §8.1) — this uses a horizontal-scroll strip instead.
const TABS = [
  { value: "neraca", label: "Neraca" },
  { value: "arus-kas", label: "Arus Kas" },
  { value: "laba-rugi", label: "Hasil Usaha" },
  { value: "shu", label: "Pembagian SHU" },
  { value: "calk", label: "CALK" }
] as const;

export function RegulatoryReportsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("neraca");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Laporan Regulasi</h1>
        <p className="text-sm text-muted-foreground">Sesuai Permenkop UKM No. 2/2024</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "shrink-0 rounded-sm px-3 py-1.5 text-xs font-medium",
              tab === t.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "neraca" && <NeracaTab />}
      {tab === "arus-kas" && <ArusKasTab />}
      {tab === "laba-rugi" && <LabaRugiTab />}
      {tab === "shu" && <ShuDistribusiTab />}
      {tab === "calk" && <CalkTab />}
    </div>
  );
}
