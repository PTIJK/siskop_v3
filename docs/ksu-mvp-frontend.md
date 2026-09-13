# KSU MVP — Frontend Development Plan

> **Prereq:** Backend complete — `POST/GET /api/ksu/units`, `GET /api/reports/ksu/consolidated`,
> `GET /api/ksu/members/:id/statement` all live and tested per the backend spike plan.

**Goal:** Give a KSU tenant (Toko + KSP) three screens — manage units, view the consolidated
report, and view a member's per-unit SHU statement — while a single-unit tenant never sees
any of this UI at all.

**Architecture:** New `pages/ksu/` route group, gated by `tenant.isMultiUnit` from the existing
auth/session context. Server state via TanStack Query (matches existing `App.tsx` pattern),
no new global store needed — units/reports aren't client-side state, they're server data.

**Tech Stack:** React 18, Vite, TanStack Query, react-router-dom, Tailwind, lucide-react
(matches `ENGINEER-ONBOARDING.md` / scaffolding conventions — no new dependencies).

---

## Day 1: API client + Units page + Consolidated report page

**Files:**
- Create: `apps/frontend/src/api/ksu.ts`
- Create: `apps/frontend/src/pages/ksu/UnitsPage.tsx`
- Create: `apps/frontend/src/pages/ksu/ConsolidatedReportPage.tsx`
- Create: `apps/frontend/src/components/ksu/UnitCard.tsx`
- Create: `apps/frontend/src/components/ksu/CreateUnitDialog.tsx`
- Test: `apps/frontend/src/pages/ksu/UnitsPage.test.tsx`

**Tasks:**

- [ ] Create `api/ksu.ts` — typed wrappers over the existing `apiFetch<T>` client:

```typescript
// apps/frontend/src/api/ksu.ts
import { apiFetch } from "./client";

export interface Unit {
  id: string;
  name: string;
  unitType: "KSP" | "KONSUMEN" | "PRODUSEN" | "JASA" | "PEMASARAN";
  isActive: boolean;
}

export interface ConsolidatedReport {
  totalAssets: string;
  byUnit: { unitId: string; unitName: string; assets: string }[];
}

export function getUnits() {
  return apiFetch<Unit[]>("/api/ksu/units");
}

export function createUnit(input: { name: string; unitType: Unit["unitType"] }) {
  return apiFetch<Unit>("/api/ksu/units", { method: "POST", body: JSON.stringify(input) });
}

export function getConsolidatedReport() {
  return apiFetch<ConsolidatedReport>("/api/reports/ksu/consolidated");
}
```

- [ ] Write the failing test for `UnitsPage`:

```tsx
// apps/frontend/src/pages/ksu/UnitsPage.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UnitsPage from "./UnitsPage";
import * as ksuApi from "@/api/ksu";

test("renders both units after loading", async () => {
  vi.spyOn(ksuApi, "getUnits").mockResolvedValue([
    { id: "1", name: "Simpan Pinjam", unitType: "KSP", isActive: true },
    { id: "2", name: "Toko", unitType: "KONSUMEN", isActive: true },
  ]);
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <UnitsPage />
    </QueryClientProvider>
  );
  await waitFor(() => {
    expect(screen.getByText("Simpan Pinjam")).toBeInTheDocument();
    expect(screen.getByText("Toko")).toBeInTheDocument();
  });
});
```

- [ ] Run: `pnpm --filter @siskop/frontend test UnitsPage` — expected FAIL (component doesn't exist yet).

- [ ] Implement `components/ksu/UnitCard.tsx`:

```tsx
import { Unit } from "@/api/ksu";
import { Store, Landmark, Wheat, Handshake, Truck } from "lucide-react";

const ICONS: Record<Unit["unitType"], typeof Store> = {
  KSP: Landmark, KONSUMEN: Store, PRODUSEN: Wheat, JASA: Handshake, PEMASARAN: Truck,
};

export function UnitCard({ unit }: { unit: Unit }) {
  const Icon = ICONS[unit.unitType];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <Icon className="h-6 w-6 text-[#002FA7]" />
      <div>
        <p className="font-medium text-slate-900">{unit.name}</p>
        <p className="text-sm text-slate-500">{unit.unitType}</p>
      </div>
    </div>
  );
}
```

- [ ] Implement `components/ksu/CreateUnitDialog.tsx` (simple modal, no form library needed
      for two fields — controlled inputs + `useMutation`):

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createUnit, Unit } from "@/api/ksu";

export function CreateUnitDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState<Unit["unitType"]>("KSP");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createUnit({ name, unitType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ksu-units"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-sm rounded-lg bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Tambah Unit</h2>
        <input
          className="mt-4 w-full rounded border border-slate-300 p-2"
          placeholder="Nama unit (mis. Toko)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="mt-2 w-full rounded border border-slate-300 p-2"
          value={unitType}
          onChange={(e) => setUnitType(e.target.value as Unit["unitType"])}
        >
          <option value="KSP">KSP — Simpan Pinjam</option>
          <option value="KONSUMEN">Konsumen — Toko</option>
          <option value="PRODUSEN">Produsen</option>
          <option value="JASA">Jasa</option>
          <option value="PEMASARAN">Pemasaran</option>
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-slate-600">Batal</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || mutation.isPending}
            className="rounded bg-[#002FA7] px-3 py-1.5 text-white disabled:opacity-50"
          >
            {mutation.isPending ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] Implement `pages/ksu/UnitsPage.tsx`:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUnits } from "@/api/ksu";
import { UnitCard } from "@/components/ksu/UnitCard";
import { CreateUnitDialog } from "@/components/ksu/CreateUnitDialog";

export default function UnitsPage() {
  const [showDialog, setShowDialog] = useState(false);
  const { data: units, isLoading } = useQuery({ queryKey: ["ksu-units"], queryFn: getUnits });

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Unit Usaha</h1>
        <button
          onClick={() => setShowDialog(true)}
          className="rounded bg-[#002FA7] px-4 py-2 text-white"
        >
          + Tambah Unit
        </button>
      </div>

      {isLoading && <p className="mt-6 text-slate-500">Memuat…</p>}

      <div className="mt-6 grid gap-3">
        {units?.map((u) => <UnitCard key={u.id} unit={u} />)}
      </div>

      {showDialog && <CreateUnitDialog onClose={() => setShowDialog(false)} />}
    </div>
  );
}
```

- [ ] Run test — expected PASS.

- [ ] Commit: `git commit -m "feat(frontend): units management page for KSU tenants"`

- [ ] Implement `pages/ksu/ConsolidatedReportPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { getConsolidatedReport } from "@/api/ksu";
import { formatRupiah } from "@siskop/shared";

