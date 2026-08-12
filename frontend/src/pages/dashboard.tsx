export default function DashboardPage() {
  return (
    <main
      style={{
        width: "100%",
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
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "2.2rem" }}>Dashboard</h1>
        <p style={{ marginTop: "0.75rem", color: "#8ea2b7" }}>
          Temporary blank dashboard for testing auth flow.
        </p>
      </div>
    </main>
  );
}
