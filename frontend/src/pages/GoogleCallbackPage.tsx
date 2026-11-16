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
      const exchangeUrl = `${backendBaseUrl}/auth/google/callback?code=${encodeURIComponent(code)}`;

      console.group(
        "%c[Google Callback Verification] 📥 Backend / Google Redirect Received",
        "color: #00d2ff; font-weight: bold; background: rgba(0, 210, 255, 0.15); padding: 4px 8px; border-radius: 4px;"
      );
      console.log("📍 Current URL:", window.location.href);
      console.log("🔑 Received Auth Code:", code);
      console.log("⏰ Received At:", new Date().toLocaleTimeString());
      console.log("🌐 Calling Backend Exchange Endpoint:", exchangeUrl);
      console.groupEnd();

      try {
        const response = await authenticatedFetch(
          exchangeUrl,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            credentials: "include",
            timeoutMs: 15000,
          },
          "GET /auth/google/callback"
        );

        logBackendResponse(response, "GET /auth/google/callback");

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          console.error(
            "%c[Google Callback Verification] ❌ Backend rejected Google redirect:",
            "color: #ff5e6d; font-weight: bold; background: rgba(255, 94, 109, 0.15); padding: 4px 8px; border-radius: 4px;",
            {
              status: response.status,
              statusText: response.statusText,
              errorData: data,
            }
          );
          throw new Error(
            data.detail ||
              data.message ||
              `Google login failed (${response.status} ${response.statusText}).`
          );
        }

        console.log(
          "%c[Google Callback Verification] ✅ Backend verified Google code successfully!",
          "color: #20d89b; font-weight: bold; background: rgba(32, 216, 155, 0.15); padding: 4px 8px; border-radius: 4px;",
          data
        );

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

        console.error(
          "%c[Google Callback Verification] ❌ Verification error:",
          "color: #ff5e6d; font-weight: bold;",
          error
        );
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