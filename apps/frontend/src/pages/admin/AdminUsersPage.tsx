import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api, { apiErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { formatTanggalPendek } from '../../lib/utils';
import { DataTable, ColumnDef } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { useToast } from '../../hooks/use-toast';
import { UserPlus } from 'lucide-react';

interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}

const addSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  email: z.string().email('Email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter').regex(/[A-Z]/, 'Harus ada huruf besar').regex(/[0-9]/, 'Harus ada angka'),
});

type AddForm = z.infer<typeof addSchema>;

export function AdminUsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const { toast } = useToast();
  const [data, setData] = useState<PlatformAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addDialog, setAddDialog] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<PlatformAdmin | null>(null);
  const [apiError, setApiError] = useState('');

  const addForm = useForm<AddForm>({ resolver: zodResolver(addSchema) });

  const fetchUsers = () => {
    setIsLoading(true);
    api.get('/api/admin/users')
      .then((res) => setData(res.data.data))
      .catch((err) => toast({ title: 'Gagal memuat platform admin', description: apiErrorMessage(err, ''), variant: 'destructive' }))
      .finally(() => setIsLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUsers(); }, []);

  const onAddSubmit = async (data: AddForm) => {
    setApiError('');
    try {
      await api.post('/api/admin/users', data);
      toast({ title: 'Platform admin berhasil ditambahkan' });
      setAddDialog(false);
      addForm.reset();
      fetchUsers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Gagal menambahkan platform admin');
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.delete(`/api/admin/users/${deactivateTarget.id}`);
      toast({ title: 'Platform admin berhasil dinonaktifkan' });
      setDeactivateTarget(null);
      fetchUsers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      toast({
        title: 'Gagal menonaktifkan',
        description: axiosErr?.response?.data?.error?.message,
        variant: 'destructive',
      });
    }
  };

  const reactivate = async (user: PlatformAdmin) => {
    try {
      await api.put(`/api/admin/users/${user.id}`, { isActive: true });
      toast({ title: 'Platform admin berhasil diaktifkan kembali' });
      fetchUsers();
    } catch {
      toast({ title: 'Gagal', variant: 'destructive' });
    }
  };

  const columns: ColumnDef<PlatformAdmin>[] = [
    { header: 'Nama', accessorKey: 'name' },
    { header: 'Email', accessorKey: 'email' },
    { header: 'Status', cell: ({ row }) => (
      <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
        {row.original.isActive ? 'Aktif' : 'Nonaktif'}
      </Badge>
    )},
    { header: 'Tgl Dibuat', cell: ({ row }) => formatTanggalPendek(row.original.createdAt) },
    {
      header: 'Aksi',
      cell: ({ row }) => (
        <div className="flex gap-2">
          {row.original.isActive ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={row.original.id === currentUser?.id}
              onClick={() => setDeactivateTarget(row.original)}
            >
              Nonaktifkan
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => reactivate(row.original)}>
              Aktifkan
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Admin"
        description="Kelola pengguna dengan akses admin.siskop.com"
        actions={
          <Button onClick={() => { setAddDialog(true); setApiError(''); }}>
            <UserPlus className="mr-2 h-4 w-4" /> Tambah Platform Admin
          </Button>
        }
      />

      <DataTable columns={columns} data={data} isLoading={isLoading} emptyMessage="Belum ada platform admin" />

      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Tambah Platform Admin</DialogTitle></DialogHeader>
          <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Nama</Label>
              <Input placeholder="Budi Santoso" {...addForm.register('name')} />
              {addForm.formState.errors.name && (
                <p className="text-xs text-destructive">{addForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="admin@siskop.com" {...addForm.register('email')} />
              {addForm.formState.errors.email && (
                <p className="text-xs text-destructive">{addForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" placeholder="Min. 8 karakter, 1 huruf besar, 1 angka" {...addForm.register('password')} />
              {addForm.formState.errors.password && (
                <p className="text-xs text-destructive">{addForm.formState.errors.password.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddDialog(false)}>Batal</Button>
              <Button type="submit" disabled={addForm.formState.isSubmitting}>
                {addForm.formState.isSubmitting ? 'Menyimpan...' : 'Tambah'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        title={`Nonaktifkan ${deactivateTarget?.name}?`}
        description="Platform admin yang dinonaktifkan tidak dapat login ke admin.siskop.com."
        confirmLabel="Nonaktifkan"
        variant="destructive"
        onConfirm={confirmDeactivate}
      />
    </div>
  );
}
