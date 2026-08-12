import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/login.tsx";
import SignupPage from "./pages/signup.tsx";
import DashboardPage from "./pages/dashboard.tsx";
import NotFoundPage from "./pages/not-found.tsx";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return Boolean(localStorage.getItem("auth_token"));
  });

  useEffect(() => {
    const handleAuthSuccess = () => {
      setIsAuthenticated(Boolean(localStorage.getItem("auth_token")));
    };

    window.addEventListener("auth-success", handleAuthSuccess);
    return () => window.removeEventListener("auth-success", handleAuthSuccess);
  }, []);

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
      <Route
        path="/dashboard"
        element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
