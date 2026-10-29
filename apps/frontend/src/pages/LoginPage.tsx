import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import type { LoginResponse } from "@siskop/types";
import { apiPost, ApiRequestError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The tenant subdomain, shown so the user can see which koperasi they are signing in to. */
function currentSlug(): string | null {
  const [first, ...rest] = window.location.hostname.split(".");
  return rest.length > 0 && first ? first : null;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const slug = currentSlug();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const session = await apiPost<LoginResponse>("/auth/login", { email, password });
      setSession(session);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Tidak dapat terhubung ke server"
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.02em]">Masuk</h1>
      {slug ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Koperasi: <span className="font-bold text-foreground">{slug}</span>
        </p>
      ) : (
        // Without a subdomain the backend cannot identify the tenant, so say
        // so here rather than letting the user fail on submit.
        <p className="mt-1 text-sm font-semibold text-warning">
          Gunakan alamat koperasi Anda, misalnya <span className="font-mono">demo.localhost:3000</span>
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Kata sandi</Label>
          <Input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-[10px] bg-destructive/[0.13] p-3 text-sm font-semibold text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" loading={pending}>
          {pending ? "Memproses…" : "Masuk"}
        </Button>
      </form>
    </AuthLayout>
  );
}
