import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../stores/authStore';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { FormError } from '../../components/shared/FormError';
import { Building2, Eye, EyeOff } from 'lucide-react';
import { TenantType } from '@siskop/shared';

const loginSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi'),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const tenant = useAuthStore((s) => s.tenant);
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginForm) => {
    setApiError('');
    try {
      await login(data.email, data.password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setApiError(axiosErr?.response?.data?.error?.message ?? 'Login gagal. Periksa email dan password Anda.');
    }
  };

  const subdomain = window.location.hostname.split('.')[0];
  const isLocalhost = window.location.hostname === 'localhost';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg">
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">SISKOP</h1>
          <p className="text-sm text-muted-foreground">Sistem Informasi Koperasi</p>
        </div>

        <Card className="shadow-md">
          <CardHeader className="pb-2">
            {!isLocalhost && subdomain && (
              <div className="mb-3 flex items-center justify-center">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary uppercase tracking-wider">
                  {subdomain}
                </span>
              </div>
            )}
            <h2 className="text-center text-lg font-semibold">Masuk ke Akun Anda</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {apiError && <FormError error={apiError} />}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@koperasi.com"
                  autoComplete="email"
                  {...register('email')}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="pr-10"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Memproses...' : 'Masuk'}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              Belum punya koperasi?{' '}
              <Link to="/register" className="font-medium text-primary hover:underline">
                Daftarkan sekarang
              </Link>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} SISKOP. Hak cipta dilindungi.
        </p>
      </div>
    </div>
  );
}
