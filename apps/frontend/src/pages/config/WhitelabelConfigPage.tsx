import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { useToast } from '../../hooks/use-toast';
import { DomainStatus } from '@siskop/shared';

interface WhitelabelConfig {
  customDomain: string | null;
  domainStatus: DomainStatus;
  primaryColor: string | null;
  hideBranding: boolean;
  emailSenderName: string | null;
  emailSenderAddress: string | null;
}

const schema = z.object({
  customDomain: z.string().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Format warna harus hex, contoh: #1a2b3c')
    .or(z.literal(''))
    .optional(),
  hideBranding: z.boolean(),
  emailSenderName: z.string().optional(),
  emailSenderAddress: z.string().email('Email tidak valid').or(z.literal('')).optional(),
});

type FormData = z.infer<typeof schema>;

const DOMAIN_STATUS_LABEL: Record<DomainStatus, string> = {
  [DomainStatus.PENDING]: 'Menunggu Verifikasi',
  [DomainStatus.VERIFIED]: 'Terverifikasi',
  [DomainStatus.FAILED]: 'Gagal',
};

const DOMAIN_STATUS_VARIANT: Record<DomainStatus, 'secondary' | 'default' | 'destructive'> = {
  [DomainStatus.PENDING]: 'secondary',
  [DomainStatus.VERIFIED]: 'default',
  [DomainStatus.FAILED]: 'destructive',
};

export function WhitelabelConfigPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<WhitelabelConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState('');

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: { customDomain: '', primaryColor: '', hideBranding: false, emailSenderName: '', emailSenderAddress: '' },
    });

  const fetchConfig = () => {
    setIsLoading(true);
    api
      .get('/api/tenant/config/whitelabel')
      .then((res) => {
        const data: WhitelabelConfig | null = res.data.data;
        setConfig(data);
        if (data) {
          reset({
            customDomain: data.customDomain ?? '',
            primaryColor: data.primaryColor ?? '',
            hideBranding: data.hideBranding,
            emailSenderName: data.emailSenderName ?? '',
            emailSenderAddress: data.emailSenderAddress ?? '',
          });
        }
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchConfig(); }, []);

  const onSubmit = async (data: FormData) => {
    setApiError('');
    try {
      const res = await api.put('/api/tenant/config/whitelabel', {
        customDomain: data.customDomain || null,
        primaryColor: data.primaryColor || null,
        hideBranding: data.hideBranding,
        emailSenderName: data.emailSenderName || null,
        emailSenderAddress: data.emailSenderAddress || null,
      });
      setConfig(res.data.data);
      toast({ title: 'Pengaturan whitelabel berhasil disimpan' });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Gagal menyimpan pengaturan');
    }
  };

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Whitelabel" description="Kustomisasi domain, warna, dan identitas pengirim email" />

      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {apiError && <div className="lg:col-span-2"><FormError error={apiError} /></div>}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Domain Kustom</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Domain</Label>
                {config?.domainStatus && (
                  <Badge variant={DOMAIN_STATUS_VARIANT[config.domainStatus]}>
                    {DOMAIN_STATUS_LABEL[config.domainStatus]}
                  </Badge>
                )}
              </div>
              <Input placeholder="koperasiku.com" {...register('customDomain')} />
              {errors.customDomain && <p className="text-xs text-destructive">{errors.customDomain.message}</p>}
              <p className="text-xs text-muted-foreground">
                Arahkan CNAME domain Anda ke subdomain koperasi ini agar dapat diverifikasi.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Warna Utama</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-12 shrink-0 rounded border"
                  value={watch('primaryColor') || '#000000'}
                  onChange={(e) => setValue('primaryColor', e.target.value)}
                />
                <Input placeholder="#1a2b3c" {...register('primaryColor')} />
              </div>
              {errors.primaryColor && <p className="text-xs text-destructive">{errors.primaryColor.message}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="hideBranding"
                checked={watch('hideBranding')}
                onCheckedChange={(checked) => setValue('hideBranding', checked === true)}
              />
              <Label htmlFor="hideBranding" className="cursor-pointer font-normal">
                Sembunyikan "Powered by SISKOP"
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Identitas Pengirim Email</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nama Pengirim</Label>
                <Input placeholder="Koperasi Sejahtera" {...register('emailSenderName')} />
                {errors.emailSenderName && <p className="text-xs text-destructive">{errors.emailSenderName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Alamat Email Pengirim</Label>
                <Input placeholder="notifikasi@koperasiku.com" {...register('emailSenderAddress')} />
                {errors.emailSenderAddress && <p className="text-xs text-destructive">{errors.emailSenderAddress.message}</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Menyimpan...' : 'Simpan Pengaturan'}
          </Button>
        </div>
      </form>
    </div>
  );
}
