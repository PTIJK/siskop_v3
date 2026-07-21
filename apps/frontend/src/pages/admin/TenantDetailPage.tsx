import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Users, PiggyBank, CreditCard, Activity, Pencil } from 'lucide-react';
import api from '../../lib/api';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { formatTanggalIndonesia } from '../../lib/utils';
import { useToast } from '../../hooks/use-toast';
import { getBillingStatus } from '../../lib/billing';

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  type: string;
  address: string;
  registrationNo: string;
  isActive: boolean;
  createdAt: string;
  nextBillingDate?: string | null;
  package?: { id: string; name: string } | null;
}

interface SubscriptionPackage {
  id: string;
  name: string;
}

interface TenantStats {
  memberCount: number;
  savingCount: number;
  loanCount: number;
  activeLoans: number;
}

export function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [packageDialogOpen, setPackageDialogOpen] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [isSavingPackage, setIsSavingPackage] = useState(false);
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingDateInput, setBillingDateInput] = useState('');
  const [isSavingBilling, setIsSavingBilling] = useState(false);

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    Promise.all([
      api.get(`/api/admin/tenants/${id}`),
      api.get(`/api/admin/tenants/${id}/stats`),
      api.get('/api/admin/packages'),
    ])
      .then(([tenantRes, statsRes, packagesRes]) => {
        setTenant(tenantRes.data.data);
        setStats(statsRes.data.data);
        setPackages(packagesRes.data.data);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [id]);

  const openPackageDialog = () => {
    if (!tenant) return;
    setSelectedPackageId(tenant.package?.id ?? '');
    setPackageDialogOpen(true);
  };

  const savePackage = async () => {
    if (!tenant) return;
    setIsSavingPackage(true);
    try {
      const res = await api.put(`/api/admin/tenants/${tenant.id}`, {
        packageId: selectedPackageId || null,
      });
      setTenant(res.data.data);
      toast({ title: 'Paket langganan berhasil diperbarui' });
      setPackageDialogOpen(false);
    } catch {
      toast({ title: 'Gagal memperbarui paket langganan', variant: 'destructive' });
    } finally {
      setIsSavingPackage(false);
    }
  };

  const openBillingDialog = () => {
    if (!tenant) return;
    setBillingDateInput(tenant.nextBillingDate ? tenant.nextBillingDate.slice(0, 10) : '');
    setBillingDialogOpen(true);
  };

  const saveBillingDate = async () => {
    if (!tenant) return;
    setIsSavingBilling(true);
    try {
      const res = await api.put(`/api/admin/tenants/${tenant.id}`, {
        nextBillingDate: billingDateInput || null,
      });
      setTenant(res.data.data);
      toast({ title: 'Tanggal tagihan berikutnya berhasil diperbarui' });
      setBillingDialogOpen(false);
    } catch {
      toast({ title: 'Gagal memperbarui tanggal tagihan', variant: 'destructive' });
    } finally {
      setIsSavingBilling(false);
    }
  };

  const toggleActive = async () => {
    if (!tenant) return;
    setIsToggling(true);
    try {
      const res = await api.put(`/api/admin/tenants/${tenant.id}`, {
        isActive: !tenant.isActive,
      });
      setTenant(res.data.data);
      toast({
        title: tenant.isActive
          ? 'Koperasi berhasil dinonaktifkan'
          : 'Koperasi berhasil diaktifkan',
      });
    } catch {
      toast({ title: 'Gagal mengubah status koperasi', variant: 'destructive' });
    } finally {
      setIsToggling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        Koperasi tidak ditemukan
      </div>
    );
  }

  const billingStatus = getBillingStatus(tenant.nextBillingDate);

  return (
    <div className="space-y-6">
      <PageHeader
        title={tenant.name}
        description={`${tenant.slug}.siskop.com`}
        breadcrumb={[
          { label: 'Koperasi', href: '/admin/tenants' },
          { label: tenant.name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={tenant.isActive ? 'default' : 'destructive'}>
              {tenant.isActive ? 'Aktif' : 'Nonaktif'}
            </Badge>
            <Button
              variant={tenant.isActive ? 'destructive' : 'default'}
              size="sm"
              onClick={toggleActive}
              disabled={isToggling}
            >
              {isToggling
                ? 'Memproses...'
                : tenant.isActive
                ? 'Nonaktifkan'
                : 'Aktifkan'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Anggota"
          value={String(stats?.memberCount ?? 0)}
          icon={Users}
        />
        <StatCard
          title="Rekening Simpanan"
          value={String(stats?.savingCount ?? 0)}
          icon={PiggyBank}
        />
        <StatCard
          title="Total Pinjaman"
          value={String(stats?.loanCount ?? 0)}
          icon={CreditCard}
        />
        <StatCard
          title="Pinjaman Aktif"
          value={String(stats?.activeLoans ?? 0)}
          icon={Activity}
          iconColor="text-green-600"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informasi Koperasi</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-y-4 text-sm sm:grid-cols-2 sm:gap-x-8">
            <div>
              <dt className="text-muted-foreground">Tipe Koperasi</dt>
              <dd className="mt-0.5 font-medium">
                {tenant.type === 'SYARIAH' ? 'Syariah' : 'Konvensional'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Nomor Registrasi</dt>
              <dd className="mt-0.5 font-mono font-medium">{tenant.registrationNo}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Paket Langganan</dt>
              <dd className="mt-0.5 flex items-center gap-2 font-medium">
                {tenant.package?.name ?? 'Tanpa Paket'}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={openPackageDialog}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tanggal Terdaftar</dt>
              <dd className="mt-0.5 font-medium">{formatTanggalIndonesia(tenant.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tagihan Berikutnya</dt>
              <dd className="mt-0.5 flex items-center gap-2 font-medium">
                <Badge variant={billingStatus.variant} className={billingStatus.className}>
                  {billingStatus.label}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={openBillingDialog}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Alamat</dt>
              <dd className="mt-0.5 font-medium">{tenant.address}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Dialog open={packageDialogOpen} onOpenChange={setPackageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Paket Langganan</DialogTitle>
          </DialogHeader>
          <Select
            value={selectedPackageId || 'none'}
            onValueChange={(value) => setSelectedPackageId(value === 'none' ? '' : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pilih paket" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Tanpa Paket</SelectItem>
              {packages.map((pkg) => (
                <SelectItem key={pkg.id} value={pkg.id}>
                  {pkg.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPackageDialogOpen(false)}>
              Batal
            </Button>
            <Button onClick={savePackage} disabled={isSavingPackage}>
              {isSavingPackage ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Tanggal Tagihan Berikutnya</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              type="date"
              value={billingDateInput}
              onChange={(e) => setBillingDateInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Sistem akan mengirim pengingat 30 hari dan 7 hari sebelum tanggal ini. Akses
              koperasi akan otomatis diblokir jika tagihan belum diperbarui setelah tanggal ini
              terlewati.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillingDialogOpen(false)}>
              Batal
            </Button>
            <Button onClick={saveBillingDate} disabled={isSavingBilling}>
              {isSavingBilling ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
