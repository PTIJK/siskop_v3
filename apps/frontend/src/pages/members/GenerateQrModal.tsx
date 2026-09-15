import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import type { SelfRegistrationLink } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { QrCode, Copy, Download, Printer } from "lucide-react";

export function GenerateQrModal() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  // QRCodeCanvas (qrcode.react v3) isn't a forwardRef component, so the
  // canvas is found imperatively via this wrapping div instead of a ref on
  // the canvas itself.
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ["members", "self-registration-link"],
    queryFn: () => apiFetch<SelfRegistrationLink>("/members/self-registration-link"),
    enabled: open
  });

  async function copyLink() {
    if (!data?.url) return;
    try {
      await navigator.clipboard.writeText(data.url);
      toast({ title: "Tautan disalin" });
    } catch {
      toast({ title: "Gagal menyalin tautan", variant: "destructive" });
    }
  }

  function downloadQr() {
    const canvas = canvasContainerRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "qr-pendaftaran-anggota.png";
    link.click();
  }

  function printQr() {
    const canvas = canvasContainerRef.current?.querySelector("canvas");
    if (!canvas) return;
    const printWindow = window.open("", "_blank", "width=420,height=560");
    if (!printWindow) return;
    printWindow.document.write(
      `<html><head><title>QR Pendaftaran Anggota</title></head>` +
        `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;">` +
        `<img src="${canvas.toDataURL("image/png")}" style="width:280px;height:280px" onload="window.print()" />` +
        `</body></html>`
    );
    printWindow.document.close();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <QrCode className="mr-2 h-4 w-4" />
          Generate QR Pendaftaran
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>QR Pendaftaran Mandiri</DialogTitle>
          <DialogDescription>
            Cetak atau tampilkan kode ini di meja teller. Calon anggota memindai kode untuk mengisi data mereka
            sendiri — pendaftaran tetap menunggu persetujuan teller/admin sebelum menjadi anggota resmi.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {isPending && <div className="flex h-64 w-64 items-center justify-center text-sm text-muted-foreground">Memuat…</div>}
          {isError && (
            <div className="flex h-64 w-64 items-center justify-center text-center text-sm text-destructive">
              Gagal memuat tautan pendaftaran
            </div>
          )}
          {data && (
            <>
              <div ref={canvasContainerRef} className="rounded-md border p-4">
                <QRCodeCanvas value={data.url} size={224} />
              </div>
              <p className="break-all text-center text-xs text-muted-foreground">{data.url}</p>
            </>
          )}
        </div>

        {data && (
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copyLink}>
              <Copy className="mr-2 h-4 w-4" />
              Salin Tautan
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={downloadQr}>
              <Download className="mr-2 h-4 w-4" />
              Unduh
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={printQr}>
              <Printer className="mr-2 h-4 w-4" />
              Cetak
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
