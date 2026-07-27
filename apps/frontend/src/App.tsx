import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";

interface Health {
  status: string;
  timestamp: string;
}

export default function App() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<Health>("/health")
  });

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold text-slate-900">SISKOP</h1>
        <p className="mt-1 text-slate-600">Sistem Informasi Koperasi Berbasis SaaS</p>

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
