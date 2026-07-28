import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NeracaTab } from "./regulatory/NeracaTab";
import { ArusKasTab } from "./regulatory/ArusKasTab";
import { LabaRugiTab } from "./regulatory/LabaRugiTab";
import { ShuDistribusiTab } from "./regulatory/ShuDistribusiTab";
import { CalkTab } from "./regulatory/CalkTab";

export function RegulatoryReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan Regulasi"
        description="Laporan keuangan sesuai Permenkop UKM No. 2/2024 — Neraca, Arus Kas, Laporan Hasil Usaha, Pembagian SHU, dan CALK"
      />

      <Tabs defaultValue="neraca">
        <TabsList className="flex-wrap">
          <TabsTrigger value="neraca">Neraca</TabsTrigger>
          <TabsTrigger value="arus-kas">Arus Kas</TabsTrigger>
          <TabsTrigger value="laba-rugi">Hasil Usaha</TabsTrigger>
          <TabsTrigger value="shu">Pembagian SHU</TabsTrigger>
          <TabsTrigger value="calk">CALK</TabsTrigger>
        </TabsList>

        <TabsContent value="neraca" className="mt-4">
          <NeracaTab />
        </TabsContent>
        <TabsContent value="arus-kas" className="mt-4">
          <ArusKasTab />
        </TabsContent>
        <TabsContent value="laba-rugi" className="mt-4">
          <LabaRugiTab />
        </TabsContent>
        <TabsContent value="shu" className="mt-4">
          <ShuDistribusiTab />
        </TabsContent>
        <TabsContent value="calk" className="mt-4">
          <CalkTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
