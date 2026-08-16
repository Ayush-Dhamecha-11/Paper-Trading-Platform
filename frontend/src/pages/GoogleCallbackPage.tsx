import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const backendBaseUrl = String(
  import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.BACKEND_URL ||
    "http://localhost:8000"
).replace(/\/$/, "");

function getTokenFromResponse(data: Record<string, unknown>): string | null {
  const possibleKeys = [
    "token",
    "access_token",
    "auth_token",
    "jwt",
    "accessToken",
  ];

  for (const key of possibleKeys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  const nested = data.data as Record<string, unknown> | undefined;
  if (nested) {
    const nestedToken = getTokenFromResponse(nested);
    if (nestedToken) {
      return nestedToken;
    }
  }

  const result = data.result as Record<string, unknown> | undefined;
  if (result) {
    const resultToken = getTokenFromResponse(result);
    if (resultToken) {
      return resultToken;
    }
  }

  return null;
}

const sanitizeNoticeText = (text: string, type: "success" | "error" = "success") => {
  const value = String(text ?? "").trim();

  if (!value) {
    return type === "success" ? "Google login successful." : "Authentication failed. Please try again.";
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

export default function GoogleCallbackPage() {
  const navigate = useNavigate();
  const [statusText, setStatusText] = useState("Processing Google login...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (!code) {
      window.sessionStorage.setItem(
        "auth_notice",
        JSON.stringify({ text: sanitizeNoticeText("Please login again.", "error"), type: "error" })
      );
      navigate("/login", { replace: true });
      return;
    }

    const finalizeLogin = async () => {
      try {
        const url = `${backendBaseUrl}/auth/google/callback?code=${encodeURIComponent(code)}`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.detail || data.message || "Google login failed.");
        }

        const token = getTokenFromResponse(data as Record<string, unknown>);

        if (token) {
          localStorage.setItem("auth_token", token);
          window.dispatchEvent(new CustomEvent("auth-success"));

          const successMessage = sanitizeNoticeText(
            typeof data.message === "string" && data.message.trim()
              ? data.message
              : "Google login successful.",
            "success"
          );

          window.sessionStorage.setItem(
            "auth_notice",
            JSON.stringify({ text: successMessage, type: "success" })
          );

          const cleanUrl = new URL(window.location.href);
          cleanUrl.search = "";
          window.history.replaceState({}, "", cleanUrl.toString());

          navigate("/dashboard", { replace: true });
          return;
        }

        const fallbackMessage = sanitizeNoticeText(
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : "Google login was successful.",
          "success"
        );

        window.sessionStorage.setItem(
          "auth_notice",
          JSON.stringify({ text: fallbackMessage, type: "success" })
        );

        const cleanUrl = new URL(window.location.href);
        cleanUrl.search = "";
        window.history.replaceState({}, "", cleanUrl.toString());

        navigate("/dashboard", { replace: true });
      } catch (error) {
        const message = sanitizeNoticeText(
          error instanceof Error ? error.message : "Google login failed.",
          "error"
        );
        setStatusText(message);

        window.sessionStorage.setItem(
          "auth_notice",
          JSON.stringify({ text: message, type: "error" })
        );

        const cleanUrl = new URL(window.location.href);
        cleanUrl.search = "";
        window.history.replaceState({}, "", cleanUrl.toString());

        navigate("/login", { replace: true });
      }
    };

    void finalizeLogin();
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#071426",
        color: "#f7fbff",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div
        style={{
          padding: "1rem 1.5rem",
          borderRadius: "12px",
          background: "rgba(15, 23, 42, 0.9)",
          border: "1px solid rgba(148, 163, 184, 0.15)",
          boxShadow: "0 18px 40px rgba(15, 23, 42, 0.35)",
        }}
      >
        {statusText}
      </div>
    </div>
  );
}
