import { PasswordInput } from "@/components/shared/PasswordInput";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { LoginResponse } from "@siskop/types";
import { apiPost, ApiRequestError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { MemberAuthLayout } from "@/components/layout/MemberAuthLayout";
import { alertClass, inputClass, labelClass, primaryButtonClass } from "@/lib/ui";

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
      setError(err instanceof ApiRequestError ? err.message : "Tidak dapat terhubung ke server");
    } finally {
      setPending(false);
    }
  }

  return (
    <MemberAuthLayout
      title="Masuk"
      description={
        slug ? (
          <>
            Koperasi: <span className="font-bold text-foreground">{slug}</span>
          </>
        ) : (
          <span className="font-semibold text-warning">
            Gunakan alamat koperasi Anda, misalnya <span className="money">demo.localhost:3002</span>
          </span>
        )
      }
      footer={
        <>
          Anggota koperasi?{" "}
          <a href="/anggota/login" className="font-bold text-foreground underline underline-offset-2">
            Masuk di sini
          </a>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <label className={labelClass} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />

        <label className={`${labelClass} mt-4`} htmlFor="password">
          Kata sandi
        </label>
        <PasswordInput
          id="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />

        {error && (
          <p role="alert" className={`${alertClass} mt-4`}>
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className={`${primaryButtonClass} mt-6`}>
          {pending ? "Memproses…" : "Masuk"}
        </button>
      </form>
    </MemberAuthLayout>
  );
}
