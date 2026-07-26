import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api, { isFeatureNotEntitled } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { NotEntitledNotice } from '../../components/shared/NotEntitledNotice';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useToast } from '../../components/hooks/use-toast';

interface ShuDistributionConfig {
  jasaSimpananPercent: number;
  jasaPinjamanPercent: number;
  cadanganPercent: number;
  lainnyaPercent: number;
}

const schema = z.object({
  jasaSimpananPercent: z.coerce.number().min(0).max(100),
  jasaPinjamanPercent: z.coerce.number().min(0).max(100),
  cadanganPercent: z.coerce.number().min(0).max(100),
  lainnyaPercent: z.coerce.number().min(0).max(100),
});

type FormData = z.infer<typeof schema>;

const FIELDS: { key: keyof FormData; label: string }[] = [
  { key: 'jasaSimpananPercent', label: 'Jasa Simpanan' },
  { key: 'jasaPinjamanPercent', label: 'Jasa Pinjaman' },
  { key: 'cadanganPercent', label: 'Cadangan' },
  { key: 'lainnyaPercent', label: 'Lainnya' },
];

function apiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
  return axiosErr?.response?.data?.error?.message ?? fallback;
}

export function ShuDistributionConfigPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [notEntitled, setNotEntitled] = useState(false);
  const canEdit = can('accounting', 'update');

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: { jasaSimpananPercent: 0, jasaPinjamanPercent: 0, cadanganPercent: 0, lainnyaPercent: 0 },
    });

  const fetchConfig = () => {
    setIsLoading(true);
    setNotEntitled(false);
    api
      .get('/api/config/shu-distribution')
      .then((res) => {
        const data: ShuDistributionConfig | null = res.data.data;
        if (data) reset(data);
      })
      .catch((err) => {
        if (isFeatureNotEntitled(err)) setNotEntitled(true);
      })
      .finally(() => setIsLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchConfig(); }, []);

  const total = FIELDS.reduce((sum, f) => sum + (Number(watch(f.key)) || 0), 0);

  const onSubmit = async (data: FormData) => {
    setApiError('');
    try {
      await api.put('/api/config/shu-distribution', data);
      toast({ title: 'Konfigurasi SHU berhasil disimpan' });
    } catch (err) {
      setApiError(apiErrorMessage(err, 'Gagal menyimpan konfigurasi'));
    }
  };

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  if (notEntitled) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Konfigurasi SHU"
          description="Formula pembagian Sisa Hasil Usaha (SHU) — 4 persentase harus berjumlah tepat 100%"
        />
        <NotEntitledNotice />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Konfigurasi SHU"
        description="Formula pembagian Sisa Hasil Usaha (SHU) — 4 persentase harus berjumlah tepat 100%"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {apiError && <FormError error={apiError} />}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Persentase Alokasi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label>{f.label} (%)</Label>
                  <Input type="number" step="0.01" disabled={!canEdit} {...register(f.key)} />
                  {errors[f.key] && <p className="text-xs text-destructive">{errors[f.key]?.message}</p>}
                </div>
              ))}
            </div>
            <p className={total === 100 ? 'text-sm font-medium text-green-700' : 'text-sm font-medium text-destructive'}>
              Total: {total}%{total !== 100 && ' — harus tepat 100%'}
            </p>
          </CardContent>
        </Card>

        {canEdit && (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Menyimpan...' : 'Simpan Pengaturan'}
          </Button>
        )}
      </form>
    </div>
  );
}
