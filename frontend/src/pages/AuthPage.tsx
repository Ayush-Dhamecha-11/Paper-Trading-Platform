import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import "../pages_css/login.css";

type AuthMode = "login" | "signup";

type AuthPageProps = {
  readonly initialMode?: AuthMode;
  readonly onAuthSuccess?: () => void;
};

type PasswordFieldProps = {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: string;
  readonly showPassword: boolean;
  readonly onToggleShow: () => void;
  readonly forgot?: boolean;
  readonly onForgot?: () => void;
};

function PasswordField({
  id,
  label,
  placeholder,
  value,
  onChange,
  autoComplete,
  showPassword,
  onToggleShow,
  forgot = false,
  onForgot,
}: PasswordFieldProps) {
  return (
    <div className="field">
      <div className="password-label">
        <label htmlFor={id}>{label}</label>

        {forgot && (
          <button
            type="button"
            className="forgot-button"
            onClick={onForgot}
          >
            Forgot?
          </button>
        )}
      </div>

      <div className="password-input">
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
        />

        <button
          type="button"
          className="eye-button"
          onClick={onToggleShow}
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? (
            <EyeOff size={20} strokeWidth={2} />
          ) : (
            <Eye size={20} strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  );
}

export default function AuthPage({
  initialMode = "login",
  onAuthSuccess,
}: Readonly<AuthPageProps>) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const savedTheme = localStorage.getItem("Tradonova-theme");

    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("Tradonova-theme", theme);
  }, [theme]);

  useEffect(() => {
    const savedNotice = window.sessionStorage.getItem("auth_notice");

    if (!savedNotice) {
      return;
    }

    try {
      const parsedNotice = JSON.parse(savedNotice) as { text?: string; type?: "success" | "error" };

      if (parsedNotice.text) {
        setNotice({
          text: parsedNotice.text,
          type: parsedNotice.type === "error" ? "error" : "success",
        });

        window.setTimeout(() => {
          setNotice(null);
          window.sessionStorage.removeItem("auth_notice");
        }, 3000);
      }
    } catch {
      window.sessionStorage.removeItem("auth_notice");
    }
  }, []);

  const normalizeNoticeText = (text: string, type: "success" | "error" = "success") => {
    const value = String(text ?? "").trim();

    if (!value) {
      return type === "success" ? "Action completed successfully." : "Something went wrong. Please try again.";
    }

    const cleaned = value
      .replace(/auth_code\s*[:=][^,\n]+/gi, "")
      .replace(/code_verifier\s*[:=][^,\n]+/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[,\s]+$/g, "")
      .trim();

    if (!cleaned || /auth_code|code_verifier/i.test(value)) {
      return type === "success" ? "Google login successful." : "Authentication failed. Please try again.";
    }

    return cleaned;
  };

  const showNotice = (text: string, type: "success" | "error" = "success") => {
    const nextText = normalizeNoticeText(text, type);
    setNotice({ text: nextText, type });
    window.sessionStorage.setItem("auth_notice", JSON.stringify({ text: nextText, type }));

    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }

    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      window.sessionStorage.removeItem("auth_notice");
    }, 3000);
  };

  const isLogin = mode === "login";

  const backendBaseUrl = String(
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.BACKEND_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");

  const saveAuthToken = (token: string) => {
    localStorage.setItem("auth_token", token);
    window.dispatchEvent(new CustomEvent("auth-success"));
    onAuthSuccess?.();
  };

  const serializeQueryValue = (value: unknown): string => {
    if (Array.isArray(value)) {
      return value.join(",");
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    return JSON.stringify(value);
  };

  const apiRequest = async (
    endpoint: string,
    method: "GET" | "POST" = "POST",
    payload: Record<string, unknown> = {}
  ) => {
    const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url = `${backendBaseUrl}${normalizedEndpoint}`;

    const requestOptions: RequestInit = {
      method,
      headers: {
        Accept: "application/json",
      },
    };

    if (method === "POST") {
      requestOptions.headers = {
        ...requestOptions.headers,
        "Content-Type": "application/json",
      };
      requestOptions.body = JSON.stringify(payload);
    } else {
      const queryUrl = new URL(url);

      Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          return;
        }

        queryUrl.searchParams.set(key, serializeQueryValue(value));
      });

      return fetch(queryUrl.toString(), requestOptions).then(async (response) => {
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.detail || data.message || "Authentication request failed.");
        }

        return data;
      });
    }

    const response = await fetch(url, requestOptions);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.detail || data.message || "Authentication request failed.");
    }

    return data;
  };

  const validateForm = (): string => {
    if (!email.trim()) {
      return "Please enter your email.";
    }

    // if (!isLogin && !name.trim()) {
    //   return "Please enter your name.";
    // }

    if (!password) {
      return isLogin ? "Please enter your password." : "Please enter a password.";
    }

    if (!isLogin && !confirmPassword) {
      return "Please confirm your password.";
    }

    if (!isLogin && password !== confirmPassword) {
      return "Passwords do not match.";
    }

    return "";
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? "/auth/login" : "/auth/register";
      const response = await apiRequest(endpoint, "POST", {
        ...(isLogin ? {} : { name }),
        email,
        password,
      });

      const token = response.token || response.access_token || response.auth_token;

      if (token) {
        saveAuthToken(token);
      }

      if (response.message) {
        setError("");
        showNotice(response.message, "success");
      }

      console.log(isLogin ? "Login:" : "Sign up:", response);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Authentication failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError("");

    try {
      const endpoint = isLogin ? "/auth/google/login" : "/auth/google/signup";
      const result = await apiRequest(endpoint, "GET", {
        provider: "google",
      });

      const redirectUrl =
        result?.url ||
        result?.redirectUrl ||
        result?.auth_url ||
        result?.result?.url ||
        result?.data?.url;

      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }

      const token = result?.token || result?.access_token || result?.auth_token;
      if (token) {
        saveAuthToken(token);
        return;
      }

      throw new Error("Google authentication URL was not returned by the backend.");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Google authentication failed.";
      setError(message);
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
            <img
              src={
                theme === "dark"
                  ? "/logos/Tradenova_Dark.png"
                  : "/logos/Tradenova_Light.png"
              }
              alt="Tradonova"
              className="logo"
            />
          </div>

          <div className="brand-message">
            <span className="eyebrow">AUTOMATED PAPER TRADING</span>

            <h1>
              Analyze Smarter.
              <br />
              <span>Invest Better.</span>
            </h1>

            <p>
              Research-driven portfolio insights powered by intelligent trading models.
            </p>
          </div>
        </div>
      </section>

      <section className="form-section">
        <div className="form-container">
          <div className="form-topbar">
            <button
              type="button"
              className="back-button"
              onClick={() => window.history.back()}
            >
              <span aria-hidden="true">←</span>
              {" "}Back
            </button>

            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>

          <div className="mobile-logo">
            <img
              src={
                theme === "dark"
                  ? "/logos/Tradonova_Dark.png"
                  : "/logos/Tradonova_Light.png"
              }
              alt="Tradonova"
              className="logo"
            />
          </div>

          <div className="login-heading">
            <span className="welcome">{isLogin ? "WELCOME BACK" : "JOIN Tradonova"}</span>
            <h2>{isLogin ? "Login to your account" : "Create your account"}</h2>
            <p>
              {isLogin
                ? "Continue your paper trading journey."
                : "Start your paper trading journey."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {notice && (
              <div className="toast-overlay">
                <div className={`toast-message ${notice.type}`} role="status" aria-live="polite">
                  {notice.text}
                </div>
              </div>
            )}

            {/* {!isLogin && (
              <div className="field">
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )} */}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <PasswordField
              id="password"
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChange={setPassword}
              autoComplete={isLogin ? "current-password" : "new-password"}
              showPassword={showPassword}
              onToggleShow={() => setShowPassword((prev) => !prev)}
              forgot={isLogin}
              onForgot={() => navigate("/forgot-password")}
            />

            {!isLogin && (
              <PasswordField
                id="confirmPassword"
                label="Confirm Password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                showPassword={showConfirmPassword}
                onToggleShow={() => setShowConfirmPassword((prev) => !prev)}
              />
            )}

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? (
                <span className="loading-content">
                  <span className="spinner" />
                  {isLogin ? "Logging in..." : "Creating account..."}
                </span>
              ) : (
                <>{isLogin ? "Login" : "Create account"}</>
              )}
            </button>

            <div className="divider">
              <span />
              <p>OR</p>
              <span />
            </div>

            <button
              type="button"
              className="google-button"
              onClick={handleGoogleAuth}
              disabled={loading}
            >
              <span className="google-icon">G</span>
              {isLogin ? "Continue with Google" : "Sign up with Google"}
            </button>
          </form>

          <p className="signup-text">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button type="button" onClick={() => setMode(isLogin ? "signup" : "login")}>
              {isLogin ? "Sign up" : "Login"}
            </button>
          </p>

          <p className="security-note">
            Your paper trading account is protected with secure authentication.
          </p>
        </div>
      </section>
    </main>
  );
}