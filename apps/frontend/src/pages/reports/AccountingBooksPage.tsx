import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BukuBesarTab } from "./accounting/BukuBesarTab";
import { JurnalTab } from "./accounting/JurnalTab";
import { parseDrilldown } from "./accounting/drilldown";
import { NeracaSaldoTab } from "./accounting/NeracaSaldoTab";

const TABS = ["jurnal-umum", "jurnal-penyesuaian", "neraca-saldo", "buku-besar"];

export function AccountingBooksPage() {
  // The tab and a drill-down target live in the URL so a statement row can link straight to an account's ledger.
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get("tab") ?? "") ? params.get("tab")! : "jurnal-umum";
  const drilldown = tab === "buku-besar" ? parseDrilldown(params) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buku Akuntansi"
        description="Jurnal Umum, Jurnal Penyesuaian, Neraca Saldo, dan Buku Besar langsung dari buku besar koperasi"
      />

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value }, { replace: true })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="jurnal-umum">Jurnal Umum</TabsTrigger>
          <TabsTrigger value="jurnal-penyesuaian">Jurnal Penyesuaian</TabsTrigger>
          <TabsTrigger value="neraca-saldo">Neraca Saldo</TabsTrigger>
          <TabsTrigger value="buku-besar">Buku Besar</TabsTrigger>
        </TabsList>

        <TabsContent value="jurnal-umum" className="mt-4">
          <JurnalTab kind="umum" />
        </TabsContent>
        <TabsContent value="jurnal-penyesuaian" className="mt-4">
          <JurnalTab kind="penyesuaian" />
        </TabsContent>
        <TabsContent value="neraca-saldo" className="mt-4">
          <NeracaSaldoTab />
        </TabsContent>
        <TabsContent value="buku-besar" className="mt-4">
          <BukuBesarTab key={drilldown?.accountId ?? "overview"} initial={drilldown} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
