const AUTH_TOKEN_KEY = "auth_token";
const AUTH_SESSION_KEY = "auth_session";
const REFRESH_TOKEN_KEY = "refresh_token";

export const getBackendBaseUrl = () =>
  String(
    import.meta.env.VITE_BACKEND_URL ||
      import.meta.env.BACKEND_URL ||
      "http://localhost:8000"
  ).replace(/\/$/, "");

export const hasStoredAuth = () =>
  Boolean(
    localStorage.getItem(AUTH_TOKEN_KEY) ||
      localStorage.getItem(AUTH_SESSION_KEY) ||
      localStorage.getItem(REFRESH_TOKEN_KEY)
  );

export const setStoredAuthToken = (token: string) => {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_SESSION_KEY, "1");
  window.dispatchEvent(new CustomEvent("auth-success"));
};

export const markUserLoggedIn = () => {
  localStorage.setItem(AUTH_SESSION_KEY, "1");
  window.dispatchEvent(new CustomEvent("auth-success"));
};

export const clearStoredAuth = () => {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_SESSION_KEY);
  window.dispatchEvent(new CustomEvent("auth-success"));
};

export const logoutUser = async ({
  redirectTo = "/login",
  endpoint = "/auth/logout",
}: {
  redirectTo?: string;
  endpoint?: string;
} = {}) => {
  try {
    const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    await fetch(`${getBackendBaseUrl()}${normalizedEndpoint}`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    // Ignore backend logout errors; we still clear the client session.
  }

  clearStoredAuth();

  if (typeof window !== "undefined") {
    window.location.href = redirectTo;
  }
};
