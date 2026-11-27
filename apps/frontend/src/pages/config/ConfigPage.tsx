import { useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { ChevronDown, ChevronRight, Landmark, Monitor, Settings, ShieldCheck, Wallet } from "lucide-react";
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

const GROUPS = {
  koperasi: { label: "Operasional koperasi", icon: Landmark },
  akuntansi: { label: "Pembukuan", icon: Wallet },
  akses: { label: "Akses dan keamanan", icon: ShieldCheck },
  tampilan: { label: "Tampilan dan alamat", icon: Monitor }
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
  const [savingActions, setSavingActions] = useState<HTMLDivElement | null>(null);
  const setup = useOutletContext<{ tab: string; refreshSetup: () => Promise<void> } | undefined>();

  const sections = [
    { value: "savings", group: "koperasi" as const, label: "Simpanan", show: can("config", "read") || can("savings", "read"), content: <SavingConfigsTab actionsTarget={savingActions} onSetupSaved={setup?.tab === "savings" ? setup.refreshSetup : undefined} /> },
    { value: "loans", group: "koperasi" as const, label: "Pinjaman", show: can("config", "read") || can("loans", "read"), content: <LoanConfigsTab onSetupSaved={setup?.tab === "loans" ? setup.refreshSetup : undefined} /> },
    { value: "units", group: "koperasi" as const, label: "Unit koperasi", show: can("config", "read"), content: <UnitsTab /> },
    { value: "calendar", group: "koperasi" as const, label: "Hari libur", show: can("config", "read"), content: <OperatingCalendarTab /> },
    { value: "modal-disetor", group: "koperasi" as const, label: "Modal disetor", show: can("config", "read"), content: <ModalDisetorConfigTab onSetupSaved={setup?.tab === "modal-disetor" ? setup.refreshSetup : undefined} /> },
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
      <PageHeader
        title="Pengaturan"
        description="Kelola operasional, pembukuan, dan akses workspace koperasi."
        actions={active === "savings" && can("config", "update") ? <div ref={setSavingActions} /> : undefined}
      />

      {sections.length === 0 ? (
        <EmptyState icon={Settings} title="Anda tidak memiliki akses ke pengaturan apa pun" description="Hubungi manajer jika Anda perlu mengubah pengaturan koperasi." />
      ) : (
        <Tabs value={active} onValueChange={select} orientation="vertical" activationMode="manual" className="grid items-start gap-4 min-[1080px]:grid-cols-[240px_minmax(0,1fr)] min-[1080px]:gap-6">
          <div className="min-[1080px]:hidden">
            <label htmlFor="config-section" className="mb-1.5 block text-[13px] font-bold">
              Bagian pengaturan
            </label>
            <div className="relative">
              <select
                id="config-section"
                data-setup-target={setup ? "tab-select" : undefined}
                value={active}
                onChange={(e) => select(e.target.value)}
                className={cn("h-11 w-full appearance-none rounded-lg border border-input bg-card pl-3 pr-10 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  setup && active !== setup.tab && "ring-2 ring-primary")}
              >
                {GROUP_ORDER.map((group) => {
                  const items = sections.filter((s) => s.group === group);
                  return items.length === 0 ? null : (
                    <optgroup key={group} label={GROUPS[group].label}>
                      {items.map((s) => (
                        <option key={s.value} value={s.value} disabled={Boolean(setup && s.value !== setup.tab)}>
                          {s.label}{setup?.tab === s.value ? " (panduan)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>

          <TabsList aria-label="Bagian pengaturan" className="hidden h-auto max-h-[calc(100dvh-106px)] w-full flex-col items-stretch justify-start gap-3 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-2.5 min-[1080px]:sticky min-[1080px]:top-[84px] min-[1080px]:flex">
            {GROUP_ORDER.map((group) => {
              const items = sections.filter((s) => s.group === group);
              if (items.length === 0) return null;
              const { icon: Icon, label } = GROUPS[group];
              return (
                <div key={group} role="group" aria-label={label} className="flex shrink-0 flex-col gap-0.5 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div aria-hidden="true" className="flex items-center gap-2 px-2.5 pb-1.5 pt-1 text-xs font-bold text-muted-foreground">
                    <Icon className="size-4" />
                    {label}
                  </div>
                  {items.map((s) => (
                    <TabsTrigger
                      key={s.value}
                      value={s.value}
                      data-setup-target={setup?.tab === s.value ? "tab" : undefined}
                      className={cn(
                        "group w-full justify-between gap-2 whitespace-normal rounded-lg px-2.5 py-2 text-left font-semibold shadow-none hover:bg-muted",
                        "data-[state=active]:bg-accent data-[state=active]:font-bold data-[state=active]:text-accent-foreground data-[state=active]:shadow-none",
                        setup?.tab === s.value && "bg-accent text-accent-foreground ring-2 ring-inset ring-primary"
                      )}
                    >
                      <span>{s.label}</span>
                      <ChevronRight className="size-4 shrink-0 opacity-0 group-data-[state=active]:opacity-100" aria-hidden="true" />
                    </TabsTrigger>
                  ))}
                </div>
              );
            })}
          </TabsList>

          <div className="min-w-0">
            {sections.map((s) => (
              <TabsContent key={s.value} value={s.value} aria-label={s.label} className="mt-0">
                {s.content}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      )}
    </div>
  );
}
