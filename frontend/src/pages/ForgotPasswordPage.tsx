import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { showAppAlert } from "../utils/alertConfig";
import "../pages_css/login.css";

const backendBaseUrl = String(
  import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.BACKEND_URL ||
    "http://localhost:8000"
).replace(/\/$/, "");

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim()) {
      showAppAlert({
        title: "Validation Error",
        text: "Please enter your email address.",
        type: "error",
        timer: 2200,
      });
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${backendBaseUrl}/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email:email }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || data.message || "Unable to send reset link.");
      }

      const successText = data.message || "Password reset link sent to your email.";

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

      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : "Unable to send reset link.";
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
              Recover Access.
              <br />
              <span>Reset safely.</span>
            </h1>
            <p>We’ll help you get back into your paper trading account quickly.</p>
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
            <span className="welcome">RESET PASSWORD</span>
            <h2>Forgot your password?</h2>
            <p>Enter your email and we’ll send a reset link.</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="field">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? "Sending link..." : "Send reset link"}
            </button>

            <p className="signup-text">
              Remember your password?&nbsp;
              <button type="button" onClick={() => navigate("/login")}>
                Login
              </button>
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
