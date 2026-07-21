import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { useToast } from '../../components/hooks/use-toast';
import { Upload, X } from 'lucide-react';

const memberSchema = z.object({
  fullName: z.string().min(2, 'Nama minimal 2 karakter'),
  nik: z.string().length(16, 'NIK harus 16 digit').regex(/^\d+$/, 'NIK hanya angka'),
  address: z.string().min(10, 'Alamat minimal 10 karakter'),
  birthPlace: z.string().min(2, 'Tempat lahir wajib diisi'),
  birthDate: z.string().min(1, 'Tanggal lahir wajib diisi'),
  occupation: z.string().min(2, 'Pekerjaan wajib diisi'),
});

type MemberForm = z.infer<typeof memberSchema>;

export function MemberFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const [apiError, setApiError] = useState('');
  const [ktpFile, setKtpFile] = useState<File | null>(null);
  const [ktpPreview, setKtpPreview] = useState<string | null>(null);
  const [memberInfo, setMemberInfo] = useState<{ memberId: string; accountNumber: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MemberForm>({ resolver: zodResolver(memberSchema) });

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/api/members/${id}`).then((res) => {
      const m = res.data.data;
      reset({
        fullName: m.fullName,
        nik: m.nik,
        address: m.address,
        birthPlace: m.birthPlace,
        birthDate: m.birthDate ? m.birthDate.split('T')[0] : '',
        occupation: m.occupation,
      });
      setMemberInfo({ memberId: m.memberId, accountNumber: m.accountNumber });
      if (m.ktpUrl) setKtpPreview(m.ktpUrl);
    });
  }, [id, isEdit]);

  const handleKtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setKtpFile(file);
    setKtpPreview(URL.createObjectURL(file));
  };

  const onSubmit = async (data: MemberForm) => {
    setApiError('');
    try {
      let memberId = id;
      if (isEdit) {
        await api.put(`/api/members/${id}`, data);
        toast({ title: 'Data anggota berhasil diperbarui' });
      } else {
        const res = await api.post('/api/members', data);
        memberId = res.data.data.id;
        toast({ title: 'Anggota berhasil ditambahkan' });
      }

      if (ktpFile && memberId) {
        const form = new FormData();
        form.append('ktp', ktpFile);
        await api.post(`/api/members/${memberId}/upload-ktp`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      navigate(`/members/${memberId}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Terjadi kesalahan');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? 'Edit Anggota' : 'Tambah Anggota'}
        breadcrumb={[
          { label: 'Anggota', href: '/members' },
          { label: isEdit ? 'Edit' : 'Tambah' },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Pribadi</CardTitle>
          {memberInfo && (
            <div className="flex gap-3 pt-1">
              <Badge variant="outline">ID: {memberInfo.memberId}</Badge>
              <Badge variant="outline">No. Rek: {memberInfo.accountNumber}</Badge>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {apiError && <FormError error={apiError} />}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nama Lengkap *</Label>
                <Input placeholder="Budi Santoso" {...register('fullName')} />
                {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>NIK (16 digit) *</Label>
                <Input placeholder="3201234567890123" maxLength={16} {...register('nik')} />
                {errors.nik && <p className="text-xs text-destructive">{errors.nik.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Pekerjaan *</Label>
                <Input placeholder="Pedagang" {...register('occupation')} />
                {errors.occupation && <p className="text-xs text-destructive">{errors.occupation.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Tempat Lahir *</Label>
                <Input placeholder="Jakarta" {...register('birthPlace')} />
                {errors.birthPlace && <p className="text-xs text-destructive">{errors.birthPlace.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Tanggal Lahir *</Label>
                <Input type="date" {...register('birthDate')} />
                {errors.birthDate && <p className="text-xs text-destructive">{errors.birthDate.message}</p>}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>Alamat *</Label>
                <Textarea placeholder="Jl. Merdeka No. 1, RT 01/RW 02, Jakarta" rows={3} {...register('address')} />
                {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>Foto KTP (opsional)</Label>
                <div className="flex items-start gap-4">
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary">
                    <Upload className="h-4 w-4" />
                    Pilih file (JPG, PNG, PDF — maks 2MB)
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      onChange={handleKtpChange}
                    />
                  </label>
                  {ktpPreview && (
                    <div className="relative">
                      <img src={ktpPreview} alt="KTP" className="h-20 w-32 rounded-md border object-cover" />
                      <button
                        type="button"
                        onClick={() => { setKtpFile(null); setKtpPreview(null); }}
                        className="absolute -right-2 -top-2 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Batal
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Menyimpan...' : isEdit ? 'Perbarui' : 'Simpan'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
