import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import { showAppAlert } from "../utils/alertConfig";
import { getBackendBaseUrl, getStoredAuthTokens, logoutUser } from "../utils/authUtils";
import "../pages_css/profile.css";

const profileSections = [
  { key: "profile", label: "My Profile" },
  { key: "privacy", label: "Data & Privacy" },
  { key: "preferences", label: "Preferences" },
  { key: "support", label: "Help & Support" },
] as const;

type ProfileSectionKey = (typeof profileSections)[number]["key"];

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

function getInitials(name: string) {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("") || "U"
  );
}

export default function ProfilePage() {
  const [searchParams] = useSearchParams();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const savedTheme = localStorage.getItem("Tradonova-theme");
    return savedTheme === "light" ? "light" : "dark";
  });
  const [autoTrade, setAutoTrade] = useState(false);
  const [name, setName] = useState("Jenil Shah");
  const [email, setEmail] = useState("jenilshah740@gmail.com");
  const [isEditing, setIsEditing] = useState(false);
  const [isPasswordEditing, setIsPasswordEditing] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [activeSection, setActiveSection] = useState<ProfileSectionKey>("profile");

  const requestedSection = searchParams.get("section");
  const effectiveSection: ProfileSectionKey =
    requestedSection === "support" || requestedSection === "feedback"
      ? "support"
      : activeSection;

  const applyTheme = (nextTheme: "light" | "dark") => {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("Tradonova-theme", nextTheme);
    window.dispatchEvent(new Event("theme-change"));
  };

  const handleLogout = async () => {
    await logoutUser({ redirectTo: "/login" });
  };

  const handlePasswordFieldChange = (field: keyof PasswordForm, value: string) => {
    setPasswordForm((current) => ({ ...current, [field]: value }));
  };

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!passwordForm.currentPassword.trim() || !passwordForm.newPassword.trim()) {
      showAppAlert({
        title: "Validation Error",
        text: "Please enter your current password and new password.",
        type: "error",
        timer: 2200,
      });
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showAppAlert({
        title: "Validation Error",
        text: "New password and confirm password must match.",
        type: "error",
        timer: 2200,
      });
      return;
    }

    const { accessToken, refreshToken } = getStoredAuthTokens();

    if (!accessToken && !refreshToken) {
      showAppAlert({
        title: "Error",
        text: "Your session token is missing. Please log in again.",
        type: "error",
        timer: 2400,
      });
      return;
    }

    setPasswordLoading(true);

    try {
      console.debug("[ProfilePage] Updating password");
      const response = await fetch(`${getBackendBaseUrl()}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || data.message || "Unable to update password.");
      }

      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setIsPasswordEditing(false);
      showAppAlert({
        title: "Success",
        text: data.message || "Password updated successfully.",
        type: "success",
        timer: 2400,
      });
    } catch (error) {
      console.error("[ProfilePage] Password update failed", error);
      showAppAlert({
        title: "Error",
        text: error instanceof Error ? error.message : "Unable to update password.",
        type: "error",
        timer: 2400,
      });
    } finally {
      setPasswordLoading(false);
    }
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
        {isPasswordEditing ? (
          <form className="password-edit-form" onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              className="detail-input"
              placeholder="Current password"
              value={passwordForm.currentPassword}
              onChange={(event) => handlePasswordFieldChange("currentPassword", event.target.value)}
              autoComplete="current-password"
            />
            <input
              type="password"
              className="detail-input"
              placeholder="New password"
              value={passwordForm.newPassword}
              onChange={(event) => handlePasswordFieldChange("newPassword", event.target.value)}
              autoComplete="new-password"
            />
            <input
              type="password"
              className="detail-input"
              placeholder="Confirm new password"
              value={passwordForm.confirmPassword}
              onChange={(event) => handlePasswordFieldChange("confirmPassword", event.target.value)}
              autoComplete="new-password"
            />
            <div className="password-form-actions">
              <button type="submit" className="edit-button primary" disabled={passwordLoading}>
                {passwordLoading ? "Saving..." : "Save Password"}
              </button>
              <button
                type="button"
                className="edit-button"
                onClick={() => setIsPasswordEditing(false)}
                disabled={passwordLoading}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="detail-value-row">
            <div className="detail-value">**********</div>
            <button type="button" className="edit-button" onClick={() => setIsPasswordEditing(true)}>
              Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderPreferenceSection = () => (
    <div className="profile-detail-card">
      <div className="detail-section-title">Preferences</div>
      <div className="detail-row preference-row">
        <div className="detail-label">Theme</div>
        <div className="theme-choice-group" role="radiogroup" aria-label="Choose theme">
          <button
            type="button"
            className={theme === "light" ? "active" : ""}
            onClick={() => applyTheme("light")}
            aria-pressed={theme === "light"}
          >
            Light
          </button>
          <button
            type="button"
            className={theme === "dark" ? "active" : ""}
            onClick={() => applyTheme("dark")}
            aria-pressed={theme === "dark"}
          >
            Dark
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
      <Header userName={name} userEmail={email} onLogout={handleLogout} />

      <div className="profile-shell">
        <aside className="profile-sidebar">
          <div className="profile-sidebar-card">
            <div className="profile-avatar-wrap">
              <div className="profile-avatar-large">{getInitials(name)}</div>
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
                <span>&gt;</span>
              </button>
            ))}

            <button type="button" className="profile-side-link profile-side-action danger" onClick={handleLogout}>
              <span>Logout</span>
              <span>Exit</span>
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
