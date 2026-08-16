import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";

    if (!hash) {
      navigate("/login", { replace: true });
      return;
    }

    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const error = params.get("error");
    const errorCode = params.get("error_code");
    const errorDescription = params.get("error_description");

    const cleanUrl = new URL(window.location.href);
    cleanUrl.hash = "";
    window.history.replaceState({}, "", cleanUrl.toString());

    if (accessToken) {
      localStorage.setItem("auth_token", accessToken);

      if (refreshToken) {
        localStorage.setItem("refresh_token", refreshToken);
      }

      window.sessionStorage.setItem(
        "auth_notice",
        JSON.stringify({
          text: "Account created successfully.",
          type: "success",
        })
      );

      window.dispatchEvent(new CustomEvent("auth-success"));
      navigate("/dashboard", { replace: true });
      return;
    }

    const message =
      decodeURIComponent(errorDescription || "") ||
      error ||
      errorCode ||
      "Authentication failed. Please login again.";

    window.sessionStorage.setItem(
      "auth_notice",
      JSON.stringify({
        text: message,
        type: "error",
      })
    );

    navigate("/login", { replace: true });
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#e5e7eb",
        background: "#0b1220",
        fontSize: "1rem",
        fontWeight: 600,
      }}
    >
      Processing authentication...
    </div>
  );
}
