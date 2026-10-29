import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { SavingConfigsTab } from "./SavingConfigsTab";
import { LoanConfigsTab } from "./LoanConfigsTab";
import { UnitsTab } from "./UnitsTab";
import { RolesTab } from "./RolesTab";
import { UsersTab } from "./UsersTab";
import { AccountsTab } from "./AccountsTab";
import { AccountMappingsTab } from "./AccountMappingsTab";
import { ShuConfigTab } from "./ShuConfigTab";
import { WhitelabelConfigTab } from "./WhitelabelConfigTab";
import { ModalDisetorConfigTab } from "./ModalDisetorConfigTab";
import { SelfRegistrationConfigTab } from "./SelfRegistrationConfigTab";
import { OperatingCalendarTab } from "./OperatingCalendarTab";
import { AuditTrailTab } from "./AuditTrailTab";
import { WorkspaceDomainSettings } from "@/features/workspace-domain/WorkspaceDomainSettings";

type GroupId = "koperasi" | "akuntansi" | "akses" | "tampilan";

const GROUP_LABEL: Record<GroupId, string> = {
  koperasi: "Koperasi",
  akuntansi: "Akuntansi",
  akses: "Akses dan keamanan",
  tampilan: "Tampilan dan alamat"
};
const GROUP_ORDER: readonly GroupId[] = ["koperasi", "akuntansi", "akses", "tampilan"];

/**
 * Pengaturan hub: the 14 former tabs as a side navigation grouped by purpose.
 * Each section's content (and its form) is exactly what the tab held before;
 * the active section lives in ?tab= so it can be linked and survives reload.
 */
export function ConfigPage() {
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();

  const sections = [
    { value: "savings", group: "koperasi" as const, label: "Simpanan", show: can("config", "read") || can("savings", "read"), content: <SavingConfigsTab /> },
    { value: "loans", group: "koperasi" as const, label: "Pinjaman", show: can("config", "read") || can("loans", "read"), content: <LoanConfigsTab /> },
    { value: "units", group: "koperasi" as const, label: "Unit koperasi", show: can("config", "read"), content: <UnitsTab /> },
    { value: "calendar", group: "koperasi" as const, label: "Hari libur", show: can("config", "read"), content: <OperatingCalendarTab /> },
    { value: "modal-disetor", group: "koperasi" as const, label: "Modal disetor", show: can("config", "read"), content: <ModalDisetorConfigTab /> },
    { value: "self-registration", group: "koperasi" as const, label: "Pendaftaran mandiri", show: can("config", "read"), content: <SelfRegistrationConfigTab /> },
    { value: "accounts", group: "akuntansi" as const, label: "Chart of Accounts", show: can("accounting", "read"), content: <AccountsTab /> },
    { value: "mappings", group: "akuntansi" as const, label: "Pemetaan akun", show: can("accounting", "read"), content: <AccountMappingsTab /> },
    { value: "shu", group: "akuntansi" as const, label: "Konfigurasi SHU", show: can("accounting", "read"), content: <ShuConfigTab /> },
    { value: "roles", group: "akses" as const, label: "Role dan izin", show: can("roles", "read"), content: <RolesTab /> },
    { value: "users", group: "akses" as const, label: "Pengguna", show: can("users", "read"), content: <UsersTab /> },
    { value: "audit-trail", group: "akses" as const, label: "Jejak audit", show: can("auditLog", "read"), content: <AuditTrailTab /> },
    { value: "whitelabel", group: "tampilan" as const, label: "Whitelabel", show: can("config", "read"), content: <WhitelabelConfigTab /> },
    { value: "workspace-domain", group: "tampilan" as const, label: "Alamat workspace", show: can("config", "read"), content: <WorkspaceDomainSettings /> }
  ].filter((s) => s.show);

  const requested = params.get("tab");
  const active = sections.find((s) => s.value === requested)?.value ?? sections[0]?.value ?? "";

  const select = (value: string) => {
    const copy = new URLSearchParams(params);
    copy.set("tab", value);
    setParams(copy, { replace: true });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Pengaturan" description="Simpanan, pinjaman, unit, akuntansi, akses pengguna, dan tampilan koperasi." />

      {sections.length === 0 ? (
        <EmptyState icon={Settings} title="Anda tidak memiliki akses ke pengaturan apa pun" description="Hubungi manajer jika Anda perlu mengubah pengaturan koperasi." />
      ) : (
        <Tabs value={active} onValueChange={select} orientation="vertical" className="grid items-start gap-5 min-[901px]:grid-cols-[220px_minmax(0,1fr)]">
          {/* Phone and tablet: one native picker instead of a long column. */}
          <div className="min-[901px]:hidden">
            <label htmlFor="config-section" className="mb-1.5 block text-[13px] font-bold">
              Bagian pengaturan
            </label>
            <select
              id="config-section"
              value={active}
              onChange={(e) => select(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {GROUP_ORDER.map((group) => {
                const items = sections.filter((s) => s.group === group);
                return items.length === 0 ? null : (
                  <optgroup key={group} label={GROUP_LABEL[group]}>
                    {items.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          <TabsList aria-label="Bagian pengaturan" className="hidden h-auto w-full flex-col items-stretch justify-start gap-0.5 bg-transparent p-0 min-[901px]:sticky min-[901px]:top-[84px] min-[901px]:flex">
            {GROUP_ORDER.map((group) => {
              const items = sections.filter((s) => s.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} role="presentation" className="flex flex-col gap-0.5 pb-3">
                  <p role="presentation" className="px-3 pb-1 text-xs font-bold text-muted-foreground">
                    {GROUP_LABEL[group]}
                  </p>
                  {items.map((s) => (
                    <TabsTrigger
                      key={s.value}
                      value={s.value}
                      className={cn(
                        "w-full justify-start rounded-[10px] px-3 py-2 text-left text-[13.5px] font-semibold text-foreground shadow-none transition-colors hover:bg-sidebar-active/70",
                        "data-[state=active]:bg-sidebar-active data-[state=active]:shadow-[inset_3px_0_0_hsl(var(--primary))]"
                      )}
                    >
                      {s.label}
                    </TabsTrigger>
                  ))}
                </div>
              );
            })}
          </TabsList>

          <div className="min-w-0">
            {sections.map((s) => (
              <TabsContent key={s.value} value={s.value} className="mt-0">
                {s.content}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      )}
    </div>
  );
}
