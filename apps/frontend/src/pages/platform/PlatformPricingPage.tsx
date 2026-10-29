import { Navigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddonsTab, SupportTab } from "./pricing/AddonsSupportTabs";
import { MatrixTab } from "./pricing/MatrixTab";
import { PackagesTab } from "./pricing/PackagesTab";
import { usePricingDraft } from "./pricing/pricingUi";
import { PublishTab } from "./pricing/PublishTab";
import { RulesTab } from "./pricing/RulesTab";
import { SimulatorTab } from "./pricing/SimulatorTab";

const TABS = [
  { value: "packages", label: "Paket", content: <PackagesTab /> },
  { value: "matrix", label: "Matriks Fitur", content: <MatrixTab /> },
  { value: "addons", label: "Add-on Volume", content: <AddonsTab /> },
  { value: "support", label: "Paket Dukungan", content: <SupportTab /> },
  { value: "rules", label: "Aturan", content: <RulesTab /> },
  { value: "simulator", label: "Simulator", content: <SimulatorTab /> },
  { value: "publish", label: "Publikasi & Riwayat", content: <PublishTab /> }
];

export function PlatformPricingPage() {
  const role = useAuth((s) => s.user?.role);
  const { data } = usePricingDraft();

  if (role !== "super_admin") return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Harga & Paket"
        description="Atur paket, matriks fitur, add-on, dan aturan harga. Perubahan masuk draf dulu, baru berlaku setelah dipublikasikan."
        actions={
          data && (
            <div className="flex items-center gap-2">
              <Badge variant="outline">{data.publishedVersion === null ? "Belum dipublikasikan" : `Berlaku: v${data.publishedVersion}`}</Badge>
              {data.changeCount > 0 && <Badge>{data.changeCount} perubahan di draf</Badge>}
            </div>
          )
        }
      />
      <Tabs defaultValue="packages">
        <TabsList className="h-auto flex-wrap justify-start">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            {t.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
