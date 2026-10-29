import { lazy, type ReactNode } from "react";
import { Navigate, Route } from "react-router-dom";
import { workspaceSlug } from "./workspace";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const StatusPage = lazy(() => import("./pages/StatusPage"));
const WorkspaceEntry = lazy(() =>
  import("./components/WorkspaceEntry").then((module) => ({ default: module.WorkspaceEntry }))
);
const AuthPage = lazy(() => import("./pages/AuthPage"));

/** The single router integration point. Pass the existing tenant login unchanged. */
export function onboardingRoutes(tenantLogin: ReactNode) {
  const tenantHost = workspaceSlug() !== null;
  return (
    <>
      <Route path='/' element={tenantHost ? <Navigate to='/dashboard' replace /> : <LandingPage />} />
      <Route path='/register' element={<RegisterPage />} />
      {/* Registration status: the invoice to pay, or "active" for a free koperasi. */}
      <Route path='/checkout' element={<StatusPage />} />
      <Route path='/checkout/resume' element={<AuthPage resume />} />
      <Route path='/login' element={<AuthPage />} />
      <Route path='/login/legacy' element={tenantHost ? tenantLogin : <WorkspaceEntry />} />
    </>
  );
}
