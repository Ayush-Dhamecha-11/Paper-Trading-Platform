import { useEffect, useState } from "react";
import Header from "../components/Header";

export default function DashboardPage() {
  const [notice, setNotice] = useState<{ text: string; type: "success" | "error" } | null>(null);

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

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    window.dispatchEvent(new CustomEvent("auth-success"));
    window.location.href = "/login";
  };

  return (
    <main
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "#071426",
        color: "#f7fbff",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <Header
        userName="Jenil Shah"
        userEmail="jenilshah740@gmail.com"
        onLogout={handleLogout}
      />

      {notice && (
        <div className="toast-overlay">
          <div
            className={`toast-message ${notice.type}`}
            role="status"
            aria-live="polite"
          >
            {notice.text}
          </div>
        </div>
      )}

      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "2.5rem 1.25rem",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "2rem",
            borderRadius: "20px",
            background: "linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(11, 18, 32, 0.92))",
            border: "1px solid rgba(148, 163, 184, 0.12)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "2.2rem" }}>Dashboard</h1>
          <p style={{ marginTop: "0.75rem", color: "#8ea2b7" }}>
            Temporary blank dashboard for testing auth flow.
          </p>
        </div>
      </div>
    </main>
  );
}
