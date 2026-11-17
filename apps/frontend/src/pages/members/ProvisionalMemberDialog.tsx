import { useState, type FormEvent } from "react";
import type { ProvisionalMember } from "@siskop/types";
import { apiPut } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/shared/FormError";

const fields = [
  { key: "fullName", label: "Nama lengkap", max: 200 },
  { key: "nik", label: "NIK", max: 16 },
  { key: "address", label: "Alamat", max: 500 },
  { key: "birthPlace", label: "Tempat lahir", max: 120 },
  { key: "birthDate", label: "Tanggal lahir", type: "date", max: 10 },
  { key: "occupation", label: "Pekerjaan", max: 120 }
] as const;

export function ProvisionalMemberDialog({ member, editable, onClose, onSaved }: {
  member: ProvisionalMember; editable: boolean; onClose: () => void; onSaved: (member: ProvisionalMember) => void;
}) {
  const [values, setValues] = useState({
    fullName: member.fullName, nik: member.nik ?? "", address: member.address ?? "",
    birthPlace: member.birthPlace ?? "", birthDate: member.birthDate?.slice(0, 10) ?? "", occupation: member.occupation ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editable || busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await apiPut<ProvisionalMember>("/members/provisional-rat/" + member.sourceRow, {
        revision: member.revision, fullName: values.fullName.trim(), nik: values.nik.trim() || null,
        address: values.address.trim() || null, birthPlace: values.birthPlace.trim() || null,
        birthDate: values.birthDate || null, occupation: values.occupation.trim() || null
      });
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Koreksi gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{editable ? "Edit anggota belum terverifikasi" : "Anggota belum terverifikasi"}</DialogTitle>
        <DialogDescription>{member.temporaryId} · Baris {member.sourceRow} di Excel RAT 2025.
          {editable && " Simpan informasi yang sudah diketahui. Kolom lain boleh dikosongkan."}
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => <Label key={field.key} className={"flex min-w-0 flex-col gap-1.5" + (field.key === "address" ? " sm:col-span-2" : "")}>
            {field.label}
            <Input type={"type" in field ? field.type : "text"} value={values[field.key]}
              required={field.key === "fullName"} minLength={field.key === "fullName" ? 2 : undefined} maxLength={field.max}
              inputMode={field.key === "nik" ? "numeric" : undefined} pattern={field.key === "nik" ? "[0-9]{16}" : undefined}
              readOnly={!editable} onChange={(event) => setValues((old) => ({ ...old, [field.key]: event.target.value }))} />
          </Label>)}
        </fieldset>
        {error && <div role="alert"><FormError error={error} /></div>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{editable ? "Batal" : "Tutup"}</Button>
          {editable && <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan koreksi"}</Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
