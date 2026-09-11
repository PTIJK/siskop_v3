import { lazy, type ReactNode } from "react";
import { Navigate, Route } from "react-router-dom";
import { workspaceSlug } from "./workspace";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const ResumePage = lazy(() =>
  import("./pages/CheckoutPage").then((module) => ({ default: module.ResumePage }))
);
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
      <Route path='/checkout' element={<CheckoutPage />} />
      <Route path='/checkout/resume' element={<AuthPage resume />} />
      <Route path='/checkout/legacy' element={<ResumePage />} />
      <Route path='/login' element={<AuthPage />} />
      <Route path='/login/legacy' element={tenantHost ? tenantLogin : <WorkspaceEntry />} />
    </>
  );
}
