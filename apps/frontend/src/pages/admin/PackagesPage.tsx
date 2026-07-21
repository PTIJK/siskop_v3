import { useEffect, useState } from 'react';
import { Plus, Package2 } from 'lucide-react';
import api from '../../lib/api';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { formatRupiah } from '../../lib/utils';
import { useToast } from '../../hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

interface SubscriptionPackage {
  id: string;
  name: string;
  price: number;
  modules: string[];
  maxUsers: number;
  maxMembers: number;
  maxSavingConfigs: number | null;
  whitelabelEnabled: boolean;
  isActive: boolean;
}

interface PackageForm {
  name: string;
  price: string;
  maxUsers: string;
  maxMembers: string;
  maxSavingConfigs: string;
  whitelabelEnabled: boolean;
  accountingEnabled: boolean;
}

const EMPTY_FORM: PackageForm = {
  name: '',
  price: '',
  maxUsers: '',
  maxMembers: '',
  maxSavingConfigs: '',
  whitelabelEnabled: false,
  accountingEnabled: false,
};
const DEFAULT_MODULES = ['members', 'savings', 'loans', 'reports', 'config'];

export function PackagesPage() {
  const { toast } = useToast();
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<SubscriptionPackage | null>(null);
  const [form, setForm] = useState<PackageForm>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPackages = () => {
    setIsLoading(true);
    api
      .get('/api/admin/packages')
      .then((res) => setPackages(res.data.data))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchPackages();
  }, []);

  const openCreate = () => {
    setEditingPkg(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (pkg: SubscriptionPackage) => {
    setEditingPkg(pkg);
    setForm({
      name: pkg.name,
      price: String(pkg.price),
      maxUsers: String(pkg.maxUsers),
      maxMembers: String(pkg.maxMembers),
      maxSavingConfigs: pkg.maxSavingConfigs === null ? '' : String(pkg.maxSavingConfigs),
      whitelabelEnabled: pkg.whitelabelEnabled,
      accountingEnabled: pkg.modules.includes('accounting'),
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.price || !form.maxUsers || !form.maxMembers) {
      toast({ title: 'Semua kolom wajib diisi', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        name: form.name,
        price: Number(form.price),
        modules: form.accountingEnabled ? [...DEFAULT_MODULES, 'accounting'] : DEFAULT_MODULES,
        maxUsers: Number(form.maxUsers),
        maxMembers: Number(form.maxMembers),
        maxSavingConfigs: form.maxSavingConfigs === '' ? null : Number(form.maxSavingConfigs),
        whitelabelEnabled: form.whitelabelEnabled,
      };
      if (editingPkg) {
        await api.put(`/api/admin/packages/${editingPkg.id}`, payload);
        toast({ title: 'Paket berhasil diperbarui' });
      } else {
        await api.post('/api/admin/packages', payload);
        toast({ title: 'Paket berhasil dibuat' });
      }
      setDialogOpen(false);
      fetchPackages();
    } catch {
      toast({ title: 'Gagal menyimpan paket', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async (pkg: SubscriptionPackage) => {
    try {
      await api.delete(`/api/admin/packages/${pkg.id}`);
      toast({ title: 'Paket berhasil dinonaktifkan' });
      fetchPackages();
    } catch {
      toast({ title: 'Gagal menonaktifkan paket', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paket Langganan"
        description="Kelola paket berlangganan untuk koperasi"
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Tambah Paket
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : packages.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border py-16 text-center">
          <Package2 className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-muted-foreground">Belum ada paket langganan</p>
          <Button onClick={openCreate} className="mt-4" size="sm">
            Buat Paket Pertama
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <Card key={pkg.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{pkg.name}</CardTitle>
                  <Badge variant={pkg.isActive ? 'default' : 'secondary'} className="shrink-0">
                    {pkg.isActive ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </div>
                <p className="text-2xl font-bold">
                  {formatRupiah(pkg.price)}
                  <span className="text-sm font-normal text-muted-foreground">/bln</span>
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Maks. Pengguna</span>
                  <span className="font-medium text-foreground">{pkg.maxUsers}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Maks. Anggota</span>
                  <span className="font-medium text-foreground">{pkg.maxMembers}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Batas Simpanan Custom</span>
                  <span className="font-medium text-foreground">
                    {pkg.maxSavingConfigs === null ? 'Tak terbatas' : pkg.maxSavingConfigs}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Whitelabel</span>
                  <Badge variant={pkg.whitelabelEnabled ? 'default' : 'secondary'}>
                    {pkg.whitelabelEnabled ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Modul Akuntansi</span>
                  <Badge variant={pkg.modules.includes('accounting') ? 'default' : 'secondary'}>
                    {pkg.modules.includes('accounting') ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEdit(pkg)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleDeactivate(pkg)}
                    disabled={!pkg.isActive}
                  >
                    Nonaktifkan
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPkg ? 'Edit Paket' : 'Tambah Paket Baru'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pkg-name">Nama Paket</Label>
              <Input
                id="pkg-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Contoh: Paket Starter"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-price">Harga (Rp/bulan)</Label>
              <Input
                id="pkg-price"
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="99000"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pkg-users">Maks. Pengguna</Label>
                <Input
                  id="pkg-users"
                  type="number"
                  min={1}
                  value={form.maxUsers}
                  onChange={(e) => setForm((f) => ({ ...f, maxUsers: e.target.value }))}
                  placeholder="5"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pkg-members">Maks. Anggota</Label>
                <Input
                  id="pkg-members"
                  type="number"
                  min={1}
                  value={form.maxMembers}
                  onChange={(e) => setForm((f) => ({ ...f, maxMembers: e.target.value }))}
                  placeholder="100"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-saving-configs">Batas Simpanan Custom</Label>
              <Input
                id="pkg-saving-configs"
                type="number"
                min={0}
                value={form.maxSavingConfigs}
                onChange={(e) => setForm((f) => ({ ...f, maxSavingConfigs: e.target.value }))}
                placeholder="Kosongkan untuk tak terbatas"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="pkg-whitelabel"
                checked={form.whitelabelEnabled}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, whitelabelEnabled: checked === true }))
                }
              />
              <Label htmlFor="pkg-whitelabel" className="cursor-pointer font-normal">
                Aktifkan Whitelabel
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="pkg-accounting"
                checked={form.accountingEnabled}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, accountingEnabled: checked === true }))
                }
              />
              <Label htmlFor="pkg-accounting" className="cursor-pointer font-normal">
                Aktifkan Modul Akuntansi (Konfigurasi Akun)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
