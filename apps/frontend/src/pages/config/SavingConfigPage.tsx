import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { useToast } from '../../components/hooks/use-toast';
import { Plus, Edit2, Power } from 'lucide-react';
import { TenantType, SavingType, RateType } from '@siskop/shared';

interface SavingConfig {
  id: string;
  name: string;
  type: SavingType;
  rateType: RateType;
  rate: string;
  period: string;
  isActive: boolean;
}

const schema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  type: z.nativeEnum(SavingType),
  rateType: z.nativeEnum(RateType),
  rate: z.string().min(1, 'Rate wajib diisi'),
  period: z.string().min(1, 'Periode wajib diisi'),
});

type FormData = z.infer<typeof schema>;

export function SavingConfigPage() {
  const { toast } = useToast();
  const tenant = useAuthStore((s) => s.tenant);
  const isSyariah = tenant?.type === TenantType.SYARIAH;
  const [configs, setConfigs] = useState<SavingConfig[]>([]);
  const [editConfig, setEditConfig] = useState<SavingConfig | null>(null);
  const [addDialog, setAddDialog] = useState(false);
  const [apiError, setApiError] = useState('');

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: SavingType.SUKARELA,
      rateType: isSyariah ? RateType.BAGI_HASIL : RateType.BUNGA,
      period: 'MONTHLY',
    },
  });

  const fetchConfigs = () => {
    api.get('/api/tenant/savings/configs').then((res) => setConfigs(res.data.data));
  };

  useEffect(() => { fetchConfigs(); }, []);

  const openEdit = (c: SavingConfig) => {
    setEditConfig(c);
    reset({ name: c.name, type: c.type, rateType: c.rateType, rate: c.rate, period: c.period });
    setApiError('');
    setAddDialog(true);
  };

  const openAdd = () => {
    setEditConfig(null);
    reset({ name: '', type: SavingType.SUKARELA, rateType: isSyariah ? RateType.BAGI_HASIL : RateType.BUNGA, rate: '', period: 'MONTHLY' });
    setApiError('');
    setAddDialog(true);
  };

  const onSubmit = async (data: FormData) => {
    setApiError('');
    try {
      if (editConfig) {
        await api.put(`/api/tenant/savings/configs/${editConfig.id}`, data);
        toast({ title: 'Konfigurasi berhasil diperbarui' });
      } else {
        await api.post('/api/tenant/savings/configs', data);
        toast({ title: 'Konfigurasi berhasil ditambahkan' });
      }
      setAddDialog(false);
      fetchConfigs();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Gagal menyimpan');
    }
  };

  const toggleActive = async (c: SavingConfig) => {
    try {
      await api.put(`/api/tenant/savings/configs/${c.id}`, { isActive: !c.isActive });
      fetchConfigs();
    } catch {
      toast({ title: 'Gagal', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Konfigurasi Simpanan"
        actions={<Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Tambah</Button>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {configs.map((c) => (
          <Card key={c.id} className={!c.isActive ? 'opacity-60' : ''}>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="font-medium">{c.name}</p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{c.type}</Badge>
                    <Badge variant="outline">{c.rateType} {c.rate}%</Badge>
                    <Badge variant="outline">{c.period === 'MONTHLY' ? 'Bulanan' : 'Tahunan'}</Badge>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`h-8 w-8 ${c.isActive ? 'text-orange-500' : 'text-green-600'}`}
                    onClick={() => toggleActive(c)}
                    title={c.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editConfig ? 'Edit' : 'Tambah'} Konfigurasi Simpanan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Nama *</Label>
              <Input placeholder="Simpanan Sukarela" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Tipe *</Label>
              <Select defaultValue={SavingType.SUKARELA} onValueChange={(v) => setValue('type', v as SavingType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SavingType.POKOK}>Simpanan Pokok</SelectItem>
                  <SelectItem value={SavingType.WAJIB}>Simpanan Wajib</SelectItem>
                  <SelectItem value={SavingType.SUKARELA}>Simpanan Sukarela</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Rate *</Label>
              <Select
                defaultValue={isSyariah ? RateType.BAGI_HASIL : RateType.BUNGA}
                onValueChange={(v) => setValue('rateType', v as RateType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={RateType.BUNGA}>Bunga</SelectItem>
                  <SelectItem value={RateType.BAGI_HASIL}>Bagi Hasil</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rate (%) *</Label>
              <Input type="number" step="0.01" placeholder="2.5" {...register('rate')} />
              {errors.rate && <p className="text-xs text-destructive">{errors.rate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Periode *</Label>
              <Select defaultValue="MONTHLY" onValueChange={(v) => setValue('period', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Bulanan</SelectItem>
                  <SelectItem value="YEARLY">Tahunan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddDialog(false)}>Batal</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
