import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { hasStoredAuth, startSilentSessionRefresh } from "./utils/authUtils";
import LoginPage from "./pages/login.tsx";
import SignupPage from "./pages/signup.tsx";
import DashboardPage from "./pages/dashboard.tsx";
import AnalyticsPage from "./pages/analytics.tsx";
import NotFoundPage from "./pages/not-found.tsx";
import AuthCallbackPage from "./pages/AuthCallbackPage.tsx";
import GoogleCallbackPage from "./pages/GoogleCallbackPage.tsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.tsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.tsx";
import ProfilePage from "./pages/ProfilePage.tsx";
import PortfolioPage from "./pages/portfolio.tsx";

function DashboardGate({ isAuthenticated }: { readonly isAuthenticated: boolean }) {
  const location = useLocation();
  const hasCode = new URLSearchParams(location.search).get("code");

  if (hasCode) {
    return <GoogleCallbackPage />;
  }

  return isAuthenticated ? <DashboardPage /> : <Navigate to="/login" replace />;
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => hasStoredAuth());

  useEffect(() => {
    const handleAuthSuccess = () => {
      setIsAuthenticated(hasStoredAuth());
    };

    window.addEventListener("auth-success", handleAuthSuccess);
    return () => window.removeEventListener("auth-success", handleAuthSuccess);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    return startSilentSessionRefresh();
  }, [isAuthenticated]);

  return (
    <Routes>
      <Route
        path="/"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <LoginPage onAuthSuccess={() => setIsAuthenticated(true)} />
          )
        }
      />
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <LoginPage onAuthSuccess={() => setIsAuthenticated(true)} />
          )
        }
      />
      <Route
        path="/signup"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <SignupPage onAuthSuccess={() => setIsAuthenticated(true)} />
          )
        }
      />
      <Route path="/register/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
      <Route path="/google/callback" element={<GoogleCallbackPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/profile" element={isAuthenticated ? <ProfilePage /> : <Navigate to="/login" replace />} />
      <Route path="/dashboard" element={<DashboardGate isAuthenticated={isAuthenticated} />} />
      <Route path="/analytics" element={isAuthenticated ? <AnalyticsPage /> : <Navigate to="/login" replace />} />
      <Route path="/portfolio" element={isAuthenticated ? <PortfolioPage /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
