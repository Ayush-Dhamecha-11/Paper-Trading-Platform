import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import { showAppAlert } from "../utils/alertConfig";
import {
  getBackendBaseUrl,
  authenticatedFetch,
  getStoredUserInfo,
  logBackendResponse,
  logoutUser,
  setStoredUserInfo,
  type StoredUserInfo,
} from "../utils/authUtils";
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
  if (!name || name === "--") {
    return "U";
  }

  return (
    name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("") || "U"
  );
}

export default function ProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const savedTheme = localStorage.getItem("Tradonova-theme");
    return savedTheme === "light" ? "light" : "dark";
  });
  const [autoTrade, setAutoTrade] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [name, setName] = useState("--");
  const [email, setEmail] = useState("--");
  const [isEditing, setIsEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [isPasswordEditing, setIsPasswordEditing] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [activeSection, setActiveSection] = useState<ProfileSectionKey>("profile");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let isMounted = true;
    const storedUserInfo = getStoredUserInfo();

    const applyUserInfo = (userInfo: StoredUserInfo) => {
      if (!isMounted) {
        return;
      }

      setName(userInfo.name?.trim() || "--");
      setEmail(userInfo.email?.trim() || "--");
      setAutoTrade(userInfo.auto_trade ?? false);

    };

    if (storedUserInfo) {
      applyUserInfo(storedUserInfo);
    }

    const refreshProfile = () => authenticatedFetch(`${getBackendBaseUrl()}/api/profile`, {
      credentials: "include",
    })
      .then(async (response) => {
        logBackendResponse(response, "GET /api/profile");
        if (!response.ok) {
          throw new Error("Unable to load user information.");
        }

        return (await response.json()) as {
          name?: string;
          email?: string;
          preference?: StoredUserInfo;
        };
      })
      .then((profile) => {
        const userInfo: StoredUserInfo = {
          name: profile.name,
          email: profile.email,
          theme: profile.preference?.theme,
          auto_trade: profile.preference?.auto_trade,
        };

        setStoredUserInfo(userInfo);
        applyUserInfo(userInfo);
      })
      .catch(() => {
        applyUserInfo(storedUserInfo ?? {});
      });

    void refreshProfile();

    const refreshTimer = window.setInterval(() => {
      void refreshProfile();
    }, 60_000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  const requestedSection = searchParams.get("section");

  const effectiveSection: ProfileSectionKey =
    requestedSection === "support" || requestedSection === "feedback"
      ? "support"
      : activeSection;

  const savePreferences = async (
    nextTheme: "light" | "dark",
    nextAutoTrade: boolean,
    previousTheme: "light" | "dark",
    previousAutoTrade: boolean,
  ) => {
    if (preferenceSaving) {
      return;
    }

    setPreferenceSaving(true);

    try {
      const response = await authenticatedFetch(`${getBackendBaseUrl()}/api/preferences`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          theme: nextTheme === "light" ? "Light" : "Dark",
          auto_trade: nextAutoTrade,
        }),
      });

      logBackendResponse(response, "POST /preferences");
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || data.message || "Unable to update preferences.");
      }

      setTheme(nextTheme);
      setAutoTrade(nextAutoTrade);
      document.documentElement.dataset.theme = nextTheme;
      localStorage.setItem("Tradonova-theme", nextTheme);
      window.dispatchEvent(new Event("theme-change"));

      const storedUserInfo = getStoredUserInfo() ?? {};
      setStoredUserInfo({
        ...storedUserInfo,
        theme: nextTheme === "light" ? "Light" : "Dark",
        auto_trade: nextAutoTrade,
      });
    } catch (error) {
      setTheme(previousTheme);
      setAutoTrade(previousAutoTrade);
      document.documentElement.dataset.theme = previousTheme;
      localStorage.setItem("Tradonova-theme", previousTheme);
      window.dispatchEvent(new Event("theme-change"));
      showAppAlert({
        title: "Error",
        text: error instanceof Error ? error.message : "Unable to update preferences.",
        type: "error",
        timer: 2400,
      });
    } finally {
      setPreferenceSaving(false);
    }
  };

  const handleThemeChange = (nextTheme: "light" | "dark") => {
    void savePreferences(nextTheme, autoTrade, theme, autoTrade);
  };

  const handleAutoTradeChange = () => {
    void savePreferences(theme, !autoTrade, theme, autoTrade);
  };

  const handleLogout = async () => {
    await logoutUser({ redirectTo: "/login" });
  };

  const handleNameSave = async () => {
    const nextName = name.trim();

    if (!nextName || nextName === "--") {
      showAppAlert({
        title: "Validation Error",
        text: "Please enter a valid name.",
        type: "error",
        timer: 2200,
      });
      return;
    }

    setNameSaving(true);

    try {
      const response = await authenticatedFetch(`${getBackendBaseUrl()}/api/name`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ new_name: nextName }),
      });

      logBackendResponse(response, "POST /api/name");
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.detail || data.message || "Unable to update your name.");
      }

      const storedUserInfo = getStoredUserInfo() ?? {};
      setStoredUserInfo({ ...storedUserInfo, name: nextName });
      setName(nextName);
      setIsEditing(false);
      showAppAlert({
        title: "Success",
        text: data.message || "Name updated successfully.",
        type: "success",
        timer: 2200,
      });
    } catch (error) {
      showAppAlert({
        title: "Error",
        text: error instanceof Error ? error.message : "Unable to update your name.",
        type: "error",
        timer: 2400,
      });
    } finally {
      setNameSaving(false);
    }
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

    // const { accessToken, refreshToken } = getStoredAuthTokens();

    // if (!accessToken && !refreshToken) {
    //   showAppAlert({
    //     title: "Error",
    //     text: "Your session token is missing. Please log in again.",
    //     type: "error",
    //     timer: 2400,
    //   });
    //   return;
    // }

    setPasswordLoading(true);

    try {
      console.debug("[ProfilePage] Updating password");
      const response = await authenticatedFetch(`${getBackendBaseUrl()}/api/password`, {
        credentials: "include",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          old_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        }),
      });

      logBackendResponse(response, "POST /api/password");
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

  let nameActionLabel = "Edit";
  if (nameSaving) {
    nameActionLabel = "Saving...";
  } else if (isEditing) {
    nameActionLabel = "Done";
  }

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
          <button
            type="button"
            className="edit-button"
            onClick={() => {
              if (isEditing) {
                void handleNameSave();
                return;
              }

              setIsEditing(true);
            }}
            disabled={nameSaving}
          >
            {nameActionLabel}
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
            onClick={() => handleThemeChange("light")}
            aria-pressed={theme === "light"}
            disabled={preferenceSaving}
          >
            Light
          </button>
          <button
            type="button"
            className={theme === "dark" ? "active" : ""}
            onClick={() => handleThemeChange("dark")}
            aria-pressed={theme === "dark"}
            disabled={preferenceSaving}
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
            onClick={handleAutoTradeChange}
            disabled={preferenceSaving}
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
                onClick={() => {
                  setActiveSection(section.key);
                  setSearchParams({});
                }}
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
