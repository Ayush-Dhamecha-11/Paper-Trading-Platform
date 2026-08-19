import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import "../pages_css/profile.css";

const profileSections = [
  { key: "profile", label: "My Profile" },
  { key: "privacy", label: "Data & Privacy" },
  { key: "preferences", label: "Preferences" },
  { key: "support", label: "Help & Support" },
] as const;

type ProfileSectionKey = (typeof profileSections)[number]["key"];

export default function ProfilePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem("Tradonova-theme");
    return savedTheme !== "light";
  });
  const [autoTrade, setAutoTrade] = useState(false);
  const [profileImage, setProfileImage] = useState<string>("");
  const [name, setName] = useState("Jenil Shah");
  const [email, setEmail] = useState("jenilshah740@gmail.com");
  const [isEditing, setIsEditing] = useState(false);
  const [activeSection, setActiveSection] = useState<ProfileSectionKey>("profile");

  const requestedSection = searchParams.get("section");
  const effectiveSection: ProfileSectionKey = requestedSection === "support" || requestedSection === "feedback"
    ? "support"
    : activeSection;

  const applyTheme = (nextDarkMode: boolean) => {
    const theme = nextDarkMode ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("Tradonova-theme", theme);
    window.dispatchEvent(new Event("theme-change"));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const nextImage = typeof reader.result === "string" ? reader.result : "";
      setProfileImage(nextImage);
    };
    reader.readAsDataURL(file);
  };

  const handleLogout = async () => {
    try {
      await fetch(`${String(import.meta.env.VITE_BACKEND_URL || import.meta.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "")}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });
    } catch {
      // Ignore logout request errors and continue with local cleanup.
    }

    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("auth_session");
    window.dispatchEvent(new CustomEvent("auth-success"));
    navigate("/login");
  };

  const toggleDarkMode = () => {
    const nextDarkMode = !darkMode;
    setDarkMode(nextDarkMode);
    applyTheme(nextDarkMode);
  };

  const sectionMap: Record<Exclude<ProfileSectionKey, "profile" | "preferences">, { title: string; body: string[] }> = {
    privacy: {
      title: "Data & Privacy",
      body: [
        "Your trading data is kept on your device and in your secured account profile.",
        "Export and deletion requests can be managed from your account settings.",
      ],
    },
    support: {
      title: "Help & Support",
      body: [
        "Need assistance? Contact support or review your help resources here.",
        "This area is ready for tickets, FAQs, and live support links.",
      ],
    },
  };

  const renderProfileSection = () => (
    <div className="profile-detail-card">
      <div className="detail-section-title">Profile photo</div>
      <div className="photo-row">
        {profileImage ? (
          <img src={profileImage} alt="Profile" className="profile-avatar-medium" />
        ) : (
          <div className="profile-avatar-medium">
            {name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("") || "U"}
          </div>
        )}
        <button type="button" className="photo-button" onClick={() => fileInputRef.current?.click()}>
          Change Photo
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden-file-input" onChange={handleFileChange} />
      </div>

      <div className="detail-row">
        <div className="detail-label">Name</div>
        <div className="detail-value-row">
          {isEditing ? (
            <input value={name} onChange={(event) => setName(event.target.value)} className="detail-input" />
          ) : (
            <div className="detail-value">{name}</div>
          )}
          <button type="button" className="edit-button" onClick={() => setIsEditing((prev) => !prev)}>
            {isEditing ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      <div className="detail-row">
        <div className="detail-label">Email address</div>
        <div className="detail-value-row">
          {isEditing ? (
            <input value={email} onChange={(event) => setEmail(event.target.value)} className="detail-input" />
          ) : (
            <div className="detail-value">{email}</div>
          )}
        </div>
      </div>

      <div className="detail-row">
        <div className="detail-label">Password</div>
        <div className="detail-value-row">
          <div className="detail-value">••••••••••</div>
          <button type="button" className="edit-button" onClick={() => navigate("/reset-password")}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );

  const renderPreferenceSection = () => (
    <div className="profile-detail-card">
      <div className="detail-section-title">Preferences</div>
      <div className="detail-row preference-row">
        <div className="detail-label">Theme</div>
        <div className="detail-value-row preference-switch-row">
          <div className="detail-value">{darkMode ? "Dark" : "Light"}</div>
          <button
            type="button"
            aria-label="Toggle dark mode"
            className={`theme-toggle-button ${darkMode ? "on" : ""}`}
            onClick={toggleDarkMode}
          >
            <span className="toggle-thumb" />
          </button>
        </div>
      </div>

      <div className="detail-row preference-row">
        <div className="detail-label">Auto Trade</div>
        <div className="detail-value-row preference-switch-row">
          <div className="detail-value">{autoTrade ? "Enabled" : "Disabled"}</div>
          <button
            type="button"
            aria-label="Toggle auto trade"
            className={`theme-toggle-button ${autoTrade ? "on" : ""}`}
            onClick={() => setAutoTrade((prev) => !prev)}
          >
            <span className="toggle-thumb" />
          </button>
        </div>
      </div>
    </div>
  );

  const renderInfoSection = () => {
    const content = sectionMap[effectiveSection as Exclude<ProfileSectionKey, "profile" | "preferences">];
    return (
      <div className="section-panel-card">
        <div className="section-panel-title">{content.title}</div>
        <div className="section-panel-body">
          {content.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>
    );
  };

  const renderSectionContent = () => {
    if (effectiveSection === "profile") {
      return renderProfileSection();
    }
    if (effectiveSection === "preferences") {
      return renderPreferenceSection();
    }
    return renderInfoSection();
  };

  return (
    <main className="profile-page">
      <Header
        userName={name}
        userEmail={email}
        avatarUrl={profileImage || undefined}
        onLogout={handleLogout}
      />

      <div className="profile-shell">
        <aside className="profile-sidebar">
          <div className="profile-sidebar-card">
            <div className="profile-avatar-wrap">
              {profileImage ? (
                <img src={profileImage} alt="Profile" className="profile-avatar-large" />
              ) : (
                <div className="profile-avatar-large">
                  {name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("") || "U"}
                </div>
              )}
            </div>

            <div className="profile-personal-name">{name}</div>
            <div className="profile-personal-email">{email}</div>

            {profileSections.map((section) => (
              <button
                key={section.key}
                type="button"
                className={`profile-side-link ${effectiveSection === section.key ? "active" : ""}`}
                onClick={() => setActiveSection(section.key)}
              >
                <span>{section.label}</span>
                <span>›</span>
              </button>
            ))}

            <button type="button" className="profile-side-link profile-side-action danger" onClick={handleLogout}>
              <span>Logout</span>
              <span>⎋</span>
            </button>
          </div>
        </aside>

        <section className="profile-main-panel">
          <div className="profile-main-header">
            {effectiveSection === "profile" ? "Your personal profile" : "Account settings"}
          </div>
          {renderSectionContent()}
        </section>
      </div>
    </main>
  );
}
