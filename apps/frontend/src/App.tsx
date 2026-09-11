import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
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

              <Route path='/reports' element={<ReportsPage />} />
              <Route path='/reports/regulatory' element={<RegulatoryReportsPage />} />

              <Route path='/config' element={<ConfigPage />} />
              <Route path='/profile' element={<ProfilePage />} />

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
