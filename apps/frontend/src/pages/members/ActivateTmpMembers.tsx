import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/api/client";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Result = { activated: number; needsMatch: number };

export function ActivateTmpMembers({ count }: { count: number }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function activate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const receipt = await apiPost<Result>("/reports/arsip-rat/activate-tmp-members", { count, confirmed: true });
      setResult(receipt);
      setOpen(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["members"] }),
        client.invalidateQueries({ queryKey: ["/reports/arsip-rat/publish"] })
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktivasi anggota gagal.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    {count > 0 && <Button variant="outline" onClick={() => { setOpen(true); setError(""); }}>Aktifkan anggota TMP</Button>}
    {result && <p role="status" className="text-sm">{result.activated} anggota TMP diaktifkan.
      {result.needsMatch > 0 && " " + result.needsMatch + " baris dengan nama yang sama perlu dicocokkan."}</p>}
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aktifkan anggota TMP</DialogTitle>
          <DialogDescription>Periksa {count} baris Excel. Anggota baru berstatus Aktif dan Belum terverifikasi. Baris dengan nama yang sama dengan anggota terdaftar perlu dicocokkan.</DialogDescription>
        </DialogHeader>
        {error && <div role="alert"><FormError error={error} /></div>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Batal</Button>
          <Button disabled={busy} onClick={() => void activate()}>{busy ? "Mengaktifkan…" : "Aktifkan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
