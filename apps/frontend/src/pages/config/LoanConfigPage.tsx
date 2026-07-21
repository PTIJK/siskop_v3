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
import { TenantType, LoanType, RateType } from '@siskop/shared';

interface LoanConfig {
  id: string;
  name: string;
  type: LoanType;
  rateType: RateType;
  rate: string;
  maxTermMonths: number;
  isActive: boolean;
}

const schema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  type: z.nativeEnum(LoanType),
  rateType: z.nativeEnum(RateType),
  rate: z.string().min(1, 'Rate wajib diisi'),
  maxTermMonths: z.string().min(1, 'Tenor maks wajib diisi'),
});

type FormData = z.infer<typeof schema>;

export function LoanConfigPage() {
  const { toast } = useToast();
  const tenant = useAuthStore((s) => s.tenant);
  const isSyariah = tenant?.type === TenantType.SYARIAH;
  const [configs, setConfigs] = useState<LoanConfig[]>([]);
  const [editConfig, setEditConfig] = useState<LoanConfig | null>(null);
  const [addDialog, setAddDialog] = useState(false);
  const [apiError, setApiError] = useState('');

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: isSyariah ? LoanType.SYARIAH : LoanType.KONVENSIONAL,
      rateType: isSyariah ? RateType.MARGIN : RateType.BUNGA,
      maxTermMonths: '36',
    },
  });

  const fetchConfigs = () => {
    api.get('/api/loans/configs').then((res) => setConfigs(res.data.data));
  };

  useEffect(() => { fetchConfigs(); }, []);

  const openEdit = (c: LoanConfig) => {
    setEditConfig(c);
    reset({ name: c.name, type: c.type, rateType: c.rateType, rate: c.rate, maxTermMonths: String(c.maxTermMonths) });
    setApiError('');
    setAddDialog(true);
  };

  const openAdd = () => {
    setEditConfig(null);
    reset({
      name: '',
      type: isSyariah ? LoanType.SYARIAH : LoanType.KONVENSIONAL,
      rateType: isSyariah ? RateType.MARGIN : RateType.BUNGA,
      rate: '',
      maxTermMonths: '36',
    });
    setApiError('');
    setAddDialog(true);
  };

  const onSubmit = async (data: FormData) => {
    setApiError('');
    try {
      const payload = { ...data, maxTermMonths: parseInt(data.maxTermMonths) };
      if (editConfig) {
        await api.put(`/api/loans/configs/${editConfig.id}`, payload);
        toast({ title: 'Konfigurasi berhasil diperbarui' });
      } else {
        await api.post('/api/loans/configs', payload);
        toast({ title: 'Konfigurasi berhasil ditambahkan' });
      }
      setAddDialog(false);
      fetchConfigs();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Gagal menyimpan');
    }
  };

  const toggleActive = async (c: LoanConfig) => {
    try {
      await api.put(`/api/loans/configs/${c.id}`, { isActive: !c.isActive });
      fetchConfigs();
    } catch {
      toast({ title: 'Gagal', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Konfigurasi Pinjaman"
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
                    <Badge variant="outline">Maks {c.maxTermMonths} bln</Badge>
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
            <DialogTitle>{editConfig ? 'Edit' : 'Tambah'} Konfigurasi Pinjaman</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Nama *</Label>
              <Input placeholder="Pinjaman Reguler" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Tipe *</Label>
              <Select
                defaultValue={isSyariah ? LoanType.SYARIAH : LoanType.KONVENSIONAL}
                onValueChange={(v) => setValue('type', v as LoanType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={LoanType.KONVENSIONAL}>Konvensional (Anuitas)</SelectItem>
                  <SelectItem value={LoanType.SYARIAH}>Syariah (Murabahah)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Rate *</Label>
              <Select
                defaultValue={isSyariah ? RateType.MARGIN : RateType.BUNGA}
                onValueChange={(v) => setValue('rateType', v as RateType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={RateType.BUNGA}>Bunga (%/tahun)</SelectItem>
                  <SelectItem value={RateType.MARGIN}>Margin (%/tahun)</SelectItem>
                  <SelectItem value={RateType.BAGI_HASIL}>Bagi Hasil</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rate (% per tahun) *</Label>
              <Input type="number" step="0.01" placeholder="12" {...register('rate')} />
              {errors.rate && <p className="text-xs text-destructive">{errors.rate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Tenor Maksimal (bulan) *</Label>
              <Input type="number" placeholder="36" {...register('maxTermMonths')} />
              {errors.maxTermMonths && <p className="text-xs text-destructive">{errors.maxTermMonths.message}</p>}
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
