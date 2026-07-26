import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Search, ChevronLeft, ChevronRight, Plus, Copy, Check } from 'lucide-react';
import api from '../../lib/api';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { formatTanggalPendek } from '../../lib/utils';
import { getBillingStatus } from '../../lib/billing';
import { useToast } from '../../hooks/use-toast';
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
import { TenantType } from '@siskop/shared';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  nextBillingDate?: string | null;
  package?: { name: string } | null;
}

interface Meta {
  page: number;
  limit: number;
  total: number;
}

interface RegisterForm {
  name: string;
  type: TenantType | '';
  address: string;
  registrationNo: string;
  cooperativeType: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

const EMPTY_FORM: RegisterForm = {
  name: '',
  type: '',
  address: '',
  registrationNo: '',
  cooperativeType: 'Koperasi Simpan Pinjam',
  adminName: '',
  adminEmail: '',
  adminPassword: '',
};

function validateForm(form: RegisterForm): string | null {
  if (form.name.length < 3) return 'Nama koperasi minimal 3 karakter';
  if (!form.type) return 'Pilih tipe koperasi';
  if (form.address.length < 10) return 'Alamat harus lengkap (minimal 10 karakter)';
  if (form.registrationNo.length < 5) return 'Nomor pendaftaran minimal 5 karakter';
  if (form.adminName.length < 2) return 'Nama admin minimal 2 karakter';
  if (!form.adminEmail.includes('@')) return 'Email admin tidak valid';
  if (form.adminPassword.length < 8) return 'Password minimal 8 karakter';
  if (!/[A-Z]/.test(form.adminPassword)) return 'Password harus mengandung huruf kapital';
  if (!/[0-9]/.test(form.adminPassword)) return 'Password harus mengandung angka';
  return null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="ml-1 inline-flex items-center text-primary hover:text-primary/80"
      title="Salin"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function TenantsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [meta, setMeta] = useState<Meta>({ page: 1, limit: 20, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Registration dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginUrl, setLoginUrl] = useState('');

  const fetchTenants = () => {
    setIsLoading(true);
    api
      .get('/api/admin/tenants', { params: { page, limit: 20, search: search || undefined } })
      .then((res) => {
        setTenants(res.data.data);
        setMeta(res.data.meta);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const totalPages = Math.ceil(meta.total / meta.limit);

  const openDialog = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setLoginUrl('');
    setDialogOpen(true);
  };

  const setField = <K extends keyof RegisterForm>(key: K, value: RegisterForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleRegister = async () => {
    const error = validateForm(form);
    if (error) { setFormError(error); return; }
    setFormError('');
    setIsSubmitting(true);
    try {
      const res = await api.post('/api/auth/register-tenant', {
        name: form.name,
        type: form.type,
        address: form.address,
        registrationNo: form.registrationNo,
        cooperativeType: form.cooperativeType,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
      });
      setLoginUrl(res.data.data.loginUrl);
      fetchTenants();
      toast({ title: `Koperasi "${form.name}" berhasil didaftarkan` });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setFormError(axiosErr?.response?.data?.error?.message ?? 'Gagal mendaftarkan koperasi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setDialogOpen(false);
    setLoginUrl('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Koperasi"
        description={`${meta.total} koperasi terdaftar di platform`}
        actions={
          <Button onClick={openDialog} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Tambah Koperasi
          </Button>
        }
      />

      <div className="flex gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nama atau slug koperasi..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nama</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slug</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipe</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Paket</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tagihan Berikutnya</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Terdaftar</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <Building2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                      <p className="text-muted-foreground">Tidak ada koperasi ditemukan</p>
                    </td>
                  </tr>
                ) : (
                  tenants.map((tenant) => (
                    <tr
                      key={tenant.id}
                      className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                      onClick={() => navigate(`/admin/tenants/${tenant.id}`)}
                    >
                      <td className="px-4 py-3 font-medium">{tenant.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {tenant.slug}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={tenant.type === 'SYARIAH' ? 'default' : 'secondary'}>
                          {tenant.type === 'SYARIAH' ? 'Syariah' : 'Konvensional'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {tenant.package?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={tenant.isActive ? 'default' : 'destructive'}>
                          {tenant.isActive ? 'Aktif' : 'Nonaktif'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const billing = getBillingStatus(tenant.nextBillingDate);
                          return (
                            <Badge variant={billing.variant} className={billing.className}>
                              {billing.label}
                            </Badge>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatTanggalPendek(tenant.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Halaman {meta.page} dari {totalPages} ({meta.total} total)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Registration dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Daftarkan Koperasi Baru</DialogTitle>
          </DialogHeader>

          {loginUrl ? (
            /* ── Success state ── */
            <div className="space-y-4">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
                <p className="font-medium text-green-800 dark:text-green-200">
                  Koperasi berhasil didaftarkan!
                </p>
                <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                  Bagikan URL login berikut kepada admin koperasi:
                </p>
                <div className="mt-3 flex items-center gap-1 rounded-md border border-green-300 bg-white px-3 py-2 dark:border-green-700 dark:bg-green-900">
                  <code className="flex-1 break-all text-xs text-green-800 dark:text-green-200">
                    {loginUrl}
                  </code>
                  <CopyButton text={loginUrl} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleClose}>Tutup</Button>
              </DialogFooter>
            </div>
          ) : (
            /* ── Registration form ── */
            <div className="space-y-5">
              {/* Koperasi info */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Data Koperasi
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-name">Nama Koperasi</Label>
                  <Input
                    id="reg-name"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="KSP Maju Bersama"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Tipe Koperasi</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => setField('type', v as TenantType)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih tipe..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TenantType.KONVENSIONAL}>Konvensional</SelectItem>
                      <SelectItem value={TenantType.SYARIAH}>Syariah</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-address">Alamat Lengkap</Label>
                  <Input
                    id="reg-address"
                    value={form.address}
                    onChange={(e) => setField('address', e.target.value)}
                    placeholder="Jl. Contoh No. 1, Kecamatan, Kota"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-regno">Nomor Pendaftaran</Label>
                    <Input
                      id="reg-regno"
                      value={form.registrationNo}
                      onChange={(e) => setField('registrationNo', e.target.value)}
                      placeholder="00001/KSP/2024"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-coop-type">Jenis Koperasi</Label>
                    <Input
                      id="reg-coop-type"
                      value={form.cooperativeType}
                      onChange={(e) => setField('cooperativeType', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Admin account */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Akun Admin Koperasi
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-admin-name">Nama Admin</Label>
                  <Input
                    id="reg-admin-name"
                    value={form.adminName}
                    onChange={(e) => setField('adminName', e.target.value)}
                    placeholder="Budi Santoso"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-admin-email">Email Admin</Label>
                  <Input
                    id="reg-admin-email"
                    type="email"
                    value={form.adminEmail}
                    onChange={(e) => setField('adminEmail', e.target.value)}
                    placeholder="admin@koperasi.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-admin-password">Password Admin</Label>
                  <Input
                    id="reg-admin-password"
                    type="password"
                    value={form.adminPassword}
                    onChange={(e) => setField('adminPassword', e.target.value)}
                    placeholder="Min. 8 karakter, 1 huruf kapital, 1 angka"
                  />
                </div>
              </div>

              {formError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={handleClose}>
                  Batal
                </Button>
                <Button onClick={handleRegister} disabled={isSubmitting}>
                  {isSubmitting ? 'Mendaftarkan...' : 'Daftarkan Koperasi'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
