import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePermissions } from "@/hooks/usePermissions";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { DepositWithdrawFlow } from "./DepositWithdrawFlow";
import { OpenAccountForm } from "./OpenAccountForm";

type Tab = "transaksi" | "buka";

const TABS: { value: Tab; label: string }[] = [
  { value: "transaksi", label: "Setor dan tarik" },
  { value: "buka", label: "Buka rekening" }
];

/**
 * /savings/new hosts both teller jobs: posting a deposit or withdrawal (default)
 * and opening a new account (?mode=buka, which is what the old page did).
 */
export function NewSavingPage() {
  const [params, setParams] = useSearchParams();
  const { can } = usePermissions();
  const tab: Tab = params.get("mode") === "buka" ? "buka" : "transaksi";

  const select = (next: Tab) => {
    const copy = new URLSearchParams(params);
    if (next === "buka") copy.set("mode", "buka");
    else copy.delete("mode");
    setParams(copy, { replace: true });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={tab === "buka" ? "Buka rekening simpanan" : "Setor dan tarik"}
        description={
          tab === "buka"
            ? "Buat rekening simpanan baru untuk seorang anggota."
            : "Pilih anggota, isi nominal, tinjau, lalu posting. Struk muncul setelahnya."
        }
        breadcrumb={[{ label: "Simpanan", href: "/savings" }, { label: tab === "buka" ? "Buka rekening" : "Setor dan tarik" }]}
      />

      {!can("savings", "create") ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Lock}
              title="Peran Anda hanya bisa melihat simpanan"
              description="Mencatat setoran, penarikan, dan membuka rekening membutuhkan izin simpanan. Hubungi manajer jika Anda perlu akses ini."
            />
          </CardContent>
        </Card>
      ) : (
        <>
        <div role="tablist" aria-label="Pekerjaan simpanan" className="inline-flex rounded-[11px] bg-muted p-[3px]">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`tab-${t.value}`}
              aria-selected={tab === t.value}
              aria-controls="simpanan-panel"
              onClick={() => select(t.value)}
              className="min-h-[38px] rounded-[8px] px-5 text-[13.5px] font-bold text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-sm max-[900px]:min-h-11"
            >
              {t.label}
            </button>
          ))}
        </div>

      <div id="simpanan-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "buka" ? <OpenAccountForm /> : <DepositWithdrawFlow />}
      </div>
        </>
      )}
    </div>
  );
}
