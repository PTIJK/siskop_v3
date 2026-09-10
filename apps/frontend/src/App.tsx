import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import LoginPage from "@/pages/LoginPage";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { MembersPage } from "@/pages/members/MembersPage";
import { MemberFormPage } from "@/pages/members/MemberFormPage";
import { MemberDetailPage } from "@/pages/members/MemberDetailPage";
import { SavingsPage } from "@/pages/savings/SavingsPage";
import { NewSavingPage } from "@/pages/savings/NewSavingPage";
import { SavingDetailPage } from "@/pages/savings/SavingDetailPage";
import { LoansDashboardPage } from "@/pages/loans/LoansDashboardPage";
import { NewLoanPage } from "@/pages/loans/NewLoanPage";
import { LoanDetailPage } from "@/pages/loans/LoanDetailPage";
import { OverduePage } from "@/pages/loans/OverduePage";
import { ConfigPage } from "@/pages/config/ConfigPage";
import { ProfilePage } from "@/pages/profile/ProfilePage";
import { ReportsPage } from "@/pages/reports/ReportsPage";
import { RegulatoryReportsPage } from "@/pages/reports/RegulatoryReportsPage";
import { PlatformTenantsPage } from "@/pages/platform/PlatformTenantsPage";
import { PlatformPackagesPage } from "@/pages/platform/PlatformPackagesPage";
import { PlatformAdminsPage } from "@/pages/platform/PlatformAdminsPage";
import { UnitsPage } from "@/pages/ksu/UnitsPage";
import { ConsolidatedReportPage } from "@/pages/ksu/ConsolidatedReportPage";
import { MemberStatementPage } from "@/pages/ksu/MemberStatementPage";
import { RequireMultiUnit } from "@/components/shared/RequireMultiUnit";

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />

            <Route path="/members" element={<MembersPage />} />
            <Route path="/members/new" element={<MemberFormPage />} />
            <Route path="/members/:id" element={<MemberDetailPage />} />
            <Route path="/members/:id/edit" element={<MemberFormPage />} />

            <Route path="/savings" element={<SavingsPage />} />
            <Route path="/savings/new" element={<NewSavingPage />} />
            <Route path="/savings/:id" element={<SavingDetailPage />} />

            {/* /loans/overdue and /loans/new must precede /loans/:id */}
            <Route path="/loans" element={<LoansDashboardPage />} />
            <Route path="/loans/overdue" element={<OverduePage />} />
            <Route path="/loans/new" element={<NewLoanPage />} />
            <Route path="/loans/:id" element={<LoanDetailPage />} />

            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/regulatory" element={<RegulatoryReportsPage />} />

            <Route path="/config" element={<ConfigPage />} />
            <Route path="/profile" element={<ProfilePage />} />

            {/* KSU (multi-unit) routes — reachable only when the tenant has
                2+ active CooperativeUnits (RequireMultiUnit reads the same
                useIsMultiUnit() hook Sidebar.tsx uses for its nav items),
                never based on a tenant "type". */}
            <Route
              path="/ksu/units"
              element={
                <RequireMultiUnit>
                  <UnitsPage />
                </RequireMultiUnit>
              }
            />
            <Route
              path="/ksu/report"
              element={
                <RequireMultiUnit>
                  <ConsolidatedReportPage />
                </RequireMultiUnit>
              }
            />
            <Route
              path="/ksu/members/:memberId/statement"
              element={
                <RequireMultiUnit>
                  <MemberStatementPage />
                </RequireMultiUnit>
              }
            />

            <Route path="/platform/tenants" element={<PlatformTenantsPage />} />
            <Route path="/platform/packages" element={<PlatformPackagesPage />} />
            <Route path="/platform/admins" element={<PlatformAdminsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
