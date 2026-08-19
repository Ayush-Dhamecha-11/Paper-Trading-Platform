import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { showAppAlert } from "../utils/alertConfig";

const backendBaseUrl = String(
  import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.BACKEND_URL ||
    "http://localhost:8000"
).replace(/\/$/, "");

export default function GoogleCallbackPage() {
  const navigate = useNavigate();

  const [statusText, setStatusText] = useState(
    "Processing Google login..."
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (!code) {
      const failedText = "Google login failed. Please try again.";
      setStatusText(failedText);

      showAppAlert({
        title: "Error",
        text: failedText,
        type: "error",
      });

      sessionStorage.setItem(
        "auth_notice",
        JSON.stringify({
          text: failedText,
          type: "error",
        })
      );

      navigate("/login", { replace: true });
      return;
    }

    const finalizeLogin = async () => {
      try {
        const response = await fetch(
          `${backendBaseUrl}/auth/google/callback?code=${encodeURIComponent(code)}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            credentials: "include",
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.detail ||
              data.message ||
              "Google login failed."
          );
        }

        const token =
          data?.access_token ||
          data?.token ||
          data?.auth_token ||
          data?.result?.access_token ||
          data?.result?.token ||
          data?.data?.access_token ||
          data?.data?.token;

        const refreshToken =
          data?.refresh_token ||
          data?.refreshToken ||
          data?.result?.refresh_token ||
          data?.result?.refreshToken ||
          data?.data?.refresh_token ||
          data?.data?.refreshToken;

        if (token) {
          localStorage.setItem("auth_token", token);
        }

        if (refreshToken) {
          localStorage.setItem("refresh_token", refreshToken);
        }

        if (!token && !refreshToken) {
          localStorage.setItem("auth_session", "1");
        }

        const successText = data.message || "Google login successful.";

        showAppAlert({
          title: "Success",
          text: successText,
          type: "success",
          timer: 2000,
        });

        sessionStorage.setItem(
          "auth_notice",
          JSON.stringify({
            text: successText,
            type: "success",
          })
        );

        // Remove ?code=... from browser URL
        const cleanUrl = new URL(window.location.href);
        cleanUrl.search = "";
        window.history.replaceState(
          {},
          "",
          cleanUrl.toString()
        );

        window.dispatchEvent(new CustomEvent("auth-success"));

        navigate("/dashboard", { replace: true });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Google login failed.";

        setStatusText(message);

        showAppAlert({
          title: "Error",
          text: message,
          type: "error",
        });

        sessionStorage.setItem(
          "auth_notice",
          JSON.stringify({
            text: message,
            type: "error",
          })
        );

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