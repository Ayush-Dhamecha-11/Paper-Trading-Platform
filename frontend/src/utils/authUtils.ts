const AUTH_TOKEN_KEY = "auth_token";
const AUTH_SESSION_KEY = "auth_session";
const REFRESH_TOKEN_KEY = "refresh_token";
const USER_INFO_KEY = "user_info";
let refreshRequest: Promise<boolean> | null = null;

export type StoredUserInfo = {
  name?: string;
  email?: string;
  theme?: "Light" | "Dark" | "light" | "dark";
  auto_trade?: boolean;
};

export const getBackendBaseUrl = () =>
  String(
    import.meta.env.VITE_BACKEND_URL ||
      import.meta.env.BACKEND_URL ||
      "http://localhost:8000"
  ).replace(/\/$/, "");

export const logBackendResponse = (response: Response, requestName: string) => {
  void response.clone().text().then((body) => {
    console.groupCollapsed(`[Backend response] ${requestName}`);
    console.log("URL:", response.url);
    console.log("Status:", response.status, response.statusText);
    console.log("Headers:", Object.fromEntries(response.headers.entries()));
    console.log("Body:", body);
    console.groupEnd();
  });
};

const refreshSession = async () => {
  if (refreshRequest) {
    return refreshRequest;
  }

  refreshRequest = fetch(`${getBackendBaseUrl()}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      logBackendResponse(response, "POST /auth/refresh");
      return response.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshRequest = null;
    });

  return refreshRequest;
};

const redirectAfterSessionExpiry = async () => {
  clearStoredAuth();
  const { showAuthNotice } = await import("./authNotice");
  showAuthNotice("Your session expired. Please log in again.", "error");
  window.location.href = "/login";
};

export const authenticatedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
) => {
  const requestInit = { ...init, credentials: "include" as RequestCredentials };
  const response = await fetch(input, requestInit);

  if (response.status !== 401) {
    return response;
  }

  if (await refreshSession()) {
    const retryResponse = await fetch(input, requestInit);

    if (retryResponse.status !== 401) {
      return retryResponse;
    }
  }

  await redirectAfterSessionExpiry();
  return response;
};

export const startSilentSessionRefresh = () => {
  const refresh = () => {
    void refreshSession();
  };

  refresh();
  const timer = window.setInterval(refresh, 60_000);
  return () => window.clearInterval(timer);
};

export const hasStoredAuth = () =>
  Boolean(
    localStorage.getItem(AUTH_TOKEN_KEY) ||
      localStorage.getItem(AUTH_SESSION_KEY) ||
      localStorage.getItem(REFRESH_TOKEN_KEY)
  );

export const setStoredAuthToken = (token: string, refreshToken?: string) => {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
  localStorage.setItem(AUTH_SESSION_KEY, "1");
  window.dispatchEvent(new CustomEvent("auth-success"));
};

export const getStoredAuthTokens = () => ({
  accessToken: localStorage.getItem(AUTH_TOKEN_KEY) || "",
  refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY) || "",
});

export const getStoredUserInfo = (): StoredUserInfo | null => {
  const storedUserInfo = sessionStorage.getItem(USER_INFO_KEY);

  if (!storedUserInfo) {
    return null;
  }

  try {
    return JSON.parse(storedUserInfo) as StoredUserInfo;
  } catch {
    sessionStorage.removeItem(USER_INFO_KEY);
    return null;
  }
};

export const setStoredUserInfo = (userInfo: StoredUserInfo) => {
  sessionStorage.setItem(USER_INFO_KEY, JSON.stringify(userInfo));
};

export const markUserLoggedIn = () => {
  localStorage.setItem(AUTH_SESSION_KEY, "1");
  window.dispatchEvent(new CustomEvent("auth-success"));
};

export const clearStoredAuth = () => {
  localStorage.clear();
  sessionStorage.clear();
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
    const response = await authenticatedFetch(`${getBackendBaseUrl()}${normalizedEndpoint}`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    logBackendResponse(response, `POST ${normalizedEndpoint}`);
  } catch {
    // Ignore backend logout errors; we still clear the client session.
  }

  clearStoredAuth();

  if (typeof window !== "undefined") {
    window.location.href = redirectTo;
  }
};
