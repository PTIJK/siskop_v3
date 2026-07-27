import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/stores/auth";

interface Health {
  status: string;
  timestamp: string;
}

export default function HomePage() {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<Health>("/health")
  });

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">SISKOP</h1>
            <p className="mt-1 text-slate-600">Sistem Informasi Koperasi Berbasis SaaS</p>
          </div>
          {user && (
            <button
              onClick={clear}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              Keluar
            </button>
          )}
        </div>

        {user && (
          <p className="mt-2 text-sm text-slate-600">
            Masuk sebagai <span className="font-medium">{user.name}</span> ({user.role})
          </p>
        )}

        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Backend status
          </h2>
          {isLoading && <p className="mt-2 text-slate-600">Checking…</p>}
          {isError && <p className="mt-2 text-red-600">Backend unreachable</p>}
          {data && (
            <p className="mt-2 text-emerald-700">
              {data.status} · {new Date(data.timestamp).toLocaleString("id-ID")}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
