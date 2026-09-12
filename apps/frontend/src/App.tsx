import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { RequireMultiUnit } from "@/components/shared/RequireMultiUnit";
import { onboardingRoutes } from "@/features/onboarding/routes";
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const AppLayout = lazy(() =>
  import("@/components/layout/AppLayout").then((module) => ({ default: module.AppLayout }))
);
const DashboardPage = lazy(() =>
  import("@/pages/dashboard/DashboardPage").then((module) => ({ default: module.DashboardPage }))
);
const MembersPage = lazy(() =>
  import("@/pages/members/MembersPage").then((module) => ({ default: module.MembersPage }))
);
const MemberFormPage = lazy(() =>
  import("@/pages/members/MemberFormPage").then((module) => ({ default: module.MemberFormPage }))
);
const MemberDetailPage = lazy(() =>
  import("@/pages/members/MemberDetailPage").then((module) => ({ default: module.MemberDetailPage }))
);
const SavingsPage = lazy(() =>
  import("@/pages/savings/SavingsPage").then((module) => ({ default: module.SavingsPage }))
);
const NewSavingPage = lazy(() =>
  import("@/pages/savings/NewSavingPage").then((module) => ({ default: module.NewSavingPage }))
);
const SavingDetailPage = lazy(() =>
  import("@/pages/savings/SavingDetailPage").then((module) => ({ default: module.SavingDetailPage }))
);
const LoansDashboardPage = lazy(() =>
  import("@/pages/loans/LoansDashboardPage").then((module) => ({ default: module.LoansDashboardPage }))
);
const NewLoanPage = lazy(() =>
  import("@/pages/loans/NewLoanPage").then((module) => ({ default: module.NewLoanPage }))
);
const LoanDetailPage = lazy(() =>
  import("@/pages/loans/LoanDetailPage").then((module) => ({ default: module.LoanDetailPage }))
);
const OverduePage = lazy(() =>
  import("@/pages/loans/OverduePage").then((module) => ({ default: module.OverduePage }))
);
const PiutangAnggotaPage = lazy(() =>
  import("@/pages/piutang/PiutangAnggotaPage").then((module) => ({ default: module.PiutangAnggotaPage }))
);
const ConfigPage = lazy(() =>
  import("@/pages/config/ConfigPage").then((module) => ({ default: module.ConfigPage }))
);
const ProfilePage = lazy(() =>
  import("@/pages/profile/ProfilePage").then((module) => ({ default: module.ProfilePage }))
);
const ReportsPage = lazy(() =>
  import("@/pages/reports/ReportsPage").then((module) => ({ default: module.ReportsPage }))
);
const RegulatoryReportsPage = lazy(() =>
  import("@/pages/reports/RegulatoryReportsPage").then((module) => ({
    default: module.RegulatoryReportsPage
  }))
);
const PlatformTenantsPage = lazy(() =>
  import("@/pages/platform/PlatformTenantsPage").then((module) => ({ default: module.PlatformTenantsPage }))
);
const PlatformPackagesPage = lazy(() =>
  import("@/pages/platform/PlatformPackagesPage").then((module) => ({ default: module.PlatformPackagesPage }))
);
const PlatformAdminsPage = lazy(() =>
  import("@/pages/platform/PlatformAdminsPage").then((module) => ({ default: module.PlatformAdminsPage }))
);
const UnitsPage = lazy(() =>
  import("@/pages/ksu/UnitsPage").then((module) => ({ default: module.UnitsPage }))
);
const TokoPage = lazy(() =>
  import("@/pages/ksu/TokoPage").then((module) => ({ default: module.TokoPage }))
);
const ConsolidatedReportPage = lazy(() =>
  import("@/pages/ksu/ConsolidatedReportPage").then((module) => ({ default: module.ConsolidatedReportPage }))
);
const MemberStatementPage = lazy(() =>
  import("@/pages/ksu/MemberStatementPage").then((module) => ({ default: module.MemberStatementPage }))
);
const UnitLayout = lazy(() =>
  import("@/pages/ksu/UnitLayout").then((module) => ({ default: module.UnitLayout }))
);
const ProductsPage = lazy(() =>
  import("@/pages/konsumen/ProductsPage").then((module) => ({ default: module.ProductsPage }))
);
const StockPage = lazy(() =>
  import("@/pages/konsumen/StockPage").then((module) => ({ default: module.StockPage }))
);
const POSPage = lazy(() =>
  import("@/pages/konsumen/POSPage").then((module) => ({ default: module.POSPage }))
);
const PPOBPage = lazy(() =>
  import("@/pages/konsumen/PPOBPage").then((module) => ({ default: module.PPOBPage }))
);

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense
          fallback={
            <div role='status' className='p-8'>
              Memuat SISKOP…
            </div>
          }
        >
          <Routes>
            {onboardingRoutes(<LoginPage />)}

            <Route element={<AppLayout />}>
              <Route path='/dashboard' element={<DashboardPage />} />

              <Route path='/members' element={<MembersPage />} />
              <Route path='/members/new' element={<MemberFormPage />} />
              <Route path='/members/:id' element={<MemberDetailPage />} />
              <Route path='/members/:id/edit' element={<MemberFormPage />} />

              <Route path='/savings' element={<SavingsPage />} />
              <Route path='/savings/new' element={<NewSavingPage />} />
              <Route path='/savings/:id' element={<SavingDetailPage />} />

              {/* /loans/overdue and /loans/new must precede /loans/:id */}
              <Route path='/loans' element={<LoansDashboardPage />} />
              <Route path='/loans/overdue' element={<OverduePage />} />
              <Route path='/loans/new' element={<NewLoanPage />} />
              <Route path='/loans/:id' element={<LoanDetailPage />} />

              {/* Tenant-wide, not unit-scoped — see MemberCreditRepayment's
                  schema comment; same tier as /loans, not nested under
                  /ksu/units/:unitId even though the credit originates at the
                  Konsumen/Toko unit's POS. */}
              <Route path='/piutang' element={<PiutangAnggotaPage />} />

              <Route path='/reports' element={<ReportsPage />} />
              <Route path='/reports/regulatory' element={<RegulatoryReportsPage />} />

              <Route path='/config' element={<ConfigPage />} />
              <Route path='/profile' element={<ProfilePage />} />

              {/* KSU (multi-unit) routes — reachable only when the tenant has
                  2+ active CooperativeUnits (RequireMultiUnit reads the same
                  useIsMultiUnit() hook Sidebar.tsx uses for its nav items),
                  never based on a tenant "type". */}
              <Route
                path='/ksu/units'
                element={
                  <RequireMultiUnit>
                    <UnitsPage />
                  </RequireMultiUnit>
                }
              />
              {/* Not RequireMultiUnit-gated, unlike /ksu/units above: a
                  tenant whose only CooperativeUnit is a Toko still needs to
                  reach it, and gating on units.length > 1 here would strand
                  every single-unit Konsumen tenant with no nav path to their
                  own store (CLAUDE.md rule 2b — unit count is never a type
                  gate). See TokoPage.tsx and Sidebar.tsx's Unit Usaha tree. */}
              <Route path='/ksu/toko' element={<TokoPage />} />
              <Route
                path='/ksu/report'
                element={
                  <RequireMultiUnit>
                    <ConsolidatedReportPage />
                  </RequireMultiUnit>
                }
              />
              <Route
                path='/ksu/members/:memberId/statement'
                element={
                  <RequireMultiUnit>
                    <MemberStatementPage />
                  </RequireMultiUnit>
                }
              />

              {/* Per-unit detail shell — NOT gated by RequireMultiUnit: any
                  tenant with at least one unit can view that unit's own detail
                  page, single-unit or not. The KONSUMEN-type tab gate (Produk/
                  Stok only shown for a KONSUMEN-type unit) lives inside
                  UnitLayout itself, per-unit, a different axis from the
                  tenant-level isMultiUnit gate above. */}
              <Route path='/ksu/units/:unitId' element={<UnitLayout />}>
                <Route path='products' element={<ProductsPage />} />
                <Route path='stock' element={<StockPage />} />
                <Route path='pos' element={<POSPage />} />
                <Route path='ppob' element={<PPOBPage />} />
              </Route>

              <Route path='/platform/tenants' element={<PlatformTenantsPage />} />
              <Route path='/platform/packages' element={<PlatformPackagesPage />} />
              <Route path='/platform/admins' element={<PlatformAdminsPage />} />
            </Route>

            <Route path='*' element={<Navigate to='/' replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
