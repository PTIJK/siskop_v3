import { useState } from "react";
import type { PricingCatalog } from "@siskop/types";
import { apiPut } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage, MoneyInput, usePricingDraft, useRefreshPricing } from "./pricingUi";

const ITEM_LABEL: Record<string, string> = {
  MEMBERS: "Anggota",
  USERS: "Pengguna",
  SAVING_TYPES: "Jenis simpanan",
  LOAN_TYPES: "Jenis pinjaman"
};

type Addon = PricingCatalog["volumeAddons"][number];
type Plan = PricingCatalog["supportPlans"][number];

function AddonsForm({ initial }: { initial: Addon[] }) {
  const { toast } = useToast();
  const refresh = useRefreshPricing();
  const [rows, setRows] = useState<(Omit<Addon, "price"> & { price: string | null })[]>(initial);
  const [error, setError] = useState("");

  const patch = (i: number, p: Partial<Omit<Addon, "price"> & { price: string | null }>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const save = async () => {
    if (rows.some((r) => r.price === null || r.stepQty < 1)) {
      setError("Periksa harga dan jumlah per langkah.");
      return;
    }
    setError("");
    try {
      await apiPut("/platform/pricing/addons", rows);
      toast({ title: "Add-on disimpan ke draf" });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Tarif add-on volume. Harga per tahun dibayar per langkah; tenant yang ditagih bulanan membayar 1/12 per bulan.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Jumlah per langkah</TableHead>
              <TableHead>Harga per langkah (Rp)</TableHead>
              <TableHead>Periode harga</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.itemKey}>
                <TableCell className="font-medium">{ITEM_LABEL[r.itemKey] ?? r.itemKey}</TableCell>
                <TableCell>
                  <Input type="number" min={1} className="w-28" value={r.stepQty} onChange={(e) => patch(i, { stepQty: Math.max(1, Math.floor(Number(e.target.value))) })} />
                </TableCell>
                <TableCell>
                  <MoneyInput value={r.price} onChange={(v) => patch(i, { price: v })} />
                </TableCell>
                <TableCell>
                  <Select value={r.period} onValueChange={(v) => patch(i, { period: v as Addon["period"] })}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="YEARLY">Tahunan</SelectItem>
                      <SelectItem value="MONTHLY">Bulanan</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormError error={error} />
      <Button onClick={() => void save()}>Simpan ke draf</Button>
    </div>
  );
}

export function AddonsTab() {
  const { data, isPending, isError } = usePricingDraft();
  if (isPending) return <p className="text-sm text-muted-foreground">Memuat...</p>;
  if (isError) return <p className="text-sm text-destructive">Gagal memuat draf harga.</p>;
  return <AddonsForm initial={data.catalog.volumeAddons} />;
}

function SupportForm({ initial }: { initial: Plan[] }) {
  const { toast } = useToast();
  const refresh = useRefreshPricing();
  const [rows, setRows] = useState<(Omit<Plan, "yearlyCost"> & { yearlyCost: string | null })[]>(initial);
  const [error, setError] = useState("");

  const patch = (i: number, p: Partial<Omit<Plan, "yearlyCost"> & { yearlyCost: string | null }>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const save = async () => {
    if (rows.some((r) => r.yearlyCost === null)) {
      setError("Periksa biaya tahunan.");
      return;
    }
    setError("");
    try {
      await apiPut("/platform/pricing/support-plans", rows);
      toast({ title: "Paket dukungan disimpan ke draf" });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Paket dukungan hanya tahunan dan bisa dipilih di paket apa pun. Kunjungan dan SLA dicatat, tidak ditegakkan oleh sistem.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Biaya / tahun (Rp)</TableHead>
              <TableHead>Remote</TableHead>
              <TableHead>On-site</TableHead>
              <TableHead>Kunjungan / tahun</TableHead>
              <TableHead>SLA (jam)</TableHead>
              <TableHead>AI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.code}>
                <TableCell className="font-medium">{r.code}</TableCell>
                <TableCell>
                  <Input className="w-28" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} />
                </TableCell>
                <TableCell>
                  <MoneyInput value={r.yearlyCost} onChange={(v) => patch(i, { yearlyCost: v })} />
                </TableCell>
                <TableCell>
                  <Checkbox aria-label={`${r.code} remote`} checked={r.remote} onCheckedChange={(c) => patch(i, { remote: c === true })} />
                </TableCell>
                <TableCell>
                  <Checkbox aria-label={`${r.code} on-site`} checked={r.onsite} onCheckedChange={(c) => patch(i, { onsite: c === true })} />
                </TableCell>
                <TableCell>
                  <Input type="number" min={0} className="w-24" value={r.visitsPerYear} onChange={(e) => patch(i, { visitsPerYear: Math.max(0, Math.floor(Number(e.target.value))) })} />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    className="w-24"
                    placeholder="-"
                    value={r.slaHours ?? ""}
                    onChange={(e) => patch(i, { slaHours: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                  />
                </TableCell>
                <TableCell>
                  <Checkbox aria-label={`${r.code} AI`} checked={r.aiSupport} onCheckedChange={(c) => patch(i, { aiSupport: c === true })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FormError error={error} />
      <Button onClick={() => void save()}>Simpan ke draf</Button>
    </div>
  );
}

export function SupportTab() {
  const { data, isPending, isError } = usePricingDraft();
  if (isPending) return <p className="text-sm text-muted-foreground">Memuat...</p>;
  if (isError) return <p className="text-sm text-destructive">Gagal memuat draf harga.</p>;
  return <SupportForm initial={data.catalog.supportPlans} />;
}
