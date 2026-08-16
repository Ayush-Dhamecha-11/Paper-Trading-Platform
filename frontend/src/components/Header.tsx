import { useEffect, useRef, useState } from "react";

const styles = {
  header: {
    width: "100%",
    background: "rgba(9, 17, 29, 0.86)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
    backdropFilter: "blur(14px)",
    position: "sticky" as const,
    top: 0,
    zIndex: 10,
  },
  inner: {
    maxWidth: "1280px",
    margin: "0 auto",
    padding: "0.9rem 1.25rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1rem",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    color: "#f8fbff",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    fontSize: "0.8rem",
  },
  logo: {
    width: "34px",
    height: "34px",
    borderRadius: "10px",
    background: "linear-gradient(135deg, #7dd3fc, #2563eb)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#071426",
    fontWeight: 800,
    fontSize: "0.9rem",
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  userMenu: {
    position: "relative" as const,
  },
  avatarButton: {
    display: "flex",
    alignItems: "center",
    gap: "0.7rem",
    background: "rgba(15, 23, 42, 0.82)",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: "999px",
    padding: "0.42rem 0.7rem 0.42rem 0.5rem",
    color: "#ebf4ff",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  avatar: {
    width: "34px",
    height: "34px",
    borderRadius: "50%",
    objectFit: "cover" as const,
    border: "1px solid rgba(148, 163, 184, 0.4)",
    background: "linear-gradient(135deg, #1e293b, #334155)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#f8fbff",
    fontSize: "0.9rem",
    fontWeight: 700,
  },
  menu: {
    position: "absolute" as const,
    right: 0,
    top: "calc(100% + 0.7rem)",
    minWidth: "220px",
    background: "rgba(15, 23, 42, 0.98)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: "18px",
    boxShadow: "0 20px 32px rgba(2, 6, 23, 0.45)",
    overflow: "hidden",
  },
  menuHeader: {
    padding: "0.9rem 1rem 0.6rem",
    borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  menuBody: {
    padding: "0.45rem 0",
  },
  menuItem: {
    width: "100%",
    background: "transparent",
    border: "none",
    color: "#eaf3ff",
    padding: "0.8rem 1rem",
    textAlign: "left" as const,
    cursor: "pointer",
    fontSize: "0.95rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dangerItem: {
    color: "#fca5a5",
  },
  hiddenMobile: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
};

type HeaderProps = {
  userName?: string;
  userEmail?: string;
  avatarUrl?: string;
  onLogout?: () => void;
};

function getInitials(name?: string) {
  if (!name) return "U";

  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

export default function Header({
  userName = "User",
  userEmail = "user@example.com",
  avatarUrl,
  onLogout,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    setMenuOpen(false);
    onLogout?.();
  };

  return (
    <header style={styles.header}>
      <div style={styles.inner}>
        <div style={styles.brand}>
          <img
            src="/logos/Tradenova_Dark.png"
            alt="TradeNova"
            style={{
              width: "120px",
              height: "auto",
              objectFit: "contain",
              display: "block",
            }}
          />
        </div>

        <div style={styles.right}>
          <div style={styles.hiddenMobile} />

          <div ref={menuRef} style={styles.userMenu}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              style={styles.avatarButton}
              aria-label="Open user menu"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={userName}
                  style={styles.avatar}
                />
              ) : (
                <div style={styles.avatar}>{getInitials(userName)}</div>
              )}

              <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{userName}</span>
            </button>

            {menuOpen && (
              <div style={styles.menu}>
                <div style={styles.menuHeader}>
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={userName}
                      style={{ ...styles.avatar, width: "42px", height: "42px" }}
                    />
                  ) : (
                    <div style={{ ...styles.avatar, width: "42px", height: "42px" }}>
                      {getInitials(userName)}
                    </div>
                  )}

                  <div>
                    <div style={{ color: "#eff6ff", fontWeight: 700 }}>{userName}</div>
                    <div style={{ color: "#9bb3c9", fontSize: "0.73rem" }}>{userEmail}</div>
                  </div>
                </div>

                <div style={styles.menuBody}>
                  <button type="button" style={styles.menuItem}>
                    <span>View Profile</span>
                    <span>→</span>
                  </button>
                  <button type="button" style={styles.menuItem}>
                    <span>Analytics</span>
                    <span>↗</span>
                  </button>
                  <button type="button" style={{ ...styles.menuItem, ...styles.dangerItem }} onClick={handleLogout}>
                    <span>Logout</span>
                    <span>⎋</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
