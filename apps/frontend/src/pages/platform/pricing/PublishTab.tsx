import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PricingAuditEntry, PricingDiff, PricingVersionSummary } from "@siskop/types";
import { apiFetch, apiPost } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { formatTanggalIndonesia } from "@/lib/format";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describeChange } from "./pricingAdmin";
import { errorMessage, usePricingDraft, useRefreshPricing } from "./pricingUi";

export function PublishTab() {
  const { toast } = useToast();
  const refresh = useRefreshPricing();
  const draft = usePricingDraft();
  const diff = useQuery({ queryKey: ["platform", "pricing", "diff"], queryFn: () => apiFetch<PricingDiff>("/platform/pricing/diff") });
  const versions = useQuery({ queryKey: ["platform", "pricing", "versions"], queryFn: () => apiFetch<PricingVersionSummary[]>("/platform/pricing/versions") });
  const audit = useQuery({ queryKey: ["platform", "pricing", "audit"], queryFn: () => apiFetch<PricingAuditEntry[]>("/platform/pricing/audit?limit=30") });

  const [note, setNote] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [rollbackTo, setRollbackTo] = useState<number | null>(null);
  const [error, setError] = useState("");

  const changes = diff.data?.changes ?? [];
  const noPublishedYet = draft.data?.publishedVersion === null;

  const doPublish = async () => {
    setError("");
    try {
      const res = await apiPost<{ version: number }>("/platform/pricing/publish", note.trim() === "" ? {} : { note: note.trim() });
      toast({ title: `Versi ${res.version} dipublikasikan`, description: "Tenant yang sudah berlangganan tidak terpengaruh." });
      setNote("");
      setConfirmPublish(false);
      await refresh();
    } catch (err) {
      setConfirmPublish(false);
      setError(errorMessage(err));
    }
  };

  const doRollback = async () => {
    if (rollbackTo === null) return;
    setError("");
    try {
      const res = await apiPost<{ version: number }>("/platform/pricing/rollback", { version: rollbackTo });
      toast({ title: `Versi ${rollbackTo} dipulihkan sebagai versi ${res.version}` });
      setRollbackTo(null);
      await refresh();
    } catch (err) {
      setRollbackTo(null);
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold">Perubahan belum dipublikasikan</h3>
          <Badge variant={changes.length > 0 ? "default" : "secondary"}>{changes.length}</Badge>
        </div>
        {diff.isPending ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {noPublishedYet ? "Belum ada versi yang dipublikasikan." : "Draf sama dengan versi yang sedang berlaku."}
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {changes.map((c) => (
              <li key={`${c.section}-${c.key}`}>{describeChange(c)}</li>
            ))}
          </ul>
        )}
        <div className="flex max-w-xl items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="pub-note">Catatan (opsional)</Label>
            <Input id="pub-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="mis. Naik harga Small" />
          </div>
          <Button disabled={changes.length === 0 && !noPublishedYet} onClick={() => setConfirmPublish(true)}>
            Publikasikan
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Versi baru dipakai halaman pendaftaran dan langganan baru. Langganan yang sudah berjalan tetap memakai versinya.
        </p>
        <FormError error={error} />
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Riwayat versi</h3>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versi</TableHead>
                <TableHead>Dipublikasikan</TableHead>
                <TableHead>Oleh</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(versions.data ?? []).map((v, i) => (
                <TableRow key={v.version}>
                  <TableCell className="font-medium">
                    v{v.version} {i === 0 && <Badge className="ml-2">Berlaku</Badge>}
                  </TableCell>
                  <TableCell>{formatTanggalIndonesia(v.publishedAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.publishedBy ?? "-"}</TableCell>
                  <TableCell className="text-right">
                    {i > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setRollbackTo(v.version)}>
                        Pulihkan
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Jejak perubahan</h3>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Objek</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Oleh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(audit.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap">{formatTanggalIndonesia(a.at)}</TableCell>
                  <TableCell>
                    {a.entity}
                    {a.entityId ? ` · ${a.entityId}` : ""}
                  </TableCell>
                  <TableCell>{a.action}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.actorId ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title="Publikasikan perubahan harga?"
        description={`${changes.length} perubahan akan berlaku untuk pendaftaran dan langganan baru. Langganan yang sudah berjalan tidak berubah.`}
        confirmLabel="Publikasikan"
        onConfirm={doPublish}
      />
      <ConfirmDialog
        open={rollbackTo !== null}
        onOpenChange={(open) => !open && setRollbackTo(null)}
        title={`Pulihkan versi ${rollbackTo ?? ""}?`}
        description="Draf diganti dengan isi versi itu dan langsung dipublikasikan sebagai versi baru. Riwayat tidak dihapus."
        confirmLabel="Pulihkan"
        variant="destructive"
        onConfirm={doRollback}
      />
    </div>
  );
}
