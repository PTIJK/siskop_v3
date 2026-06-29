import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ErrorBoundary } from './components/shared/ErrorBoundary';

import { LoginPage } from './pages/auth/LoginPage';
import { RegisterTenantPage } from './pages/auth/RegisterTenantPage';

import { DashboardPage } from './pages/dashboard/DashboardPage';

import { MembersPage } from './pages/members/MembersPage';
import { MemberFormPage } from './pages/members/MemberFormPage';
import { MemberDetailPage } from './pages/members/MemberDetailPage';

import { SavingsPage } from './pages/savings/SavingsPage';
import { NewSavingPage } from './pages/savings/NewSavingPage';
import { SavingDetailPage } from './pages/savings/SavingDetailPage';

import { LoansDashboardPage } from './pages/loans/LoansDashboardPage';
import { NewLoanPage } from './pages/loans/NewLoanPage';
import { LoanDetailPage } from './pages/loans/LoanDetailPage';
import { OverduePage } from './pages/loans/OverduePage';

import { ReportsPage } from './pages/reports/ReportsPage';

import { ProfilePage } from './pages/config/ProfilePage';
import { UsersPage } from './pages/config/UsersPage';
import { RolesPage } from './pages/config/RolesPage';
import { SavingConfigPage } from './pages/config/SavingConfigPage';
import { LoanConfigPage } from './pages/config/LoanConfigPage';

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterTenantPage />} />

        {/* Protected routes — all under AppLayout */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* Members */}
          <Route path="/members" element={<MembersPage />} />
          <Route path="/members/new" element={<MemberFormPage />} />
          <Route path="/members/:id" element={<MemberDetailPage />} />
          <Route path="/members/:id/edit" element={<MemberFormPage />} />

          {/* Savings */}
          <Route path="/savings" element={<SavingsPage />} />
          <Route path="/savings/new" element={<NewSavingPage />} />
          <Route path="/savings/:id" element={<SavingDetailPage />} />

          {/* Loans */}
          <Route path="/loans" element={<LoansDashboardPage />} />
          <Route path="/loans/new" element={<NewLoanPage />} />
          <Route path="/loans/overdue" element={<OverduePage />} />
          <Route path="/loans/:id" element={<LoanDetailPage />} />

          {/* Reports */}
          <Route path="/reports" element={<ReportsPage />} />

          {/* Config */}
          <Route path="/config/profile" element={<ProfilePage />} />
          <Route path="/config/users" element={<UsersPage />} />
          <Route path="/config/roles" element={<RolesPage />} />
          <Route path="/config/savings" element={<SavingConfigPage />} />
          <Route path="/config/loans" element={<LoanConfigPage />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
