import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReferralPartnerDetail, ReferralPartnerSummary, TenantReferralRow } from "@siskop/types";
import { apiFetch, apiPatch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createPartnerBody,
  EMPTY_PARTNER_FORM,
  partnerEditBody,
  percent,
  settingsBody,
  termsChangeBody,
  type PartnerEditForm,
  type TermsForm
} from "./helpers";

const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");

function Row({ id, label, children, wide }: { id: string; label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Create a partner recruited offline, or edit an existing one. Terms and status changes ask for a reason. */
export function PartnerFormDialog({ partner, onClose, onSaved }: { partner: ReferralPartnerDetail | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const editing = partner !== null;
  const [form, setForm] = useState<PartnerEditForm>(() =>
    partner
      ? {
          ...EMPTY_PARTNER_FORM,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
          city: partner.city ?? "",
          province: partner.province ?? "",
          ktpNo: partner.ktpNo,
          npwp: partner.npwp ?? "",
          bankName: partner.bankName,
          bankAccountNo: partner.bankAccountNo,
          bankAccountName: partner.bankAccountName,
          notes: partner.notes ?? "",
          code: partner.code ?? "",
          ratePercent: String(Number((Number(partner.commissionRate) * 100).toFixed(2))),
          months: String(partner.commissionMonths),
          status: partner.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
          reason: ""
        }
      : { ...EMPTY_PARTNER_FORM, status: "ACTIVE", reason: "" }
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PartnerEditForm>(key: K, value: PartnerEditForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const input = (key: Exclude<keyof PartnerEditForm, "status">, label: string, opts: { wide?: boolean; disabled?: boolean; placeholder?: string } = {}) => (
    <Row id={`pf-${key}`} label={label} wide={opts.wide}>
      <Input id={`pf-${key}`} value={form[key]} disabled={opts.disabled} placeholder={opts.placeholder} onChange={(e) => set(key, e.target.value)} />
    </Row>
  );

  async function save() {
    setError("");
    const built = editing ? partnerEditBody(form, partner) : createPartnerBody(form);
    if (!built.ok) return setError(built.problem);
    setBusy(true);
    try {
      if (editing) await apiPatch(`/platform/partners/${partner.id}`, built.body);
      else await apiPost("/platform/partners", built.body);
      toast({ title: editing ? "Mitra diperbarui" : "Mitra ditambahkan" });
      onSaved();
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Ubah ${partner.name}` : "Tambah mitra"}</DialogTitle>
          <DialogDescription>
            {editing ? "Perubahan komisi hanya berlaku untuk koperasi yang dirujuk setelah ini." : "Mitra yang direkrut langsung langsung aktif dan mendapat kode."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {input("name", "Nama lengkap *")}
          {input("email", "Email *")}
          {input("phone", "WhatsApp *")}
          {input("ktpNo", "NIK *", { disabled: editing })}
          {input("city", "Kota")}
          {input("province", "Provinsi")}
          {input("npwp", "NPWP")}
          {input("bankName", "Bank *")}
          {input("bankAccountNo", "No. rekening *")}
          {input("bankAccountName", "Atas nama *")}
          {!editing && input("code", "Kode (opsional)", { placeholder: "NEX-BUDI" })}
          {input("ratePercent", "Komisi % (kosong = standar)")}
          {input("months", "Masa komisi, bulan (kosong = standar)")}
          {editing && (
            <Row id="pf-status" label="Status">
              <select id="pf-status" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.status} onChange={(e) => set("status", e.target.value as PartnerEditForm["status"])}>
                <option value="ACTIVE">Aktif</option>
                <option value="SUSPENDED">Ditangguhkan</option>
              </select>
            </Row>
          )}
          <Row id="pf-notes" label="Catatan" wide>
            <Textarea id="pf-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Row>
          {editing && input("reason", "Alasan (wajib bila komisi atau status berubah)", { wide: true })}
        </div>
        {error && <FormError error={error} />}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Shared shell for the small "change X with a reason" dialogs. */
function TermsDialog({
  title,
  description,
  initial,
  build,
  submit,
  success,
  onClose,
  onSaved,
  requireBoth
}: {
  title: string;
  description: string;
  initial: TermsForm;
  build: (form: TermsForm) => ReturnType<typeof termsChangeBody> | ReturnType<typeof settingsBody>;
  submit: (body: never) => Promise<unknown>;
  success: string;
  onClose: () => void;
  onSaved: () => void;
  requireBoth?: boolean;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const built = build(form);
    if (!built.ok) return setError(built.problem);
    setBusy(true);
    setError("");
    try {
      await submit(built.body as never);
      toast({ title: success });
      onSaved();
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Row id="t-rate" label={requireBoth ? "Komisi %" : "Komisi % (kosong = tetap)"}>
            <Input id="t-rate" inputMode="decimal" value={form.ratePercent} onChange={(e) => setForm({ ...form, ratePercent: e.target.value })} />
          </Row>
          <Row id="t-months" label={requireBoth ? "Masa komisi, bulan" : "Bulan (kosong = tetap)"}>
            <Input id="t-months" inputMode="numeric" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} />
          </Row>
          <Row id="t-reason" label="Alasan *" wide>
            <Input id="t-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Row>
        </div>
        {error && <FormError error={error} />}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReferralTermsDialog({ referral, onClose, onSaved }: { referral: TenantReferralRow; onClose: () => void; onSaved: () => void }) {
  return (
    <TermsDialog
      title={`Ubah komisi ${referral.tenant.name}`}
      description="Berlaku untuk tagihan yang dibayar setelah ini. Komisi yang sudah tercatat tidak berubah."
      initial={{ ratePercent: String(Number((Number(referral.rate) * 100).toFixed(2))), months: String(referral.months), reason: "" }}
      build={termsChangeBody}
      submit={(body) => apiPatch(`/platform/referrals/${referral.id}`, body)}
      success="Komisi koperasi diperbarui"
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

export function ReferralSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useQuery({ queryKey: ["platform", "referral-settings"], queryFn: () => apiFetch<{ defaultRate: string; defaultMonths: number }>("/platform/referral-settings") });
  if (!settings.data) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pengaturan program</DialogTitle>
          </DialogHeader>
          {settings.isError ? <FormError error="Pengaturan tidak dapat dimuat" /> : <p className="text-sm text-muted-foreground">Memuat…</p>}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <TermsDialog
      title="Pengaturan program"
      description={`Standar saat ini ${percent(settings.data.defaultRate)} selama ${settings.data.defaultMonths} bulan. Hanya mengisi otomatis mitra baru; mitra dan rujukan yang ada tidak berubah.`}
      initial={{ ratePercent: String(Number((Number(settings.data.defaultRate) * 100).toFixed(2))), months: String(settings.data.defaultMonths), reason: "" }}
      build={settingsBody}
      submit={(body) => apiPut("/platform/referral-settings", body)}
      success="Pengaturan program disimpan"
      onClose={onClose}
      onSaved={() => undefined}
      requireBoth
    />
  );
}

/** Attach a partner to a koperasi that has none, or move it to another partner. */
export function AssignPartnerDialog({ tenantId, tenantName, onClose }: { tenantId: string; tenantName: string; onClose: () => void }) {
  const { toast } = useToast();
  const partners = useQuery({ queryKey: ["platform", "partners", "ACTIVE"], queryFn: () => apiFetch<ReferralPartnerSummary[]>("/platform/partners?status=ACTIVE") });
  const [partnerId, setPartnerId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!partnerId) return setError("Pilih mitra.");
    if (reason.trim().length < 3) return setError("Alasan wajib diisi (minimal 3 karakter).");
    setBusy(true);
    setError("");
    try {
      await apiPut(`/platform/tenants/${tenantId}/referral`, { partnerId, reason: reason.trim() });
      toast({ title: "Mitra dikaitkan dengan koperasi" });
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kaitkan mitra — {tenantName}</DialogTitle>
          <DialogDescription>Komisi hanya berlaku untuk tagihan yang dibayar setelah ini. Mengganti mitra tidak memindahkan komisi yang sudah tercatat.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Row id="as-partner" label="Mitra *">
            <select id="as-partner" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">{partners.isPending ? "Memuat…" : "Pilih mitra"}</option>
              {(partners.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.code}
                </option>
              ))}
            </select>
          </Row>
          <Row id="as-reason" label="Alasan *">
            <Input id="as-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Row>
        </div>
        {error && <FormError error={error} />}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Menyimpan..." : "Kaitkan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
