import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface RejectRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fullName: string;
  onConfirm: (rejectionReason: string) => void;
  isSubmitting?: boolean;
}

export function RejectRequestDialog({ open, onOpenChange, fullName, onConfirm, isSubmitting }: RejectRequestDialogProps) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tolak Pendaftaran</DialogTitle>
          <DialogDescription>
            Jelaskan alasan penolakan pendaftaran <strong>{fullName}</strong>. Alasan ini membantu petugas lain
            memahami keputusan yang diambil.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Alasan Penolakan *</Label>
          <Textarea
            rows={3}
            placeholder="Contoh: Foto KTP tidak terbaca, data tidak sesuai KTP"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {reason.length > 0 && trimmed.length === 0 && (
            <p className="text-xs text-destructive">Alasan penolakan wajib diisi</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={trimmed.length === 0 || isSubmitting}
            onClick={() => onConfirm(trimmed)}
          >
            {isSubmitting ? "Menolak..." : "Tolak Pendaftaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
