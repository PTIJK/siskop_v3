import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BukuBesarTab } from "./accounting/BukuBesarTab";
import { JurnalTab } from "./accounting/JurnalTab";
import { NeracaSaldoTab } from "./accounting/NeracaSaldoTab";

export function AccountingBooksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Buku Akuntansi"
        description="Jurnal Umum, Jurnal Penyesuaian, Neraca Saldo, dan Buku Besar langsung dari buku besar koperasi"
      />

      <Tabs defaultValue="jurnal-umum">
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
          <BukuBesarTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
