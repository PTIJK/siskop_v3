import { useState } from "react";
import { useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import type { PublicMemberRegistrationResult, PublicTenantBranding } from "@siskop/types";
import { ApiRequestError } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/shared/FormError";
import { CheckCircle2, Upload } from "lucide-react";
import { fetchPublicTenantBranding, submitPublicRegistration } from "./api";
import { publicRegistrationSchema, type PublicRegistrationForm } from "./schema";

export function PublicRegistrationPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [ktpFile, setKtpFile] = useState<File | null>(null);
  const [apiError, setApiError] = useState("");
  const [result, setResult] = useState<PublicMemberRegistrationResult | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<PublicRegistrationForm>({ resolver: zodResolver(publicRegistrationSchema) });

  const { data, isPending, isError } = useQuery({
    queryKey: ["public-registration", "branding", tenantSlug],
    queryFn: () => fetchPublicTenantBranding<PublicTenantBranding>(tenantSlug ?? ""),
    enabled: !!tenantSlug,
    retry: false
  });

  async function onSubmit(values: PublicRegistrationForm) {
    if (!tenantSlug) return;
    setApiError("");
    try {
      const formData = new FormData();
      formData.append("fullName", values.fullName);
      formData.append("nik", values.nik);
      formData.append("address", values.address);
      formData.append("birthPlace", values.birthPlace);
      formData.append("birthDate", values.birthDate);
      formData.append("occupation", values.occupation);
      if (values.phone) formData.append("phone", values.phone);
      if (ktpFile) formData.append("ktp", ktpFile);

      const submitted = await submitPublicRegistration<PublicMemberRegistrationResult>(tenantSlug, formData);
      setResult(submitted);
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan. Silakan coba lagi.");
    }
  }

  // Centered via mx-auto on the card, not flex row + justify-center on the
  // wrapper: a row-flex item's default min-width:auto keeps it from
  // shrinking below its content's intrinsic width, which pushed the card
  // past the viewport on narrow screens despite max-w-md.
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <Card className="mx-auto w-full max-w-md">
        {isPending && (
          <CardContent role="status" className="py-16 text-center text-sm text-muted-foreground">Memuat…</CardContent>
        )}

        {!isPending && isError && (
          <CardContent role="alert" className="py-16 text-center text-sm text-muted-foreground">
            Tautan pendaftaran tidak ditemukan. Periksa kembali tautan atau kode QR yang Anda gunakan.
          </CardContent>
        )}

        {!isPending && !isError && data && !data.selfRegistrationEnabled && (
          <>
            <CardHeader className="items-center text-center">
              {data.tenantLogoUrl && <img src={data.tenantLogoUrl} alt={data.tenantName} className="mb-2 h-12" />}
              <CardTitle className="text-lg">{data.tenantName}</CardTitle>
            </CardHeader>
            <CardContent className="text-center text-sm text-muted-foreground">
              Pendaftaran mandiri saat ini tidak tersedia, silakan hubungi teller.
            </CardContent>
          </>
        )}

        {!isPending && !isError && data && data.selfRegistrationEnabled && result && (
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" aria-hidden="true" />
            <p className="text-sm font-medium">{result.message}</p>
            <p className="text-xs text-muted-foreground">NIK: {result.nikMasked}</p>
            {result.nikWarning && (
              <p className="text-xs text-warning">
                NIK ini sudah tercatat sebelumnya di koperasi ini — petugas akan memeriksa datanya saat peninjauan.
              </p>
            )}
          </CardContent>
        )}

        {!isPending && !isError && data && data.selfRegistrationEnabled && !result && (
          <>
            <CardHeader className="items-center text-center">
              {data.tenantLogoUrl && <img src={data.tenantLogoUrl} alt={data.tenantName} className="mb-2 h-12" />}
              <CardTitle className="text-lg">{data.tenantName}</CardTitle>
              <h1 className="text-[17px] font-extrabold">Formulir pendaftaran anggota</h1>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {apiError && <FormError error={apiError} />}

                <div className="space-y-1.5">
                  <Label htmlFor="reg-fullName">Nama Lengkap *</Label>
                  <Input id="reg-fullName" aria-invalid={errors.fullName ? true : undefined} placeholder="Budi Santoso" {...register("fullName")} />
                  {errors.fullName && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.fullName.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-nik">NIK (16 digit) *</Label>
                  <Input id="reg-nik" aria-invalid={errors.nik ? true : undefined} placeholder="3201234567890123" maxLength={16} inputMode="numeric" {...register("nik")} />
                  {errors.nik && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.nik.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-birthPlace">Tempat Lahir *</Label>
                  <Input id="reg-birthPlace" aria-invalid={errors.birthPlace ? true : undefined} placeholder="Jakarta" {...register("birthPlace")} />
                  {errors.birthPlace && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.birthPlace.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-birthDate">Tanggal Lahir *</Label>
                  <Input id="reg-birthDate" aria-invalid={errors.birthDate ? true : undefined} type="date" {...register("birthDate")} />
                  {errors.birthDate && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.birthDate.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-occupation">Pekerjaan *</Label>
                  <Input id="reg-occupation" aria-invalid={errors.occupation ? true : undefined} placeholder="Pedagang" {...register("occupation")} />
                  {errors.occupation && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.occupation.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-phone">Nomor Telepon (opsional)</Label>
                  <Input id="reg-phone" aria-invalid={errors.phone ? true : undefined} placeholder="08123456789" inputMode="tel" {...register("phone")} />
                  {errors.phone && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.phone.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-address">Alamat *</Label>
                  <Textarea id="reg-address" aria-invalid={errors.address ? true : undefined} placeholder="Jl. Merdeka No. 1, RT 01/RW 02, Jakarta" rows={3} {...register("address")} />
                  {errors.address && <p role="alert" className="text-[12.5px] font-semibold text-destructive">{errors.address.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Foto KTP (opsional)</Label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary focus-within:ring-2 focus-within:ring-ring">
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    {ktpFile ? ktpFile.name : "Pilih file (JPG, PNG, PDF — maks 2MB)"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="sr-only"
                      onChange={(e) => setKtpFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>

                <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
                  {isSubmitting ? "Mengirim…" : "Daftar"}
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
