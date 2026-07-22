import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import { formatTanggalIndonesia } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useToast } from '../../components/hooks/use-toast';

interface ModalDisetorConfig {
  modalDisetor: string | null;
  auditThresholdNotifiedAt: string | null;
}

const schema = z.object({
  modalDisetor: z.coerce.number().nullable(),
});

type FormData = z.infer<typeof schema>;

function apiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
  return axiosErr?.response?.data?.error?.message ?? fallback;
}

export function ModalDisetorConfigPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [auditThresholdNotifiedAt, setAuditThresholdNotifiedAt] = useState<string | null>(null);
  const canEdit = can('config', 'update');

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: { modalDisetor: null },
    });

  const fetchConfig = () => {
    setIsLoading(true);
    api
      .get('/api/config/modal-disetor')
      .then((res) => {
        const data: ModalDisetorConfig = res.data.data;
        reset({ modalDisetor: data.modalDisetor !== null ? Number(data.modalDisetor) : null });
        setAuditThresholdNotifiedAt(data.auditThresholdNotifiedAt);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchConfig(); }, []);

  const onSubmit = async (data: FormData) => {
    setApiError('');
    try {
      await api.put('/api/config/modal-disetor', { modalDisetor: data.modalDisetor });
      toast({ title: 'Modal disetor berhasil disimpan' });
    } catch (err) {
      setApiError(apiErrorMessage(err, 'Gagal menyimpan modal disetor'));
    }
  };

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modal Disetor"
        description="Nilai modal disetor koperasi — menentukan kewajiban audit tahunan sesuai Permenkop UKM No. 2/2024 Pasal 12 (ambang batas Rp5 miliar)"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {apiError && <FormError error={apiError} />}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modal Disetor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Modal Disetor (Rp)</Label>
              <Input type="number" step="0.01" disabled={!canEdit} {...register('modalDisetor')} />
              {errors.modalDisetor && <p className="text-xs text-destructive">{errors.modalDisetor.message}</p>}
              <p className="text-xs text-muted-foreground">Kosongkan jika belum ditentukan.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Terakhir Notifikasi Ambang Audit</Label>
              <p className="text-sm">
                {auditThresholdNotifiedAt ? formatTanggalIndonesia(auditThresholdNotifiedAt) : 'Belum pernah'}
              </p>
            </div>
          </CardContent>
        </Card>

        {canEdit && (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Menyimpan...' : 'Simpan'}
          </Button>
        )}
      </form>
    </div>
  );
}
