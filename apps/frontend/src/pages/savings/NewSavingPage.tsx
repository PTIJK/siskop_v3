import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Member, Saving, SavingConfig } from "@siskop/types";
import { apiFetch, apiFetchPage, apiPost, ApiRequestError } from "@/api/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormError } from "@/components/shared/FormError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Search } from "lucide-react";

interface MemberResult {
  id: string;
  memberId: string;
  fullName: string;
  accountNumber: string;
}

const schema = z.object({
  memberId: z.string().min(1, "Pilih anggota"),
  savingConfigId: z.string().min(1, "Pilih jenis simpanan"),
  initialBalance: z.string().optional()
});

type FormData = z.infer<typeof schema>;

export function NewSavingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [configs, setConfigs] = useState<SavingConfig[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<MemberResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<SavingConfig | null>(null);
  const [apiError, setApiError] = useState("");

  const {
    register,
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
          setSelectedMember({ id: m.id, memberId: m.memberId, fullName: m.fullName, accountNumber: m.accountNumber });
          setValue("memberId", m.id);
        })
        .catch((err) => {
          const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
          toast({ title: "Gagal memuat data anggota", description: message, variant: "destructive" });
        });
    }
  }, []);

  const searchMembers = async (q: string) => {
    if (q.length < 2) {
      setMemberResults([]);
      return;
    }
    try {
      const { items } = await apiFetchPage<Member[]>(`/members?search=${encodeURIComponent(q)}&limit=5`);
      setMemberResults(items);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal mencari anggota", description: message, variant: "destructive" });
    }
  };

  const onSubmit = async (data: FormData) => {
    setApiError("");
    try {
      const saving = await apiPost<Saving>("/savings", {
        memberId: data.memberId,
        savingConfigId: data.savingConfigId,
        initialDeposit: data.initialBalance ? parseFloat(data.initialBalance) : 0
      });
      toast({ title: "Rekening simpanan berhasil dibuat" });
      navigate(`/savings/${saving.id}`);
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Buka Rekening Simpanan" breadcrumb={[{ label: "Simpanan", href: "/savings" }, { label: "Buka Rekening" }]} />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Informasi Rekening</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Anggota *</Label>
              {selectedMember ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{selectedMember.fullName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{selectedMember.memberId}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedMember(null);
                      setValue("memberId", "");
                    }}
                  >
                    Ganti
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Cari nama anggota..."
                    className="pl-9"
                    value={memberSearch}
                    onChange={(e) => {
                      setMemberSearch(e.target.value);
                      void searchMembers(e.target.value);
                    }}
                  />
                  {memberResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md">
                      {memberResults.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="flex w-full flex-col items-start px-4 py-2.5 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setSelectedMember(m);
                            setValue("memberId", m.id);
                            setMemberResults([]);
                            setMemberSearch("");
                          }}
                        >
                          <span className="font-medium">{m.fullName}</span>
                          <span className="font-mono text-xs text-muted-foreground">{m.memberId}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {errors.memberId && <p className="text-xs text-destructive">{errors.memberId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Jenis Simpanan *</Label>
              <Select
                onValueChange={(v) => {
                  setValue("savingConfigId", v);
                  setSelectedConfig(configs.find((c) => c.id === v) ?? null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih jenis simpanan" />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {c.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedConfig && (
                <div className="space-y-1 rounded-md bg-muted p-3 text-xs">
                  <div className="flex gap-2">
                    <Badge variant="secondary">{selectedConfig.type}</Badge>
                    <Badge variant="outline">
                      {selectedConfig.rateType} {selectedConfig.rate}%
                    </Badge>
                    <Badge variant="outline">{selectedConfig.periodUnit}</Badge>
                  </div>
                </div>
              )}
              {errors.savingConfigId && <p className="text-xs text-destructive">{errors.savingConfigId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Setoran Awal (opsional)</Label>
              <Input type="number" placeholder="0" min="0" {...register("initialBalance")} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate("/savings")}>
                Batal
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Memproses..." : "Buka Rekening"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
