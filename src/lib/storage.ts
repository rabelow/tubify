import type { ConnectionProfile } from '../types/companion';

export const STORAGE_KEY = 'tubify.connection.v1';
export const DEFAULT_HOST = '192.168.0.144';
export const DEFAULT_PORT = 9863;
export const DEFAULT_API_PORT = 5173;
export const DEFAULT_APP_ID = 'tubify';

/**
 * Determines the smart default host IP.
 * If running in a browser accessed via a LAN IP (e.g. http://192.168.0.144:5173),
 * resolves window.location.hostname; otherwise falls back to DEFAULT_HOST.
 */
export function getDefaultHost(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname.length > 0) {
      return hostname;
    }
  }
  return DEFAULT_HOST;
}

/**
 * Returns a clean, unauthenticated ConnectionProfile with default values.
 */
export function getDefaultConnectionProfile(): ConnectionProfile {
  return {
    host: getDefaultHost(),
    port: DEFAULT_PORT,
    apiPort: DEFAULT_API_PORT,
    appId: DEFAULT_APP_ID,
    token: null,
  };
}

/**
 * Validates whether a value is a valid TCP port number (1..65535).
 */
function isValidPort(port: unknown): port is number {
  return (
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
  );
}

/**
 * Loads the connection profile from localStorage.
 * Falls back to default values if uninitialized, invalid, or corrupted.
 */
export function loadConnectionProfile(): ConnectionProfile {
  const fallback = getDefaultConnectionProfile();

  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }

    const host =
      typeof parsed.host === 'string' && parsed.host.trim().length > 0
        ? parsed.host.trim()
        : fallback.host;

    const port = isValidPort(parsed.port) ? parsed.port : DEFAULT_PORT;
    const apiPort = isValidPort(parsed.apiPort) ? parsed.apiPort : DEFAULT_API_PORT;

    const appId =
      typeof parsed.appId === 'string' && parsed.appId.trim().length > 0
        ? parsed.appId.trim()
        : DEFAULT_APP_ID;

    const token =
      typeof parsed.token === 'string' && parsed.token.trim().length > 0
        ? parsed.token.trim()
        : null;

    const lastConnected =
      typeof parsed.lastConnected === 'string' && parsed.lastConnected.trim().length > 0
        ? parsed.lastConnected.trim()
        : undefined;

    return {
      host,
      port,
      apiPort,
      appId,
      token,
      lastConnected,
    };
  } catch (err) {
    console.warn('[tubify:storage] Failed to parse connection profile, resetting to defaults:', err);
    return fallback;
  }
}

/**
 * Saves or updates fields in the persisted connection profile.
 * Merges partial updates with the current saved profile.
 */
export function saveConnectionProfile(profile: Partial<ConnectionProfile>): ConnectionProfile {
  const current = loadConnectionProfile();

  const host =
    profile.host !== undefined && typeof profile.host === 'string' && profile.host.trim().length > 0
      ? profile.host.trim()
      : current.host;

  const port =
    profile.port !== undefined && isValidPort(profile.port)
      ? profile.port
      : current.port;

  const apiPort =
    profile.apiPort !== undefined && isValidPort(profile.apiPort)
      ? profile.apiPort
      : current.apiPort;

  const appId =
    profile.appId !== undefined && typeof profile.appId === 'string' && profile.appId.trim().length > 0
      ? profile.appId.trim()
      : current.appId;

  let token: string | null;
  if (profile.token !== undefined) {
    token =
      typeof profile.token === 'string' && profile.token.trim().length > 0
        ? profile.token.trim()
        : null;
  } else {
    token = current.token;
  }

  // If a valid token is set and no explicit lastConnected was provided, update it to now
  let lastConnected = profile.lastConnected !== undefined
    ? profile.lastConnected
    : current.lastConnected;

  if (token && profile.token !== undefined && profile.lastConnected === undefined) {
    lastConnected = new Date().toISOString();
  }

  const merged: ConnectionProfile = {
    host,
    port,
    apiPort,
    appId,
    token,
    lastConnected,
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.error('[tubify:storage] Failed to write connection profile to localStorage:', err);
    }
  }

  return merged;
}

/**
 * Clears the persisted connection profile from localStorage.
 */
export function clearConnectionProfile(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error('[tubify:storage] Failed to remove connection profile from localStorage:', err);
    }
  }
}

/**
 * Checks whether the stored profile currently has an authenticated token.
 */
export function hasValidToken(): boolean {
  const profile = loadConnectionProfile();
  return typeof profile.token === 'string' && profile.token.length > 0;
}
