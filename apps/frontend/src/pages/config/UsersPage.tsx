import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api, { apiErrorMessage } from '../../lib/api';
import { formatTanggalPendek } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { DataTable, ColumnDef } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { useToast } from '../../components/hooks/use-toast';
import { UserPlus } from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
  role: { id: string; name: string };
  isActive: boolean;
  createdAt: string;
}

interface Role { id: string; name: string }

const addSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  email: z.string().email('Email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  roleId: z.string().min(1, 'Pilih role'),
});

const editSchema = z.object({ roleId: z.string().min(1, 'Pilih role') });

export function UsersPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [data, setData] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addDialog, setAddDialog] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [apiError, setApiError] = useState('');

  const addForm = useForm<z.infer<typeof addSchema>>({ resolver: zodResolver(addSchema) });
  const editForm = useForm<z.infer<typeof editSchema>>({ resolver: zodResolver(editSchema) });

  const fetchUsers = () => {
    setIsLoading(true);
    api.get('/api/config/users')
      .then((res) => setData(res.data.data))
      .catch((err) => toast({ title: 'Gagal memuat pengguna', description: apiErrorMessage(err, ''), variant: 'destructive' }))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchUsers();
    api.get('/api/config/roles')
      .then((res) => setRoles(res.data.data))
      .catch((err) => toast({ title: 'Gagal memuat daftar role', description: apiErrorMessage(err, ''), variant: 'destructive' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAddSubmit = async (data: z.infer<typeof addSchema>) => {
    setApiError('');
    try {
      await api.post('/api/config/users', data);
      toast({ title: 'Pengguna berhasil ditambahkan' });
      setAddDialog(false);
      addForm.reset();
      fetchUsers();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Gagal menambahkan pengguna');
    }
  };

  const onEditSubmit = async (data: z.infer<typeof editSchema>) => {
    if (!editUser) return;
    try {
      await api.put(`/api/config/users/${editUser.id}`, data);
      toast({ title: 'Role berhasil diubah' });
      setEditUser(null);
      fetchUsers();
    } catch {
      toast({ title: 'Gagal', variant: 'destructive' });
    }
  };

  const toggleActive = async (user: User) => {
    try {
      if (user.isActive) {
        await api.delete(`/api/config/users/${user.id}`);
      } else {
        await api.put(`/api/config/users/${user.id}`, { isActive: true });
      }
      fetchUsers();
    } catch {
      toast({ title: 'Gagal', variant: 'destructive' });
    }
  };

  const columns: ColumnDef<User>[] = [
    { header: 'Nama', accessorKey: 'name' },
    { header: 'Email', accessorKey: 'email' },
    { header: 'Role', cell: ({ row }) => <Badge variant="outline">{row.original.role.name}</Badge> },
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
          {can('users', 'update') && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setEditUser(row.original); editForm.setValue('roleId', row.original.role.id); }}
              >
                Edit Role
              </Button>
              <Button
                size="sm"
                variant={row.original.isActive ? 'destructive' : 'default'}
                onClick={() => toggleActive(row.original)}
              >
                {row.original.isActive ? 'Nonaktifkan' : 'Aktifkan'}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengguna"
        actions={
          can('users', 'create') && (
            <Button onClick={() => { setAddDialog(true); setApiError(''); }}>
              <UserPlus className="mr-2 h-4 w-4" /> Tambah User
            </Button>
          )
        }
      />

      <DataTable columns={columns} data={data} isLoading={isLoading} emptyMessage="Belum ada pengguna" />

      {/* Add Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Tambah Pengguna</DialogTitle></DialogHeader>
          <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            {[
              { label: 'Nama', key: 'name', type: 'text', placeholder: 'Budi Santoso' },
              { label: 'Email', key: 'email', type: 'email', placeholder: 'budi@koperasi.com' },
              { label: 'Password', key: 'password', type: 'password', placeholder: 'Min. 8 karakter' },
            ].map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input type={f.type} placeholder={f.placeholder} {...addForm.register(f.key as 'name' | 'email' | 'password')} />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select onValueChange={(v) => addForm.setValue('roleId', v)}>
                <SelectTrigger><SelectValue placeholder="Pilih role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
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

      {/* Edit Role Dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Edit Role — {editUser?.name}</DialogTitle></DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select defaultValue={editUser?.role.id} onValueChange={(v) => editForm.setValue('roleId', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Batal</Button>
              <Button type="submit">Simpan</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
