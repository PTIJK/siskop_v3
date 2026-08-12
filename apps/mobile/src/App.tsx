import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import LoginPage from "@/pages/LoginPage";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { MembersPage } from "@/pages/members/MembersPage";
import { MemberDetailPage } from "@/pages/members/MemberDetailPage";
import { SavingsPage } from "@/pages/savings/SavingsPage";
import { SavingDetailPage } from "@/pages/savings/SavingDetailPage";
import { LoansDashboardPage } from "@/pages/loans/LoansDashboardPage";
import { LoanDetailPage } from "@/pages/loans/LoanDetailPage";
import { OverduePage } from "@/pages/loans/OverduePage";
import { ReportsPage } from "@/pages/reports/ReportsPage";

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
            <Route path="/members/:id" element={<MemberDetailPage />} />

            <Route path="/savings" element={<SavingsPage />} />
            <Route path="/savings/:id" element={<SavingDetailPage />} />

            <Route path="/loans" element={<LoansDashboardPage />} />
            <Route path="/loans/overdue" element={<OverduePage />} />
            <Route path="/loans/:id" element={<LoanDetailPage />} />

            <Route path="/reports" element={<ReportsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
