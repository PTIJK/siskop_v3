import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadPdf } from "@/lib/pdf";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";

/** PDF download for a loaded report. Hidden without reports:export. */
export function PrintButton({ path, filename }: { path: string; filename: string }) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!can("reports", "export")) return null;

  const onClick = async () => {
    setBusy(true);
    try {
      await downloadPdf(path, filename);
    } catch (err) {
      toast({ title: "Gagal mengunduh PDF", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={busy}>
      <Printer className="mr-2 h-4 w-4" />
      {busy ? "Menyiapkan..." : "Cetak PDF"}
    </Button>
  );
}
