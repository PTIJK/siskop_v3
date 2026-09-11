import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiPut, ApiRequestError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormError } from "@/components/shared/FormError";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { User } from "@siskop/types";

const profileSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  email: z.string().email("Email tidak valid")
});
type ProfileValues = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Password saat ini wajib diisi"),
    newPassword: z.string().min(8, "Password baru minimal 8 karakter"),
    confirmPassword: z.string().min(1, "Konfirmasi password wajib diisi")
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"]
  });
type PasswordValues = z.infer<typeof passwordSchema>;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ProfilePage() {
  const user = useAuth((s) => s.user);
  const updateUser = useAuth((s) => s.updateUser);
  const { toast } = useToast();

  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: user ? { name: user.name, email: user.email } : undefined
  });
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" }
  });

  const onSubmitProfile = async (values: ProfileValues) => {
    profileForm.clearErrors("root");
    try {
      const updated = await apiPut<User>("/auth/me", values);
      updateUser(updated);
      toast({ title: "Profil diperbarui" });
    } catch (err) {
      profileForm.setError("root", {
        message: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan"
      });
    }
  };

  const onSubmitPassword = async (values: PasswordValues) => {
    passwordForm.clearErrors("root");
    try {
      await apiPut("/auth/me/password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword
      });
      toast({ title: "Password berhasil diubah" });
      passwordForm.reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      passwordForm.setError("root", {
        message: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan"
      });
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Profil Saya" description="Kelola informasi akun dan password Anda" />

      <div className="flex items-center gap-4">
        <Avatar className="h-14 w-14">
          <AvatarFallback className="text-lg">{getInitials(user.name)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium">{user.name}</p>
          <p className="text-sm text-muted-foreground">{user.roleName}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informasi Profil</CardTitle>
            <CardDescription>Ubah nama tampilan dan alamat email Anda</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={profileForm.handleSubmit(onSubmitProfile)} className="space-y-4">
              {profileForm.formState.errors.root && <FormError error={profileForm.formState.errors.root.message} />}

              <div className="space-y-1.5">
                <Label>Nama *</Label>
                <Input {...profileForm.register("name")} />
                {profileForm.formState.errors.name && (
                  <p className="text-xs text-destructive">{profileForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" readOnly={!!user.authProvider} {...profileForm.register("email")} />
                {profileForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{profileForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={profileForm.formState.isSubmitting}>
                  {profileForm.formState.isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ubah Password</CardTitle>
            <CardDescription>Gunakan password yang kuat dan tidak dipakai di tempat lain</CardDescription>
          </CardHeader>
          <CardContent>
            {user.authProvider ? <p className="text-sm text-muted-foreground">
              {user.authProvider === "google.com" ? "Kata sandi akun Google dikelola melalui akun Google Anda." : <>Gunakan <Link className="underline" to="/login">Lupa kata sandi di halaman masuk</Link> untuk mengganti kata sandi.</>}
            </p> : <form onSubmit={passwordForm.handleSubmit(onSubmitPassword)} className="space-y-4">
              {passwordForm.formState.errors.root && (
                <FormError error={passwordForm.formState.errors.root.message} />
              )}

              <div className="space-y-1.5">
                <Label>Password Saat Ini *</Label>
                <Input type="password" {...passwordForm.register("currentPassword")} />
                {passwordForm.formState.errors.currentPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.currentPassword.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Password Baru *</Label>
                <Input type="password" {...passwordForm.register("newPassword")} />
                {passwordForm.formState.errors.newPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.newPassword.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Konfirmasi Password Baru *</Label>
                <Input type="password" {...passwordForm.register("confirmPassword")} />
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                  {passwordForm.formState.isSubmitting ? "Menyimpan..." : "Ubah Password"}
                </Button>
              </div>
            </form>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
