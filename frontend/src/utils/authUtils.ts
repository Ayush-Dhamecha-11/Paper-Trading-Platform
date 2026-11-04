const AUTH_TOKEN_KEY = "auth_token";
const AUTH_SESSION_KEY = "auth_session";
const REFRESH_TOKEN_KEY = "refresh_token";
const USER_INFO_KEY = "user_info";
let refreshRequest: Promise<boolean> | null = null;
let requestCounter = 0;

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

export const logBackendRequest = (
  method: string,
  url: string,
  reqId?: number,
  customName?: string
) => {
  const timestamp = new Date().toLocaleTimeString();
  const idStr = typeof reqId === "number" ? `#${reqId} ` : "";
  const label = customName ? `${method} ${url} (${customName})` : `${method} ${url}`;

  console.log(
    `%c[Backend request ${idStr}] 🚀 ${label} | Sent at ${timestamp}`,
    "color: #00d2ff; font-weight: bold; background: rgba(0, 210, 255, 0.08); padding: 2px 6px; border-radius: 4px;"
  );
};

export const logBackendResponse = (
  response: Response,
  requestName: string,
  elapsedMs?: number,
  reqId?: number
) => {
  try {
    const idStr = typeof reqId === "number" ? `#${reqId} ` : "";
    const durationText = typeof elapsedMs === "number" ? ` in ${elapsedMs}ms (${(elapsedMs / 1000).toFixed(2)}s)` : "";
    const isOk = response.ok;
    const badgeColor = isOk ? "#20d89b" : response.status === 401 ? "#f59e0b" : "#ff5e6d";
    const bg = isOk ? "rgba(32, 216, 155, 0.08)" : "rgba(255, 94, 109, 0.08)";

    console.groupCollapsed(
      `%c[Backend response ${idStr}] 🏁 ${requestName} → ${response.status} ${response.statusText}${durationText}`,
      `color: ${badgeColor}; font-weight: bold; background: ${bg}; padding: 2px 6px; border-radius: 4px;`
    );
    if (typeof elapsedMs === "number") {
      console.log(`⏱️ Duration: ${elapsedMs}ms (${(elapsedMs / 1000).toFixed(2)}s)`);
    }
    console.log("📍 URL:", response.url);
    console.log("📊 Status:", response.status, response.statusText);
    console.log("🧾 Headers:", Object.fromEntries(response.headers.entries()));

    if (!response.bodyUsed) {
      void response.clone().text().then((body) => {
        try {
          const parsed = JSON.parse(body);
          console.log("📦 Body (JSON):", parsed);
        } catch {
          console.log("📦 Body (text):", body.length > 500 ? body.slice(0, 500) + "..." : body);
        }
      }).catch(() => {});
    }
    console.groupEnd();
  } catch {}
};

const refreshSession = async () => {
  if (refreshRequest) {
    return refreshRequest;
  }

  const reqId = ++requestCounter;
  const refreshUrl = `${getBackendBaseUrl()}/auth/refresh`;
  logBackendRequest("POST", refreshUrl, reqId, "Session Refresh");
  const startTime = performance.now();

  refreshRequest = fetch(refreshUrl, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      const elapsedMs = Math.round(performance.now() - startTime);
      logBackendResponse(response, "POST /auth/refresh", elapsedMs, reqId);
      return response.ok;
    })
    .catch((err) => {
      const elapsedMs = Math.round(performance.now() - startTime);
      console.error(`[Backend request #${reqId} FAILED] ❌ POST /auth/refresh after ${elapsedMs}ms:`, err);
      return false;
    })
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
  requestLabel?: string
) => {
  const reqId = ++requestCounter;
  const method = (init.method || "GET").toUpperCase();
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

  let friendlyName = requestLabel;
  if (!friendlyName) {
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      friendlyName = `${method} ${parsed.pathname}${parsed.search}`;
    } catch {
      friendlyName = `${method} ${rawUrl}`;
    }
  }

  logBackendRequest(method, rawUrl, reqId, friendlyName);
  const startTime = performance.now();

  const requestInit = { ...init, credentials: "include" as RequestCredentials };
  let response: Response;
  try {
    response = await fetch(input, requestInit);
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startTime);
    console.error(
      `%c[Backend request #${reqId} FAILED] ❌ ${friendlyName} after ${elapsedMs}ms`,
      "color: #ff5e6d; font-weight: bold;",
      error
    );
    throw error;
  }

  const elapsedMs = Math.round(performance.now() - startTime);
  logBackendResponse(response, friendlyName, elapsedMs, reqId);

  if (response.status !== 401) {
    return response;
  }

  if (await refreshSession()) {
    console.log(`[Backend request #${reqId}] 🔄 Retrying ${friendlyName} after token refresh...`);
    const retryStartTime = performance.now();
    const retryResponse = await fetch(input, requestInit);
    const retryElapsedMs = Math.round(performance.now() - retryStartTime);
    logBackendResponse(retryResponse, `${friendlyName} (retry)`, retryElapsedMs, reqId);

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
