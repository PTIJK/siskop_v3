import { useQuery } from "@tanstack/react-query";
import type { PlatformTenantSummary } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { Label } from "@/components/ui/label";
import { HelpHint } from "@/components/shared/HelpHint";
import type { Destination } from "./destination";
import { TenantPicker } from "./TenantPicker";

interface Props {
  destination: Destination;
  tenantId: string | null;
  onChange: (destination: Destination, tenantId: string | null) => void;
  /** True while a (re)check is running, so the choice cannot change underneath it. */
  disabled?: boolean;
}

/** Where the verified data goes: a new koperasi from sheet 1, or a registered empty one found by search. */
export function DestinationCard({ destination, tenantId, onChange, disabled }: Props) {
  // Same query key as the Koperasi page, so the list is shared and cached.
  const tenants = useQuery({
    queryKey: ["platform", "tenants"],
    queryFn: () => apiFetch<PlatformTenantSummary[]>("/platform/tenants"),
    enabled: destination === "ada"
  });

  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-lg border bg-card p-5">
      <legend className="sr-only">Koperasi tujuan</legend>
      <p className="text-sm font-semibold">Koperasi tujuan</p>
      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="radio" name="destination" className="mt-1" checked={destination === "baru"} onChange={() => onChange("baru", null)} />
          <span className="flex items-center gap-1.5">
            <span className="font-medium">Koperasi baru</span>
            <HelpHint label="Bantuan: koperasi baru">Dibuat dari sheet 1_Koperasi, termasuk akun admin pertamanya.</HelpHint>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="radio" name="destination" className="mt-1" checked={destination === "ada"} onChange={() => onChange("ada", tenantId)} />
          <span className="flex items-center gap-1.5">
            <span className="font-medium">Koperasi yang sudah terdaftar</span>
            <HelpHint label="Bantuan: koperasi yang sudah terdaftar">
              Data dimuat ke koperasi yang masih kosong (belum ada anggota, simpanan, pinjaman, atau jurnal). Subdomain di file harus sama.
            </HelpHint>
          </span>
        </label>
      </div>
      {destination === "ada" && (
        <div className="space-y-1.5 pl-6">
          <Label htmlFor="tenantPicker">Cari koperasi</Label>
          <TenantPicker
            inputId="tenantPicker"
            tenants={tenants.data?.map((t) => ({ id: t.id, name: t.name, slug: t.slug, registrationNo: t.registrationNo, isActive: t.isActive }))}
            selectedId={tenantId}
            onSelect={(t) => onChange("ada", t.id)}
            onClear={() => onChange("ada", null)}
            loading={tenants.isPending}
            error={tenants.isError ? "Daftar koperasi gagal dimuat" : undefined}
          />
        </div>
      )}
    </fieldset>
  );
}
