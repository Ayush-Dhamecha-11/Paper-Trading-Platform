import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./Header.css";

const navItems = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Analytics", path: "/analytics" },
  { label: "Portfolio", path: "/portfolio" },
] as const;

const getStoredTheme = () => {
  const savedTheme = localStorage.getItem("Tradonova-theme");
  return savedTheme === "light" ? "light" : "dark";
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
  userEmail = "--",
  avatarUrl,
  onLogout,
}: Readonly<HeaderProps>) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => getStoredTheme());
  const headerRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
        setUserMenuOpen(false);
      }
    };

    const handleThemeChange = () => {
      setTheme(getStoredTheme());
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("theme-change", handleThemeChange);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("theme-change", handleThemeChange);
    };
  }, []);

  const handleLogout = () => {
    setUserMenuOpen(false);
    onLogout?.();
  };

  const handleMyProfile = () => {
    setUserMenuOpen(false);
    navigate("/profile");
  };

  const handleHelpSupport = () => {
    setUserMenuOpen(false);
    navigate("/profile?section=support");
  };

  const handleNavClick = (path: string) => {
    setMobileMenuOpen(false);
    navigate(path);
  };

  const handleMobileToggle = () => {
    setMobileMenuOpen((prev) => !prev);
    setUserMenuOpen(false);
  };

  const handleUserToggle = () => {
    setUserMenuOpen((prev) => !prev);
    setMobileMenuOpen(false);
  };

  return (
    <header className="top-header">
      <div className="header-inner" ref={headerRef}>
        <div className="brand-mark" aria-label="TradeNova brand">
          <img
            src={theme === "dark" ? "/logos/Tradenova_Dark.png" : "/logos/Tradenova_Light.png"}
            alt="TradeNova"
            className="brand-logo"
          />
        </div>

        <nav className="header-tabs" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.path}
              type="button"
              className={`header-tab ${location.pathname === item.path ? "active" : ""}`}
              onClick={() => handleNavClick(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mobile-nav-wrap">
          <button
            type="button"
            className="mobile-menu-toggle"
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            onClick={handleMobileToggle}
          >
            <span />
            <span />
            <span />
          </button>

          {mobileMenuOpen && (
            <div className="mobile-menu-panel" role="menu" aria-label="Mobile navigation">
              {navItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className={`mobile-menu-item ${location.pathname === item.path ? "active" : ""}`}
                  onClick={() => handleNavClick(item.path)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="header-actions">
          <button
            type="button"
            onClick={handleUserToggle}
            className="user-avatar-button"
            aria-label="Open user menu"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={userName} className="user-avatar" />
            ) : (
              <div className="user-avatar">{getInitials(userName)}</div>
            )}

            <span>{userName}</span>
          </button>

          {userMenuOpen && (
            <div className="avatar-menu">
              <div className="avatar-menu-header">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={userName} className="user-avatar" />
                ) : (
                  <div className="user-avatar">{getInitials(userName)}</div>
                )}

                <div>
                  <div style={{ fontWeight: 700 }}>{userName}</div>
                  <div style={{ color: "var(--header-muted)", fontSize: "0.72rem" }}>{userEmail}</div>
                </div>
              </div>

              <div className="avatar-menu-body">
                <button type="button" className="menu-action" onClick={handleMyProfile}>
                  <span>My Profile</span>
                  <span>→</span>
                </button>
                <button type="button" className="menu-action" onClick={handleHelpSupport}>
                  <span>Help &amp; Support</span>
                  <span>→</span>
                </button>
                <button type="button" className="menu-action danger" onClick={handleLogout}>
                  <span>Logout</span>
                  <span>⎋</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
