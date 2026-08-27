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
import { RegulatoryReportsPage } from "@/pages/reports/RegulatoryReportsPage";
import { ProfilePage } from "@/pages/profile/ProfilePage";
import MemberLoginPage from "@/pages/member/MemberLoginPage";
import { MemberChangePasswordPage } from "@/pages/member/MemberChangePasswordPage";
import { MemberAppLayout } from "@/components/layout/MemberAppLayout";
import { MemberDashboardPage } from "@/pages/member/DashboardPage";
import { MemberSavingsPage } from "@/pages/member/SavingsPage";
import { MemberSavingDetailPage } from "@/pages/member/SavingDetailPage";
import { MemberLoansPage } from "@/pages/member/LoansPage";
import { MemberLoanDetailPage } from "@/pages/member/LoanDetailPage";
import { MemberProfilePage } from "@/pages/member/ProfilePage";

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/anggota/login" element={<MemberLoginPage />} />
          <Route path="/anggota/ganti-password" element={<MemberChangePasswordPage />} />
          <Route element={<MemberAppLayout />}>
            <Route path="/anggota/dashboard" element={<MemberDashboardPage />} />
            <Route path="/anggota/simpanan" element={<MemberSavingsPage />} />
            <Route path="/anggota/simpanan/:id" element={<MemberSavingDetailPage />} />
            <Route path="/anggota/pinjaman" element={<MemberLoansPage />} />
            <Route path="/anggota/pinjaman/:id" element={<MemberLoanDetailPage />} />
            <Route path="/anggota/profil" element={<MemberProfilePage />} />
          </Route>

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
            <Route path="/reports/regulatory" element={<RegulatoryReportsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
