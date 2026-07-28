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
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
