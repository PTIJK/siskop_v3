import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { useToast } from '../../components/hooks/use-toast';
import { Plus, Edit2 } from 'lucide-react';
import { Permissions } from '@siskop/shared';

interface Role {
  id: string;
  name: string;
  permissions: Permissions;
}

type Module = keyof Permissions;
type Action = string;

const MODULES: { key: Module; label: string; actions: { key: Action; label: string }[] }[] = [
  { key: 'dashboard', label: 'Dashboard', actions: [{ key: 'read', label: 'Baca' }] },
  { key: 'members', label: 'Anggota', actions: [{ key: 'create', label: 'Buat' }, { key: 'read', label: 'Baca' }, { key: 'update', label: 'Edit' }, { key: 'delete', label: 'Hapus' }] },
  { key: 'savings', label: 'Simpanan', actions: [{ key: 'create', label: 'Buat' }, { key: 'read', label: 'Baca' }, { key: 'update', label: 'Edit' }, { key: 'delete', label: 'Hapus' }] },
  { key: 'loans', label: 'Pinjaman', actions: [{ key: 'create', label: 'Buat' }, { key: 'read', label: 'Baca' }, { key: 'update', label: 'Edit' }, { key: 'delete', label: 'Hapus' }] },
  { key: 'reports', label: 'Laporan', actions: [{ key: 'read', label: 'Baca' }, { key: 'export', label: 'Export' }] },
  { key: 'config', label: 'Konfigurasi', actions: [{ key: 'read', label: 'Baca' }, { key: 'update', label: 'Edit' }] },
  { key: 'users', label: 'User', actions: [{ key: 'create', label: 'Buat' }, { key: 'read', label: 'Baca' }, { key: 'update', label: 'Edit' }, { key: 'delete', label: 'Hapus' }] },
  { key: 'roles', label: 'Role', actions: [{ key: 'create', label: 'Buat' }, { key: 'read', label: 'Baca' }, { key: 'update', label: 'Edit' }, { key: 'delete', label: 'Hapus' }] },
];

const ALL_ACTIONS = ['create', 'read', 'update', 'delete', 'export'];

function buildDefaultPermissions(): Permissions {
  const p: Record<string, Record<string, boolean>> = {};
  for (const m of MODULES) {
    p[m.key] = {};
    for (const a of ALL_ACTIONS) {
      p[m.key][a] = false;
    }
  }
  return p as Permissions;
}

export function RolesPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [editPerms, setEditPerms] = useState<Record<string, Record<string, boolean>>>({});
  const [editName, setEditName] = useState('');
  const [addDialog, setAddDialog] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newPerms, setNewPerms] = useState<Record<string, Record<string, boolean>>>({});
  const [apiError, setApiError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchRoles = () => {
    setIsLoading(true);
    api.get('/api/tenant/config/roles').then((res) => setRoles(res.data.data)).finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchRoles(); }, []);

  const openEdit = (role: Role) => {
    setEditRole(role);
    setEditName(role.name);
    setEditPerms(JSON.parse(JSON.stringify(role.permissions)));
  };

  const openAdd = () => {
    setNewRoleName('');
    setNewPerms(buildDefaultPermissions() as unknown as Record<string, Record<string, boolean>>);
    setApiError('');
    setAddDialog(true);
  };

  const togglePerm = (
    permsState: Record<string, Record<string, boolean>>,
    setPermsState: (p: Record<string, Record<string, boolean>>) => void,
    module: string,
    action: string,
    value: boolean
  ) => {
    setPermsState({ ...permsState, [module]: { ...(permsState[module] ?? {}), [action]: value } });
  };

  const saveEdit = async () => {
    if (!editRole) return;
    setIsSaving(true);
    try {
      await api.put(`/api/tenant/config/roles/${editRole.id}`, { name: editName, permissions: editPerms });
      toast({ title: 'Role berhasil diperbarui' });
      setEditRole(null);
      fetchRoles();
    } catch {
      toast({ title: 'Gagal', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const saveNew = async () => {
    if (!newRoleName.trim()) { setApiError('Nama role wajib diisi'); return; }
    setApiError('');
    setIsSaving(true);
    try {
      await api.post('/api/tenant/config/roles', { name: newRoleName, permissions: newPerms });
      toast({ title: 'Role berhasil ditambahkan' });
      setAddDialog(false);
      fetchRoles();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Gagal');
    } finally {
      setIsSaving(false);
    }
  };

  const PermissionMatrix = ({
    perms,
    setPerms,
  }: {
    perms: Record<string, Record<string, boolean>>;
    setPerms: (p: Record<string, Record<string, boolean>>) => void;
  }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 pr-4 text-left text-xs text-muted-foreground">Modul</th>
            {ALL_ACTIONS.map((a) => (
              <th key={a} className="px-2 py-2 text-center text-xs text-muted-foreground capitalize">{a}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m.key} className="border-b last:border-0">
              <td className="py-2 pr-4 font-medium">{m.label}</td>
              {ALL_ACTIONS.map((action) => {
                const hasAction = m.actions.some((a) => a.key === action);
                const checked = hasAction && !!(perms[m.key]?.[action]);
                return (
                  <td key={action} className="px-2 py-2 text-center">
                    {hasAction ? (
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => togglePerm(perms, setPerms, m.key, action, !!v)}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hak Akses"
        actions={
          can('roles', 'create') && (
            <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Tambah Role</Button>
          )
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => {
            const permCount = Object.values(role.permissions).reduce(
              (sum, m) => sum + Object.values(m).filter(Boolean).length, 0
            );
            return (
              <Card key={role.id}>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{role.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{permCount} izin aktif</p>
                    </div>
                    {can('roles', 'update') && (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(role)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editRole} onOpenChange={(o) => !o && setEditRole(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Role — {editRole?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nama Role</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <PermissionMatrix perms={editPerms} setPerms={setEditPerms} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRole(null)}>Batal</Button>
            <Button onClick={saveEdit} disabled={isSaving}>{isSaving ? 'Menyimpan...' : 'Simpan'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Tambah Role Baru</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Nama Role</Label>
              <Input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Kasir" />
            </div>
            <PermissionMatrix perms={newPerms} setPerms={setNewPerms} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>Batal</Button>
            <Button onClick={saveNew} disabled={isSaving}>{isSaving ? 'Menyimpan...' : 'Tambah'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
