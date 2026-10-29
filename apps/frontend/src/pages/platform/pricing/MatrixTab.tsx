import { useMemo, useRef, useState } from "react";
import type { PricingCatalogFeature } from "@siskop/types";
import { apiFetch, apiPost, apiPut } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import { buildFeatureRows, toggleFeature } from "./pricingAdmin";
import { errorMessage, MoneyInput, usePricingDraft, useRefreshPricing } from "./pricingUi";

function FeatureDialog({ feature, onClose }: { feature: PricingCatalogFeature; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefreshPricing();
  const [name, setName] = useState(feature.name);
  const [price, setPrice] = useState<string | null>(feature.customPrice);
  const [group, setGroup] = useState(feature.priceGroup ?? "");
  const [isActive, setIsActive] = useState(feature.isActive);
  const [error, setError] = useState("");

  const save = async () => {
    if (price === null) {
      setError("Harga Custom tidak valid. Isi 0 jika gratis.");
      return;
    }
    try {
      await apiPut(`/platform/pricing/features/${feature.key}`, { name, customPrice: price, priceGroup: group.trim() === "" ? null : group.trim(), isActive });
      toast({ title: "Fitur disimpan ke draf" });
      await refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ubah fitur {feature.key}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="ft-name">Nama</Label>
            <Input id="ft-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ft-price">Harga di paket Custom (Rp per bulan, 0 = gratis)</Label>
            <MoneyInput id="ft-price" value={feature.customPrice} onChange={setPrice} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ft-group">Grup harga</Label>
            <Input id="ft-group" value={group} placeholder="Kosong = dihitung sendiri" onChange={(e) => setGroup(e.target.value)} />
            <p className="text-xs text-muted-foreground">Fitur dengan grup yang sama hanya dikenai harga sekali.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isActive} onCheckedChange={(c) => setIsActive(c === true)} />
            Aktif
          </label>
          <p className="text-xs text-muted-foreground">
            Induk: {feature.parentKey ?? "-"}. Syarat: {feature.requires.length > 0 ? feature.requires.join(", ") : "-"}. Diubah lewat impor berkas.
          </p>
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button onClick={() => void save()}>Simpan ke draf</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MatrixTab() {
  const { data, isPending, isError } = usePricingDraft();
  const { toast } = useToast();
  const refresh = useRefreshPricing();
  const fileRef = useRef<HTMLInputElement>(null);
  /** Unsaved matrix edits: package code -> its feature keys. */
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<PricingCatalogFeature | null>(null);
  const [error, setError] = useState("");

  const rows = useMemo(() => (data ? buildFeatureRows(data.catalog.features) : []), [data]);

  if (isPending) return <p className="text-sm text-muted-foreground">Memuat...</p>;
  if (isError) return <p className="text-sm text-destructive">Gagal memuat draf harga.</p>;

  const fixed = data.catalog.packages.filter((p) => !p.isCustom);
  const keysOf = (code: string) => pending[code] ?? fixed.find((p) => p.code === code)?.features ?? [];
  const dirty = Object.keys(pending).length > 0;

  const toggle = (code: string, key: string, on: boolean) => {
    const pkg = fixed.find((p) => p.code === code);
    if (!pkg) return;
    setPending({ ...pending, [code]: toggleFeature({ ...pkg, features: keysOf(code) }, key, on, data.catalog.features) });
  };

  const saveMatrix = async () => {
    setError("");
    try {
      await apiPut("/platform/pricing/matrix", pending);
      toast({ title: "Matriks disimpan ke draf" });
      setPending({});
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const exportFile = async () => {
    const seed = await apiFetch<unknown>("/platform/pricing/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(seed, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "pricing.seed.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    setError("");
    try {
      await apiPost("/platform/pricing/import", JSON.parse(await file.text()));
      toast({ title: "Berkas diimpor ke draf", description: "Periksa perubahan di tab Publikasi sebelum dipublikasikan." });
      setPending({});
      await refresh();
    } catch (err) {
      setError(err instanceof SyntaxError ? "Berkas bukan JSON yang valid." : errorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Centang fitur yang termasuk di tiap paket. Memilih fitur otomatis ikut memilih induk dan syaratnya; melepas fitur melepas turunannya.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void exportFile()}>
            Ekspor JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            Impor JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" disabled={!dirty} onClick={() => void saveMatrix()}>
            Simpan matriks
          </Button>
        </div>
      </div>
      <FormError error={error} />
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Fitur</TableHead>
              {fixed.map((p) => (
                <TableHead key={p.code} className="text-center">
                  {p.name}
                </TableHead>
              ))}
              <TableHead>Harga Custom / bulan</TableHead>
              <TableHead>Syarat</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ feature, depth }) => (
              <TableRow key={feature.key} className={feature.isActive ? undefined : "opacity-50"}>
                <TableCell style={{ paddingLeft: `${depth * 20 + 16}px` }}>
                  <span className="font-medium">{feature.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{feature.key}</span>
                  {feature.priceGroup && (
                    <Badge variant="outline" className="ml-2">
                      grup: {feature.priceGroup}
                    </Badge>
                  )}
                </TableCell>
                {fixed.map((p) => (
                  <TableCell key={p.code} className="text-center">
                    <Checkbox
                      aria-label={`${feature.name} di ${p.name}`}
                      checked={keysOf(p.code).includes(feature.key)}
                      onCheckedChange={(c) => toggle(p.code, feature.key, c === true)}
                    />
                  </TableCell>
                ))}
                <TableCell>{Number(feature.customPrice) === 0 ? <span className="text-muted-foreground">Gratis</span> : formatRupiah(feature.customPrice)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{feature.requires.join(", ") || "-"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(feature)}>
                    Ubah
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && <FeatureDialog key={editing.key} feature={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
