import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode } from "lucide-react";
import type { SelfRegistrationConfig } from "@siskop/types";
import { apiFetch, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const configKey = ["config", "self-registration"] as const;

export function SelfRegistrationConfigTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = can("config", "update");
  const [draft, setDraft] = useState<boolean | null>(null);

  const config = useQuery({
    queryKey: configKey,
    queryFn: () => apiFetch<SelfRegistrationConfig>("/config/self-registration")
  });

  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPut<SelfRegistrationConfig>("/config/self-registration", { selfRegistrationEnabled: enabled }),
    onMutate: () => queryClient.cancelQueries({ queryKey: configKey }),
    onSuccess: (saved) => {
      queryClient.setQueryData(configKey, saved);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["members", "self-registration-link"] });
      toast({ title: "Pengaturan pendaftaran mandiri disimpan" });
    }
  });

  if (config.isPending) return <PageLoading />;
  if (!config.data) {
    return (
      <Card className="max-w-3xl">
        <CardContent className="space-y-3 pt-[18px]">
          <FormError error="Pengaturan pendaftaran mandiri belum dapat dimuat." />
          <Button variant="outline" onClick={() => void config.refetch()}>Muat ulang</Button>
        </CardContent>
      </Card>
    );
  }

  const saved = config.data.selfRegistrationEnabled;
  const enabled = draft ?? saved;
  const dirty = enabled !== saved;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (canEdit && dirty && !save.isPending) save.mutate(enabled);
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader className="space-y-0 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
              <QrCode className="size-5" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-extrabold tracking-tight">Pendaftaran mandiri</h2>
          </div>
          <Badge variant={saved ? "ok" : "outline"}>{saved ? "Aktif" : "Nonaktif"}</Badge>
        </div>
        <CardDescription className="mt-3 leading-relaxed">
          Calon anggota dapat mengisi formulir lewat kode QR di halaman Anggota. Teller atau admin tetap meninjau setiap pendaftaran.
        </CardDescription>
      </CardHeader>

      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4 px-5 sm:px-6">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3.5">
            <div>
              <p id="self-registration-label" className="text-sm font-bold">Formulir pendaftaran via QR</p>
              <p id="self-registration-description" className="mt-1 text-sm text-muted-foreground">
                Saat dimatikan, kode QR tidak lagi membuka formulir.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-labelledby="self-registration-label"
              aria-describedby="self-registration-description"
              disabled={!canEdit || save.isPending}
              onClick={() => {
                save.reset();
                setDraft(!enabled);
              }}
              className="group grid min-h-11 shrink-0 place-items-center rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span aria-hidden="true" className="flex h-6 w-11 items-center rounded-full border border-input bg-muted p-0.5 transition-colors group-aria-checked:border-transparent group-aria-checked:bg-primary motion-reduce:transition-none">
                <span className="size-[18px] rounded-full border border-input bg-card transition-transform group-aria-checked:translate-x-5 group-aria-checked:border-transparent motion-reduce:transition-none" />
              </span>
            </button>
          </div>
          {save.isError && <div role="alert"><FormError error={save.error instanceof ApiRequestError ? save.error.message : "Pengaturan belum dapat disimpan. Coba lagi."} /></div>}
        </CardContent>

        {canEdit && (
          <CardFooter className="flex-wrap justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
            <p role="status" className="text-sm text-muted-foreground">{dirty ? "Perubahan belum disimpan" : ""}</p>
            <div className="ml-auto flex flex-wrap gap-2">
              {dirty && (
                <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => { setDraft(null); save.reset(); }}>
                  Batalkan
                </Button>
              )}
              <Button type="submit" disabled={!dirty || save.isPending}>
                {save.isPending ? "Menyimpan…" : "Simpan perubahan"}
              </Button>
            </div>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}
