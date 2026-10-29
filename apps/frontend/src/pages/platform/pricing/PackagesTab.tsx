import { useState } from "react";
import type { PricingCatalogPackage, PricingLimits } from "@siskop/types";
import { apiPut } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { formatRupiah } from "@/lib/format";
import { FormError } from "@/components/shared/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { limitLabel } from "./pricingAdmin";
import { errorMessage, LIMIT_FIELDS, LimitInput, MoneyInput, usePricingDraft, useRefreshPricing } from "./pricingUi";

function PackageDialog({ pkg, onClose }: { pkg: PricingCatalogPackage; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefreshPricing();
  const [name, setName] = useState(pkg.name);
  const [isPublic, setIsPublic] = useState(pkg.isPublic);
  const [sortOrder, setSortOrder] = useState(pkg.sortOrder);
  const [monthly, setMonthly] = useState<string | null>(pkg.priceMonthly);
  const [yearly, setYearly] = useState<string | null>(pkg.priceYearly);
  const [limits, setLimits] = useState<PricingLimits>(pkg.limits);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError("");
    if (!pkg.isCustom && monthly !== null && yearly === null) {
      setError("Isi harga tahunan jika harga bulanan diisi.");
      return;
    }
    setSaving(true);
    try {
      await apiPut(`/platform/pricing/packages/${pkg.code}`, {
        name,
        isPublic,
        sortOrder,
        ...(pkg.isCustom ? {} : { priceMonthly: monthly, priceYearly: yearly, limits })
      });
      toast({ title: "Paket disimpan ke draf" });
      await refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Ubah paket {pkg.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pkg-name">Nama</Label>
              <Input id="pkg-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pkg-sort">Urutan</Label>
              <Input id="pkg-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isPublic} onCheckedChange={(c) => setIsPublic(c === true)} />
            Tampil di halaman pendaftaran
          </label>

          {pkg.isCustom ? (
            <p className="text-sm text-muted-foreground">
              Custom tidak punya harga dasar: harganya jumlah fitur yang dipilih ditambah add-on. Batas dasarnya diatur di tab Aturan.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="pkg-monthly">Harga per bulan (Rp, tanpa PPN)</Label>
                  <MoneyInput id="pkg-monthly" value={monthly} onChange={setMonthly} placeholder="Kosong = gratis" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pkg-yearly">Harga per tahun (Rp, tanpa PPN)</Label>
                  <MoneyInput id="pkg-yearly" value={yearly} onChange={setYearly} placeholder="Kosong = gratis" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {LIMIT_FIELDS.map((f) => (
                  <LimitInput key={f.key} label={f.label} value={limits[f.key]} onChange={(v) => setLimits({ ...limits, [f.key]: v })} />
                ))}
              </div>
            </>
          )}
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan ke draf"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PackagesTab() {
  const { data, isPending, isError } = usePricingDraft();
  const [editing, setEditing] = useState<PricingCatalogPackage | null>(null);

  if (isPending) return <p className="text-sm text-muted-foreground">Memuat...</p>;
  if (isError) return <p className="text-sm text-destructive">Gagal memuat draf harga.</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Perubahan disimpan ke draf dan baru berlaku setelah dipublikasikan di tab Publikasi.</p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paket</TableHead>
              <TableHead>Bulanan</TableHead>
              <TableHead>Tahunan</TableHead>
              <TableHead>Anggota</TableHead>
              <TableHead>Pengguna</TableHead>
              <TableHead>Simpanan</TableHead>
              <TableHead>Pinjaman</TableHead>
              <TableHead>Tampil</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.catalog.packages.map((p) => (
              <TableRow key={p.code}>
                <TableCell className="font-medium">
                  {p.name} {p.isCustom && <Badge variant="outline">Custom</Badge>}
                </TableCell>
                {p.isCustom ? (
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Harga per fitur; batas dasar di tab Aturan
                  </TableCell>
                ) : (
                  <>
                    <TableCell>{p.priceMonthly === null ? "Gratis" : formatRupiah(p.priceMonthly)}</TableCell>
                    <TableCell>{p.priceYearly === null ? "Gratis" : formatRupiah(p.priceYearly)}</TableCell>
                    <TableCell>{limitLabel(p.limits.members)}</TableCell>
                    <TableCell>{limitLabel(p.limits.users)}</TableCell>
                    <TableCell>{limitLabel(p.limits.savingTypes)}</TableCell>
                    <TableCell>{limitLabel(p.limits.loanTypes)}</TableCell>
                  </>
                )}
                <TableCell>
                  <Badge variant={p.isPublic ? "default" : "secondary"}>{p.isPublic ? "Ya" : "Tersembunyi"}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                    Ubah
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && <PackageDialog key={editing.code} pkg={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
