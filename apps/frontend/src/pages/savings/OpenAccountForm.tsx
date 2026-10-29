import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Member, Saving, SavingConfig } from "@siskop/types";
import { apiFetch, apiFetchPage, apiPost, ApiRequestError } from "@/api/client";
import { FormError } from "@/components/shared/FormError";
import { MemberPicker, type PickerMember } from "@/components/shared/MemberPicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { SAVING_PERIOD_LABELS } from "@/lib/saving-calc";

const schema = z.object({
  memberId: z.string().min(1, "Pilih anggota"),
  savingConfigId: z.string().min(1, "Pilih jenis simpanan")
});

type FormData = z.infer<typeof schema>;

function toPicker(m: Pick<Member, "id" | "memberId" | "fullName" | "accountNumber">): PickerMember {
  return { id: m.id, memberNumber: m.memberId, fullName: m.fullName, accountNumber: m.accountNumber };
}

/** Opens a savings account for a member (the original /savings/new form), restyled; behaviour unchanged. */
export function OpenAccountForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [configs, setConfigs] = useState<SavingConfig[]>([]);
  const [selectedMember, setSelectedMember] = useState<PickerMember | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<SavingConfig | null>(null);
  const [initialDeposit, setInitialDeposit] = useState("");
  const [apiError, setApiError] = useState("");

  const {
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    apiFetch<SavingConfig[]>("/savings/configs")
      .then((data) => setConfigs(data.filter((c) => c.isActive)))
      .catch((err) => {
        const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
        toast({ title: "Gagal memuat jenis simpanan", description: message, variant: "destructive" });
      });

    const prefillId = searchParams.get("memberId");
    if (prefillId) {
      apiFetch<Member>(`/members/${prefillId}`)
        .then((m) => {
          setSelectedMember(toPicker(m));
          setValue("memberId", m.id);
        })
        .catch((err) => {
          const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
          toast({ title: "Gagal memuat data anggota", description: message, variant: "destructive" });
        });
    }
    // Runs once on mount, like the original form.
  }, []);

  const searchMembers = async (q: string): Promise<PickerMember[]> => {
    const { items } = await apiFetchPage<Member[]>(`/members?search=${encodeURIComponent(q)}&limit=5`);
    return items.map(toPicker);
  };

  const onSubmit = async (data: FormData) => {
    setApiError("");
    try {
      const saving = await apiPost<Saving>("/savings", {
        memberId: data.memberId,
        savingConfigId: data.savingConfigId,
        initialDeposit: initialDeposit ? Number(initialDeposit) : 0
      });
      toast({ title: "Rekening simpanan berhasil dibuat" });
      navigate(`/savings/${saving.id}`);
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Informasi rekening</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {apiError && <FormError error={apiError} />}

          <div className="space-y-1.5">
            <Label htmlFor="open-member">Anggota</Label>
            <MemberPicker
              inputId="open-member"
              selected={selectedMember}
              search={searchMembers}
              onSelect={(m) => {
                setSelectedMember(m);
                setValue("memberId", m.id, { shouldValidate: true });
              }}
              onClear={() => {
                setSelectedMember(null);
                setValue("memberId", "");
              }}
            />
            {errors.memberId && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.memberId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="open-config">Jenis simpanan</Label>
            <Select
              onValueChange={(v) => {
                setValue("savingConfigId", v, { shouldValidate: true });
                setSelectedConfig(configs.find((c) => c.id === v) ?? null);
              }}
            >
              <SelectTrigger id="open-config">
                <SelectValue placeholder="Pilih jenis simpanan" />
              </SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedConfig && (
              <div className="flex flex-wrap gap-2 rounded-[10px] bg-muted p-3">
                <Badge variant="secondary">{selectedConfig.type}</Badge>
                <Badge variant="outline">
                  {selectedConfig.rateType} {selectedConfig.rate}%
                </Badge>
                <Badge variant="outline">
                  {SAVING_PERIOD_LABELS[selectedConfig.periodUnit as keyof typeof SAVING_PERIOD_LABELS] ?? selectedConfig.periodUnit}
                </Badge>
              </div>
            )}
            {errors.savingConfigId && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.savingConfigId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="open-initial">Setoran awal (opsional)</Label>
            <MoneyInput id="open-initial" value={initialDeposit} onValueChange={setInitialDeposit} hint="Boleh dikosongkan, setoran pertama bisa dilakukan nanti." />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => navigate("/savings")}>
              Batal
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isSubmitting ? "Memproses…" : "Buka rekening"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
