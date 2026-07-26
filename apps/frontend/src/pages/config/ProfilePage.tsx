import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useToast } from '../../components/hooks/use-toast';
import { Upload } from 'lucide-react';

const profileSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter'),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Password lama wajib diisi'),
  newPassword: z.string().min(8, 'Password baru minimal 8 karakter'),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Password tidak cocok',
  path: ['confirmPassword'],
});

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const { can } = usePermissions();
  const { toast } = useToast();
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(tenant?.logoUrl ?? null);

  type ProfileFormValues = z.infer<typeof profileSchema>;
  type PasswordFormValues = z.infer<typeof passwordSchema>;
  const profileForm = useForm<ProfileFormValues>({ resolver: zodResolver(profileSchema), defaultValues: { name: user?.name ?? '' } });
  const passwordForm = useForm<PasswordFormValues>({ resolver: zodResolver(passwordSchema) });

  const onProfileSubmit = async (data: { name: string }) => {
    setProfileError('');
    try {
      await api.put('/api/config/profile', data);
      toast({ title: 'Profil berhasil diperbarui' });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setProfileError(axiosErr?.response?.data?.error?.message ?? 'Gagal memperbarui profil');
    }
  };

  const onPasswordSubmit = async (data: { currentPassword: string; newPassword: string }) => {
    setPasswordError('');
    try {
      await api.put('/api/config/profile', { currentPassword: data.currentPassword, newPassword: data.newPassword });
      toast({ title: 'Password berhasil diubah' });
      passwordForm.reset();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setPasswordError(axiosErr?.response?.data?.error?.message ?? 'Gagal mengubah password');
    }
  };

  const handleLogoUpload = async () => {
    if (!logoFile) return;
    const form = new FormData();
    form.append('logo', logoFile);
    try {
      await api.post('/api/config/logo', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast({ title: 'Logo berhasil diupload' });
    } catch {
      toast({ title: 'Gagal upload logo', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Profil" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* User profile */}
        <Card>
          <CardHeader><CardTitle className="text-base">Profil Pengguna</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
              {profileError && <FormError error={profileError} />}
              <div className="space-y-1.5">
                <Label>Nama</Label>
                <Input {...profileForm.register('name')} />
                {profileForm.formState.errors.name && (
                  <p className="text-xs text-destructive">{profileForm.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={user?.email ?? ''} readOnly className="bg-muted" />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input value={user?.role?.name ?? ''} readOnly className="bg-muted" />
              </div>
              <Button type="submit" disabled={profileForm.formState.isSubmitting}>
                {profileForm.formState.isSubmitting ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Change password */}
        <Card>
          <CardHeader><CardTitle className="text-base">Ganti Password</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
              {passwordError && <FormError error={passwordError} />}
              <div className="space-y-1.5">
                <Label>Password Lama</Label>
                <Input type="password" {...passwordForm.register('currentPassword')} />
                {passwordForm.formState.errors.currentPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.currentPassword.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Password Baru</Label>
                <Input type="password" {...passwordForm.register('newPassword')} />
                {passwordForm.formState.errors.newPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.newPassword.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Konfirmasi Password</Label>
                <Input type="password" {...passwordForm.register('confirmPassword')} />
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>
              <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                {passwordForm.formState.isSubmitting ? 'Memproses...' : 'Ubah Password'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Cooperative info */}
        {can('config', 'update') && (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Informasi Koperasi</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nama Koperasi</Label>
                  <Input value={tenant?.name ?? ''} readOnly className="bg-muted" />
                </div>
                <div className="space-y-1.5">
                  <Label>Jenis</Label>
                  <Input value={tenant?.type ?? ''} readOnly className="bg-muted" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Alamat</Label>
                  <Input value={tenant?.address ?? ''} readOnly className="bg-muted" />
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Logo Koperasi</Label>
                <div className="flex items-start gap-4">
                  {logoPreview && (
                    <img src={logoPreview} alt="Logo" className="h-16 w-16 rounded-md border object-contain" />
                  )}
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-primary">
                      <Upload className="h-4 w-4" />
                      Pilih Logo (JPG, PNG, SVG — maks 2MB)
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/svg+xml"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); }
                        }}
                      />
                    </label>
                    {logoFile && (
                      <Button size="sm" onClick={handleLogoUpload}>Upload Logo</Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
