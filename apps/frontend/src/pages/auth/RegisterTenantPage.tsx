import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { FormError } from '../../components/shared/FormError';
import { Building2, CheckCircle, ChevronRight, ChevronLeft } from 'lucide-react';
import { TenantType } from '@siskop/shared';

const step1Schema = z.object({
  name: z.string().min(3, 'Nama minimal 3 karakter'),
  address: z.string().min(10, 'Alamat minimal 10 karakter'),
  registrationNo: z.string().min(5, 'No. pendaftaran wajib diisi'),
  type: z.nativeEnum(TenantType),
});

const step2Schema = z.object({
  adminName: z.string().min(2, 'Nama minimal 2 karakter'),
  adminEmail: z.string().email('Email tidak valid'),
  adminPassword: z.string().min(8, 'Password minimal 8 karakter'),
  adminPasswordConfirm: z.string(),
}).refine((d) => d.adminPassword === d.adminPasswordConfirm, {
  message: 'Password tidak cocok',
  path: ['adminPasswordConfirm'],
});

type Step1Form = z.infer<typeof step1Schema>;
type Step2Form = z.infer<typeof step2Schema>;

export function RegisterTenantPage() {
  const [step, setStep] = useState(1);
  const [step1Data, setStep1Data] = useState<Step1Form | null>(null);
  const [apiError, setApiError] = useState('');
  const [loginUrl, setLoginUrl] = useState('');

  const form1 = useForm<Step1Form>({
    resolver: zodResolver(step1Schema),
    defaultValues: { type: TenantType.KONVENSIONAL },
  });

  const form2 = useForm<Step2Form>({
    resolver: zodResolver(step2Schema),
  });

  const onStep1 = (data: Step1Form) => {
    setStep1Data(data);
    setStep(2);
  };

  const onStep2 = async (data: Step2Form) => {
    if (!step1Data) return;
    setApiError('');
    try {
      const res = await api.post('/api/auth/register', {
        ...step1Data,
        cooperativeType: 'Koperasi Simpan Pinjam',
        adminName: data.adminName,
        adminEmail: data.adminEmail,
        adminPassword: data.adminPassword,
      });
      setLoginUrl(res.data.data.loginUrl);
      setStep(3);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Pendaftaran gagal. Silakan coba lagi.');
    }
  };

  if (step === 3) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <Card className="w-full max-w-md text-center shadow-md">
          <CardContent className="pt-8 pb-8">
            <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
            <h2 className="mt-4 text-xl font-bold">Pendaftaran Berhasil!</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Koperasi Anda telah terdaftar. Silakan login menggunakan akun admin yang telah dibuat.
            </p>
            <div className="mt-4 rounded-md bg-muted px-4 py-3">
              <p className="text-xs text-muted-foreground">URL Login Koperasi</p>
              <p className="mt-1 text-sm font-medium break-all">{loginUrl}</p>
            </div>
            <Button asChild className="mt-6 w-full">
              <Link to="/login">Ke Halaman Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg">
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Daftarkan Koperasi</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={step >= 1 ? 'font-medium text-foreground' : ''}>1. Info Koperasi</span>
            <ChevronRight className="h-4 w-4" />
            <span className={step >= 2 ? 'font-medium text-foreground' : ''}>2. Info Admin</span>
          </div>
        </div>

        {step === 1 && (
          <Card className="shadow-md">
            <CardHeader>
              <h2 className="text-lg font-semibold">Informasi Koperasi</h2>
            </CardHeader>
            <CardContent>
              <form onSubmit={form1.handleSubmit(onStep1)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Nama Koperasi</Label>
                  <Input placeholder="Koperasi Sejahtera Mandiri" {...form1.register('name')} />
                  {form1.formState.errors.name && (
                    <p className="text-xs text-destructive">{form1.formState.errors.name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Alamat</Label>
                  <Textarea
                    placeholder="Jl. Merdeka No. 1, Jakarta Pusat"
                    rows={3}
                    {...form1.register('address')}
                  />
                  {form1.formState.errors.address && (
                    <p className="text-xs text-destructive">{form1.formState.errors.address.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>No. Pendaftaran Koperasi</Label>
                  <Input placeholder="123/KOP/2024" {...form1.register('registrationNo')} />
                  {form1.formState.errors.registrationNo && (
                    <p className="text-xs text-destructive">{form1.formState.errors.registrationNo.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Jenis Koperasi</Label>
                  <RadioGroup
                    defaultValue={TenantType.KONVENSIONAL}
                    onValueChange={(v) => form1.setValue('type', v as TenantType)}
                    className="flex gap-6"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value={TenantType.KONVENSIONAL} id="konvensional" />
                      <Label htmlFor="konvensional">Konvensional</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value={TenantType.SYARIAH} id="syariah" />
                      <Label htmlFor="syariah">Syariah</Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-1.5">
                  <Label>Tipe Koperasi</Label>
                  <Input value="Koperasi Simpan Pinjam" readOnly className="bg-muted" />
                </div>

                <Button type="submit" className="w-full">
                  Lanjut <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="shadow-md">
            <CardHeader>
              <h2 className="text-lg font-semibold">Informasi Admin</h2>
            </CardHeader>
            <CardContent>
              <form onSubmit={form2.handleSubmit(onStep2)} className="space-y-4">
                {apiError && <FormError error={apiError} />}

                <div className="space-y-1.5">
                  <Label>Nama Lengkap Admin</Label>
                  <Input placeholder="Budi Santoso" {...form2.register('adminName')} />
                  {form2.formState.errors.adminName && (
                    <p className="text-xs text-destructive">{form2.formState.errors.adminName.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Email Admin</Label>
                  <Input type="email" placeholder="admin@koperasi.com" {...form2.register('adminEmail')} />
                  {form2.formState.errors.adminEmail && (
                    <p className="text-xs text-destructive">{form2.formState.errors.adminEmail.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input type="password" placeholder="Min. 8 karakter" {...form2.register('adminPassword')} />
                  {form2.formState.errors.adminPassword && (
                    <p className="text-xs text-destructive">{form2.formState.errors.adminPassword.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Konfirmasi Password</Label>
                  <Input type="password" placeholder="Ulangi password" {...form2.register('adminPasswordConfirm')} />
                  {form2.formState.errors.adminPasswordConfirm && (
                    <p className="text-xs text-destructive">{form2.formState.errors.adminPasswordConfirm.message}</p>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="flex-1">
                    <ChevronLeft className="mr-1 h-4 w-4" /> Kembali
                  </Button>
                  <Button type="submit" className="flex-1" disabled={form2.formState.isSubmitting}>
                    {form2.formState.isSubmitting ? 'Mendaftar...' : 'Daftar'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Sudah punya akun?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Login di sini
          </Link>
        </p>
      </div>
    </div>
  );
}
