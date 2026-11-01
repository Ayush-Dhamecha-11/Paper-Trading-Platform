export default function NotFoundPage() {
  return (
    <main
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
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "4rem", margin: 0 }}>404</h1>
        <p style={{ color: "#8ea2b7", marginTop: "0.75rem" }}>Page not found</p>
      </div>
    </main>
  );
}
