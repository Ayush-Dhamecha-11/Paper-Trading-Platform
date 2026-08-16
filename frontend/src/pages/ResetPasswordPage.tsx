import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../pages_css/login.css";

const backendBaseUrl = String(
  import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.BACKEND_URL ||
    "http://localhost:8000"
).replace(/\/$/, "");

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (!token) {
      setMessage({ text: "Reset token is missing. Please use the link from your email.", type: "error" });
      return;
    }

    if (!password.trim()) {
      setMessage({ text: "Please enter a new password.", type: "error" });
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ text: "Passwords do not match.", type: "error" });
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
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || data.message || "Unable to reset password.");
      }

      const successText = data.message || "Password updated successfully.";
      setMessage({ text: successText, type: "success" });

      window.sessionStorage.setItem(
        "auth_notice",
        JSON.stringify({ text: successText, type: "success" })
      );

      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : "Unable to reset password.";
      setMessage({ text: errMessage, type: "error" });
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

            {message && (
              <div className={`toast-message ${message.type}`} role="status" aria-live="polite">
                {message.text}
              </div>
            )}

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? "Updating password..." : "Update password"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
