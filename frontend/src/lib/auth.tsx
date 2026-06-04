import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { env } from "@/lib/env";

// Module-level state: intentionally outside React so api.ts can access the token
// synchronously via getAccessTokenSync() without requiring a hook context.
let _accessToken: string | null = null;
let _accessTokenExpiresAt: number | null = null;
let _refreshPromise: Promise<string | null> | null = null;
let _hasFailedRefreshThisSession = false;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface RefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface MeResponse {
  id: string;
  email: string;
}

function clearAccessToken() {
  _accessToken = null;
  _accessTokenExpiresAt = null;
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function hasUsableAccessToken() {
  return (
    _accessToken !== null &&
    _accessTokenExpiresAt !== null &&
    Date.now() < _accessTokenExpiresAt - ACCESS_TOKEN_REFRESH_SKEW_MS
  );
}

export async function getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
  if (!options.forceRefresh && hasUsableAccessToken()) {
    return _accessToken!;
  }

  const token = await _attemptRefresh(options.forceRefresh);
  if (token) {
    return token;
  }
  clearAccessToken();
  throw new Error("Missing authenticated session.");
}

export function getAccessTokenSync(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null, expiresInSeconds?: number | null) {
  if (!token) {
    clearAccessToken();
    return;
  }

  _accessToken = token;
  _accessTokenExpiresAt =
    typeof expiresInSeconds === "number" ? Date.now() + Math.max(expiresInSeconds, 0) * 1000 : null;
  _hasFailedRefreshThisSession = false;
}

async function _attemptRefresh(force = false): Promise<string | null> {
  if (force) {
    _hasFailedRefreshThisSession = false;
  }
  if (_hasFailedRefreshThisSession) return null;
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const response = await fetchWithTimeout(`${env.VITE_API_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        _hasFailedRefreshThisSession = true;
        return null;
      }
      const data: RefreshResponse = await response.json();
      if (
        typeof data.access_token !== "string" ||
        !data.access_token ||
        typeof data.expires_in !== "number" ||
        data.expires_in <= 0
      ) {
        clearAccessToken();
        _hasFailedRefreshThisSession = true;
        return null;
      }
      setAccessToken(data.access_token, data.expires_in);
      return data.access_token;
    } catch {
      _hasFailedRefreshThisSession = true;
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

export type User = { id: string; email: string } | null;

interface AuthContextValue {
  user: User;
  isLoading: boolean;
  ensureSession: () => Promise<boolean>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: false,
  ensureSession: async () => false,
  login: async () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensureSession = useCallback(async () => {
    if (user) {
      return true;
    }

    if (mountedRef.current) {
      setIsLoading(true);
    }

    try {
      const token = await _attemptRefresh();
      if (!token) {
        clearAccessToken();
        return false;
      }

      const response = await fetchWithTimeout(`${env.VITE_API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        clearAccessToken();
        return false;
      }

      const data: MeResponse = await response.json();
      if (mountedRef.current) {
        setUser(data);
      }
      return true;
    } catch {
      clearAccessToken();
      return false;
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch(`${env.VITE_API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || "Login failed.");
    }

    const data: LoginResponse = await response.json();
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof data.expires_in !== "number" ||
      data.expires_in <= 0
    ) {
      throw new Error("Login failed: invalid response.");
    }
    setAccessToken(data.access_token, data.expires_in);

    const meResponse = await fetchWithTimeout(`${env.VITE_API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (meResponse.ok) {
      const meData: MeResponse = await meResponse.json();
      setUser(meData);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetchWithTimeout(`${env.VITE_API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore
    }
    clearAccessToken();
    setUser(null);
    window.location.assign("/login");
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, ensureSession, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