export default function ConsolidatedReportPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["ksu-consolidated-report"],
    queryFn: getConsolidatedReport,
  });

  if (isLoading) return <p className="p-8 text-slate-500">Memuat laporan…</p>;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Laporan Konsolidasi</h1>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-sm uppercase tracking-wide text-slate-500">Total Aset (Konsolidasi)</p>
        <p className="mt-1 text-3xl font-semibold text-[#002FA7]">
          {formatRupiah(data.totalAssets)}
        </p>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-slate-500">
        Rincian per Unit
      </h2>
      <div className="mt-3 grid gap-3">
        {data.byUnit.map((u) => (
          <div key={u.unitId} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
            <span className="font-medium text-slate-900">{u.unitName}</span>
            <span className="text-slate-700">{formatRupiah(u.assets)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] Manual verify: `pnpm --filter @siskop/frontend dev`, log in as the seeded KSU demo
      tenant, confirm both units and the consolidated total render with real seed data.

- [ ] Commit: `git commit -m "feat(frontend): consolidated report page with per-unit breakdown"`

---

## Day 2: Member statement page + routing gate + regression

**Files:**
- Create: `apps/frontend/src/pages/ksu/MemberStatementPage.tsx`
- Modify: `apps/frontend/src/api/ksu.ts` (add `getMemberStatement`)
- Modify: `apps/frontend/src/App.tsx` (or router config file) — add gated routes
- Modify: nav/sidebar component — conditionally show "Unit Usaha" / "Laporan Konsolidasi" links
- Test: `apps/frontend/src/pages/ksu/MemberStatementPage.test.tsx`
- Test: routing gate test

**Tasks:**

- [ ] Add to `api/ksu.ts`:

```typescript
export interface MemberUnitStatement {
  units: { unitId: string; unitName: string; shu: string }[];
}

export function getMemberStatement(memberId: string) {
  return apiFetch<MemberUnitStatement>(`/api/ksu/members/${memberId}/statement`);
}
```

- [ ] Write failing test for `MemberStatementPage` (same pattern as Day 1 — mock the API,
      render, assert both units' SHU values appear).

- [ ] Implement `MemberStatementPage.tsx` — same structure as `ConsolidatedReportPage`,
      reading `memberId` from route params (`useParams()`), listing `unit.name` + `formatRupiah(shu)`
      per row.

- [ ] Run test — expected PASS. Commit: `git commit -m "feat(frontend): per-unit member SHU statement page"`

- [ ] **Routing gate** — add to router config:

```tsx
{tenant.isMultiUnit && (
  <>
    <Route path="/ksu/units" element={<UnitsPage />} />
    <Route path="/ksu/report" element={<ConsolidatedReportPage />} />
    <Route path="/ksu/members/:memberId/statement" element={<MemberStatementPage />} />
  </>
)}
```

- [ ] Write the gate test:

```tsx
test("KSU routes are not rendered for single-unit tenant", () => {
  renderAppWithTenant({ isMultiUnit: false });
  expect(screen.queryByText("Unit Usaha")).not.toBeInTheDocument();
});

test("KSU routes appear for multi-unit tenant", () => {
  renderAppWithTenant({ isMultiUnit: true });
  expect(screen.getByText("Unit Usaha")).toBeInTheDocument();
});
```

- [ ] Update the sidebar/nav component to conditionally render the "Unit Usaha" and
      "Laporan Konsolidasi" links based on `tenant.isMultiUnit` from session context —
      same source of truth the router gate uses, so nav and routes can never disagree.

- [ ] Run both tests — expected PASS.

- [ ] **Full regression:** `pnpm --filter @siskop/frontend test` — expected 100% pass,
      no existing test file modified.

- [ ] Manual verify: log in as a single-unit KSP tenant fixture, confirm zero KSU UI is
      visible anywhere (sidebar, direct URL navigation to `/ksu/units` should redirect or 404,
      not render).

- [ ] Commit: `git commit -m "feat(frontend): gate KSU routes and nav on tenant.isMultiUnit"`

---

## End-of-plan acceptance checklist

- [ ] Units page lists existing units and can create a new one
- [ ] Consolidated report page shows total assets + per-unit breakdown, using `formatRupiah`
- [ ] Member statement page shows per-unit SHU breakdown
- [ ] None of the above is reachable (nav or direct URL) for a single-unit tenant
- [ ] Full existing frontend test suite passes unmodified
- [ ] Manual smoke test against the seeded KSU demo tenant confirms real data renders correctly
