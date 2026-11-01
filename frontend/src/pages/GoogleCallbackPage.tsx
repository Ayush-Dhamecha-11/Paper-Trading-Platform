import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { showAuthNotice } from "../utils/authNotice";
import { authenticatedFetch, logBackendResponse, markUserLoggedIn } from "../utils/authUtils.ts";
import { warmDashboardData } from "../utils/dashboardPrefetch";
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

  const hasProcessedCode = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search
    );
    console.log(params.toString());
    const code = params.get("code");

    if (!code) {
      const message = "Google login failed. Please try again.";
      showAuthNotice(message, "error");
      navigate("/login", { replace: true });
      return;
    }

    if (hasProcessedCode.current) {
      return;
    }

    hasProcessedCode.current = true;

    const finalizeLogin = async () => {
      try {
        const response = await authenticatedFetch(
          `${backendBaseUrl}/auth/google/callback?code=${encodeURIComponent(code)}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            credentials: "include",
          }
        );

        logBackendResponse(response, "GET /auth/google/callback");

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.detail ||
              data.message ||
              "Google login failed."
          );
        }

        const successText = data.message || "Google login successful.";

        showAuthNotice(successText, "success");

        // const cleanUrl = new URL(
        //   window.location.href
        // );

        // cleanUrl.search = "";

        // window.history.replaceState(
        //   {},
        //   "",
        //   cleanUrl.toString()
        // );

        // window.dispatchEvent(
        //   new CustomEvent("auth-success")
        // );
        markUserLoggedIn();
        void warmDashboardData();

        navigate("/dashboard", {
          replace: true,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Google login failed.";

        setStatusText(message);
        showAuthNotice(message, "error");

        navigate("/login", {
          replace: true,
        });
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
          background:
            "rgba(15, 23, 42, 0.9)",
          border:
            "1px solid rgba(148, 163, 184, 0.15)",
          boxShadow:
            "0 18px 40px rgba(15, 23, 42, 0.35)",
        }}
      >
        {statusText}
      </div>
    </div>
  );
}