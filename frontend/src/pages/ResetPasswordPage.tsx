import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { showAppAlert } from "../utils/alertConfig";
import { setStoredAuthToken } from "../utils/authUtils";
import "../pages_css/login.css";

const backendBaseUrl = String(
  import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.BACKEND_URL ||
    "http://localhost:8000"
).replace(/\/$/, "");

export default function ResetPasswordPage({ onAuthSuccess }: { readonly onAuthSuccess?: () => void }) {
  const navigate = useNavigate();
  const resetTokens = (() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (!hash) {
      return { accessToken: "", refreshToken: "" };
    }

    const params = new URLSearchParams(hash);
    return {
      accessToken: params.get("access_token") || "",
      refreshToken: params.get("refresh_token") || "",
    };
  })();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (!hash) {
      return;
    }

    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token") || "";
    const refreshToken = params.get("refresh_token") || "";

    if (!accessToken && !refreshToken) {
      return;
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.hash = "";
    window.history.replaceState({}, "", cleanUrl.toString());
  }, []);
  const saveAuthToken = (token: string, refreshToken?: string) => {
    setStoredAuthToken(token, refreshToken);
    onAuthSuccess?.();
  };

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();

    if (!resetTokens.accessToken || !resetTokens.refreshToken) {
      showAppAlert({
        title: "Error",
        text: "Reset token is missing. Please use the link from your email.",
        type: "error",
        timer: 2200,
      });
      return;
    }

    if (!password.trim()) {
      showAppAlert({
        title: "Validation Error",
        text: "Please enter a new password.",
        type: "error",
        timer: 2200,
      });
      return;
    }

    if (password !== confirmPassword) {
      showAppAlert({
        title: "Validation Error",
        text: "Passwords do not match.",
        type: "error",
        timer: 2200,
      });
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${backendBaseUrl}/auth/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          access_token: resetTokens.accessToken,
          refresh_token: resetTokens.refreshToken,
          new_password: password,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || data.message || "Unable to reset password.");
      }

      const successText = data.message || "Password updated successfully.";
      const token = data.token || data.access_token || data.refresh_token;
      saveAuthToken(token, data.refresh_token);

      showAppAlert({
        title: "Success",
        text: successText,
        type: "success",
        timer: 2400,
      });

      window.sessionStorage.setItem(
        "auth_notice",
        JSON.stringify({ text: successText, type: "success" })
      );

      setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : "Unable to reset password.";
      showAppAlert({
        title: "Error",
        text: errMessage,
        type: "error",
        timer: 2400,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="brand-section">
        <div className="brand-glow glow-one" />
        <div className="brand-glow glow-two" />

        <div className="brand-content">
          <div className="logo-wrapper">
            <img src="/logos/Tradenova_Dark.png" alt="Tradonova" className="logo" />
          </div>

          <div className="brand-message">
            <span className="eyebrow">SECURE ACCESS</span>
            <h1>
              Start Fresh.
              <br />
              <span>Set a strong password.</span>
            </h1>
            <p>Choose a secure password to protect your trading account.</p>
          </div>
        </div>
      </section>

      <section className="form-section">
        <div className="form-container">
          <div className="form-topbar">
            <button type="button" className="back-button" onClick={() => navigate("/login")}>
              <span aria-hidden="true">←</span> Back
            </button>
          </div>

          <div className="mobile-logo">
            <img src="/logos/Tradenova_Dark.png" alt="Tradonova" className="logo" />
          </div>

          <div className="login-heading">
            <span className="welcome">NEW PASSWORD</span>
            <h2>Set a new password</h2>
            <p>Create a new secure password for your account.</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                placeholder="Enter your new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-reset-password">Confirm password</label>
              <input
                id="confirm-reset-password"
                type="password"
                placeholder="Confirm your new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? "Updating password..." : "Update password"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
