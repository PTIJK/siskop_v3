import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { SavingConfigsTab } from "./SavingConfigsTab";
import { LoanConfigsTab } from "./LoanConfigsTab";
import { UnitsTab } from "./UnitsTab";
import { RolesTab } from "./RolesTab";
import { UsersTab } from "./UsersTab";
import { AccountsTab } from "./AccountsTab";
import { AccountMappingsTab } from "./AccountMappingsTab";
import { ShuConfigTab } from "./ShuConfigTab";

export function ConfigPage() {
  const { can } = usePermissions();

  const tabs = [
    { value: "savings", label: "Simpanan", show: can("config", "read") || can("savings", "read"), content: <SavingConfigsTab /> },
    { value: "loans", label: "Pinjaman", show: can("config", "read") || can("loans", "read"), content: <LoanConfigsTab /> },
    { value: "units", label: "Unit Koperasi", show: can("config", "read"), content: <UnitsTab /> },
    { value: "roles", label: "Role & Izin", show: can("roles", "read"), content: <RolesTab /> },
    { value: "users", label: "Pengguna", show: can("users", "read"), content: <UsersTab /> },
    { value: "accounts", label: "Chart of Accounts", show: can("accounting", "read"), content: <AccountsTab /> },
    { value: "mappings", label: "Pemetaan Akun", show: can("accounting", "read"), content: <AccountMappingsTab /> },
    { value: "shu", label: "Konfigurasi SHU", show: can("accounting", "read"), content: <ShuConfigTab /> }
  ].filter((t) => t.show);

  return (
    <div className="space-y-6">
      <PageHeader title="Konfigurasi" description="Pengaturan simpanan, pinjaman, unit, role, dan akuntansi koperasi" />

      {tabs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Anda tidak memiliki akses ke pengaturan apa pun.</p>
      ) : (
        <Tabs defaultValue={tabs[0]?.value ?? ""}>
          <TabsList className="flex-wrap">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.value} value={t.value}>
              {t.content}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
