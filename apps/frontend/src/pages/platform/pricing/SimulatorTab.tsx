import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PricingCatalog, PricingQuote, PricingSelection } from "@siskop/types";
import { apiPost } from "@/api/client";
import { formatRupiahRinci } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { limitLabel } from "./pricingAdmin";
import { errorMessage, LIMIT_FIELDS, usePricingDraft } from "./pricingUi";
import { SelectionEditor } from "./SelectionEditor";

function Simulator({ catalog }: { catalog: PricingCatalog }) {
  const [source, setSource] = useState<"draft" | "published">("draft");
  const [selection, setSelection] = useState<PricingSelection>({
    packageCode: catalog.packages[0]?.code ?? "",
    billingCycle: catalog.settings.enabledCycles[0] ?? "MONTHLY",
    featureKeys: [],
    addons: []
  });

  const body = { ...selection, source, featureKeys: selection.featureKeys ?? [] };
  const quote = useQuery({
    queryKey: ["platform", "pricing", "quote", body],
    queryFn: () => apiPost<PricingQuote>("/platform/pricing/quote", body),
    enabled: selection.packageCode !== "",
    retry: false
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Coba kombinasi paket dan lihat harganya sebelum dipublikasikan.</p>
        <div className="flex items-center gap-2">
          <Label>Hitung dari</Label>
          <Select value={source} onValueChange={(v) => setSource(v as "draft" | "published")}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draf (belum publik)</SelectItem>
              <SelectItem value="published">Versi terpublikasi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <SelectionEditor catalog={catalog} value={selection} onChange={setSelection} />

      <div className="rounded-md border p-4">
        {quote.isPending && <p className="text-sm text-muted-foreground">Menghitung...</p>}
        {quote.isError && <p className="text-sm text-destructive">{errorMessage(quote.error)}</p>}
        {quote.data && (
          <div className="space-y-3">
            <Table>
              <TableBody>
                {quote.data.lines.map((l) => (
                  <TableRow key={`${l.kind}-${l.key}`}>
                    <TableCell>
                      <Badge variant="outline" className="mr-2">
                        {l.kind}
                      </Badge>
                      {l.label}
                    </TableCell>
                    <TableCell className="text-right">{formatRupiahRinci(l.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium">Tagihan per siklus</TableCell>
                  <TableCell className="text-right font-medium">{formatRupiahRinci(quote.data.amountPerCycle)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Dukungan tahunan</TableCell>
                  <TableCell className="text-right">{formatRupiahRinci(quote.data.supportYearly)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Subtotal faktur pertama</TableCell>
                  <TableCell className="text-right">{formatRupiahRinci(quote.data.subtotal)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>PPN {quote.data.taxRate === null ? "(tarif belum diisi)" : `${Number(quote.data.taxRate) * 100}%`}</TableCell>
                  <TableCell className="text-right">{formatRupiahRinci(quote.data.taxAmount)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold">{formatRupiahRinci(quote.data.total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              {LIMIT_FIELDS.map((f) => (
                <span key={f.key}>
                  {f.label}: <strong className="text-foreground">{limitLabel(quote.data.effectiveLimits[f.key])}</strong>
                </span>
              ))}
              <span>
                Fitur: <strong className="text-foreground">{quote.data.effectiveFeatures.length}</strong>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SimulatorTab() {
  const { data, isPending, isError } = usePricingDraft();
  if (isPending) return <p className="text-sm text-muted-foreground">Memuat...</p>;
  if (isError) return <p className="text-sm text-destructive">Gagal memuat draf harga.</p>;
  // Re-keyed on the package list so a freshly loaded draft resets the initial selection.
  return <Simulator key={data.catalog.packages.map((p) => p.code).join()} catalog={data.catalog} />;
}
