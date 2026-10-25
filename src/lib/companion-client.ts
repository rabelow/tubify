/**
 * Tubify Companion Server & Local API Client
 * 
 * Provides typed REST and WebSocket communication with:
 * 1. YTMDesktop v2 Companion Server (default port 9863)
 * 2. Tubify Local Vite API Middleware (default port 5173)
 */

import { io, Socket } from 'socket.io-client';
import type {
  CompanionState,
  PlaylistSummary,
  SearchTrack,
  EditablePlaylist,
} from '../types/companion';

export interface CompanionClientConfig {
  host: string;
  port: number;
  apiPort: number;
  token: string | null;
}

export interface RequestCodePayload {
  appId?: string;
  appName?: string;
  appVersion?: string;
}

export interface RequestCodeResponse {
  code: string;
}

export interface RequestTokenPayload {
  appId?: string;
  code: string;
}

export interface RequestTokenResponse {
  token: string;
}

export interface ChangeVideoPayload {
  videoId?: string | null;
  playlistId?: string | null;
}

export const COMPANION_COMMANDS = new Set([
  'playPause',
  'play',
  'pause',
  'next',
  'previous',
  'seekTo',
  'repeatMode',
  'shuffle',
  'toggleLike',
  'toggleDislike',
  'setVolume',
  'volumeUp',
  'volumeDown',
  'mute',
  'unmute',
  'playQueueIndex',
  'changeVideo',
]);

export class CompanionClient {
  public host: string;
  public port: number;
  public apiPort: number;
  public token: string | null;

  constructor(config?: Partial<CompanionClientConfig>) {
    this.host = config?.host ?? '192.168.0.144';
    this.port = config?.port ?? 9863;
    this.apiPort = config?.apiPort ?? 5173;
    this.token = config?.token ?? null;
  }

  /** Formats the base URL for YTMDesktop Companion Server */
  public getBaseUrl(host?: string, port?: number): string {
    return `http://${host ?? this.host}:${port ?? this.port}`;
  }

  /** Formats the base URL for Tubify Local API Middleware */
  public getLocalApiBaseUrl(host?: string, apiPort?: number): string {
    return `http://${host ?? this.host}:${apiPort ?? this.apiPort}`;
  }

  /**
   * Generates authorization headers.
   * CRITICAL: YTMDesktop strictly requires raw token string, never with 'Bearer ' prefix.
   */
  public getAuthHeader(token?: string): Record<string, string> {
    const rawToken = token ?? this.token;
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw new Error('Authorization token is required but was not provided.');
    }
    const cleanToken = rawToken.replace(/^Bearer\s+/i, '').trim();
    if (!cleanToken) {
      throw new Error('Authorization token is required but was not provided.');
    }
    return { Authorization: cleanToken };
  }

  // ==========================================================================
  // 1. Discovery & Metadata
  // ==========================================================================

  /** Checks server reachability and supported API versions (e.g. ['v1']) */
  async checkMetadata(host?: string, port?: number): Promise<{ apiVersions: string[] }> {
    const url = `${this.getBaseUrl(host, port)}/metadata`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to check metadata: HTTP ${res.status}`);
    }
    return res.json();
  }

  // ==========================================================================
  // 2. Pairing & Authentication Flow
  // ==========================================================================

  /**
   * Step 1 of Pairing: Request 4-digit numeric code from desktop companion server.
   * Note: The pairing authorization window must be active in desktop settings.
   */
  async requestCode(
    hostOrDetails?: string | RequestCodePayload,
    port?: number,
    details?: RequestCodePayload
  ): Promise<RequestCodeResponse> {
    let targetHost = this.host;
    let targetPort = this.port;
    let appDetails: RequestCodePayload | undefined;

    if (typeof hostOrDetails === 'object' && hostOrDetails !== null) {
      appDetails = hostOrDetails;
    } else {
      if (typeof hostOrDetails === 'string') targetHost = hostOrDetails;
      if (typeof port === 'number') targetPort = port;
      appDetails = details;
    }

    const url = `${this.getBaseUrl(targetHost, targetPort)}/api/v1/auth/requestcode`;
    const payload = {
      appId: appDetails?.appId ?? 'tubify',
      appName: appDetails?.appName ?? 'Tubify Remote',
      appVersion: appDetails?.appVersion ?? '1.0.0',
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {}

      if (res.status === 403 && errorBody?.code === 'AUTHORIZATION_DISABLED') {
        throw new Error(
          'Pairing disabled: Companion authorization requests are disabled on desktop. ' +
          'In YTMDesktop, open Settings -> Integrations -> Companion Server -> enable "Allow Pairing".'
        );
      }
      throw new Error(
        errorBody?.message ?? `Failed to request code: HTTP ${res.status}`
      );
    }

    return res.json();
  }

  /**
   * Step 2 of Pairing: Submit 4-digit code and await desktop user approval dialog.
   * Automatically updates this.token upon success.
   */
  async requestToken(
    hostOrPayload: string | RequestTokenPayload,
    portOrUndefined?: number,
    payloadOrUndefined?: RequestTokenPayload
  ): Promise<RequestTokenResponse> {
    let targetHost = this.host;
    let targetPort = this.port;
    let payload: RequestTokenPayload;

    if (typeof hostOrPayload === 'object' && hostOrPayload !== null) {
      payload = hostOrPayload;
    } else {
      targetHost = hostOrPayload;
      targetPort = portOrUndefined ?? this.port;
      payload = payloadOrUndefined!;
    }

    const url = `${this.getBaseUrl(targetHost, targetPort)}/api/v1/auth/request`;
    const body = {
      appId: payload.appId ?? 'tubify',
      code: payload.code,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let errorBody: any = null;
      try {
        errorBody = await res.json();
      } catch {}

      if (res.status === 403 && errorBody?.code === 'AUTHORIZATION_DENIED') {
        throw new Error('Pairing denied: The pairing request was rejected on the desktop.');
      }
      if (res.status === 504 && errorBody?.code === 'AUTHORIZATION_TIME_OUT') {
        throw new Error('Pairing timed out: No response from desktop user within 30 seconds.');
      }
      if (res.status === 400 && errorBody?.code === 'AUTHORIZATION_INVALID') {
        throw new Error('Pairing invalid: The 4-digit code is expired or invalid.');
      }
      throw new Error(
        errorBody?.message ?? `Failed to request token: HTTP ${res.status}`
      );
    }

    const data: RequestTokenResponse = await res.json();
    this.token = data.token;
    return data;
  }

  // ==========================================================================
  // 3. Playback State & Commands
  // ==========================================================================

  /** Fetches complete current state from desktop (Rate limited: 1 req / 5s) */
  async getState(token?: string, host?: string, port?: number): Promise<CompanionState> {
    const url = `${this.getBaseUrl(host, port)}/api/v1/state`;
    const res = await fetch(url, {
      headers: this.getAuthHeader(token),
    });

    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to fetch state: HTTP ${res.status}`);
    }

    return res.json();
  }

  /**
   * Dispatches a command to the YTMDesktop companion server.
   * Supports both sendCommand(token, command, data) and sendCommand(command, data).
   */
  async sendCommand(command: string, data?: any, token?: string, host?: string, port?: number): Promise<void>;
  async sendCommand(token: string, command: string, data?: any, host?: string, port?: number): Promise<void>;
  async sendCommand(
    tokenOrCommand: string,
    commandOrData?: any,
    maybeDataOrToken?: any,
    host?: string,
    port?: number
  ): Promise<void> {
    let token: string | undefined;
    let command: string;
    let data: any;

    if (tokenOrCommand && COMPANION_COMMANDS.has(tokenOrCommand)) {
      // Form: sendCommand(command, data?, token?, host?, port?)
      command = tokenOrCommand;
      data = commandOrData;
      token = typeof maybeDataOrToken === 'string' ? maybeDataOrToken : (this.token ?? undefined);
    } else if (typeof commandOrData === 'string' && COMPANION_COMMANDS.has(commandOrData)) {
      // Form: sendCommand(token, command, data?, host?, port?)
      token = tokenOrCommand ?? undefined;
      command = commandOrData;
      data = maybeDataOrToken;
    } else if (maybeDataOrToken !== undefined) {
      // 3 arguments provided and commandOrData is not a known command:
      // Form: sendCommand(token, command, data, host?, port?)
      token = tokenOrCommand ?? undefined;
      command = commandOrData;
      data = maybeDataOrToken;
    } else {
      // 1 or 2 arguments provided:
      // Form: sendCommand(command, data?)
      token = this.token ?? undefined;
      command = tokenOrCommand;
      data = commandOrData;
    }

    const url = `${this.getBaseUrl(host, port)}/api/v1/command`;
    const bodyObj: { command: string; data?: any } = { command };
    if (data !== undefined) {
      bodyObj.data = data;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeader(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
    });

    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to send command "${command}": HTTP ${res.status}`);
    }
  }

  // ==========================================================================
  // 4. Transport Helpers
  // ==========================================================================

  async playPause(token?: string): Promise<void> {
    return this.sendCommand('playPause', undefined, token);
  }

  async play(token?: string): Promise<void> {
    return this.sendCommand('play', undefined, token);
  }

  async pause(token?: string): Promise<void> {
    return this.sendCommand('pause', undefined, token);
  }

  async next(token?: string): Promise<void> {
    return this.sendCommand('next', undefined, token);
  }

  async previous(token?: string): Promise<void> {
    return this.sendCommand('previous', undefined, token);
  }

  async seekTo(seconds: number, token?: string): Promise<void> {
    const sanitized = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return this.sendCommand('seekTo', sanitized, token);
  }

  async repeatMode(mode: 0 | 1 | 2, token?: string): Promise<void> {
    return this.sendCommand('repeatMode', mode, token);
  }

  async shuffle(token?: string): Promise<void> {
    return this.sendCommand('shuffle', undefined, token);
  }

  async toggleLike(token?: string): Promise<void> {
    return this.sendCommand('toggleLike', undefined, token);
  }

  async toggleDislike(token?: string): Promise<void> {
    return this.sendCommand('toggleDislike', undefined, token);
  }

  // ==========================================================================
  // 5. Dedicated Remote Volume Helpers
  // ==========================================================================

  /**
   * Sets desktop volume directly (0..100%).
   * Automatically clamps out-of-range values to prevent HTTP 400 validation errors.
   */
  async setVolume(volume: number, token?: string): Promise<void> {
    const clamped = Number.isFinite(volume)
      ? Math.max(0, Math.min(100, Math.round(volume)))
      : (volume === Infinity ? 100 : 0);
    return this.sendCommand('setVolume', clamped, token);
  }

  /** Step volume up (+5% step in Tubify UI, native +10%) */
  async volumeUp(token?: string): Promise<void> {
    return this.sendCommand('volumeUp', undefined, token);
  }

  /** Step volume down (-5% step in Tubify UI, native -10%) */
  async volumeDown(token?: string): Promise<void> {
    return this.sendCommand('volumeDown', undefined, token);
  }

  /** Mutes desktop audio */
  async mute(token?: string): Promise<void> {
    return this.sendCommand('mute', undefined, token);
  }

  /** Unmutes desktop audio */
  async unmute(token?: string): Promise<void> {
    return this.sendCommand('unmute', undefined, token);
  }

  // ==========================================================================
  // 6. Queue & Navigation Helpers
  // ==========================================================================

  /** Directly navigates to a specific track index in the active desktop queue */
  async playQueueIndex(index: number, token?: string): Promise<void> {
    const sanitized = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
    return this.sendCommand('playQueueIndex', sanitized, token);
  }

  /**
   * Starts playback of a specific YouTube video, playlist, or both.
   * Throws an error if both videoId and playlistId are omitted.
   */
  async changeVideo(
    videoId: string | null | undefined,
    playlistId?: string | null | undefined,
    token?: string
  ): Promise<void> {
    const data: { videoId?: string; playlistId?: string } = {};
    if (videoId) data.videoId = videoId;
    if (playlistId) data.playlistId = playlistId;

    if (!data.videoId && !data.playlistId) {
      throw new Error('At least one of videoId or playlistId must be provided to changeVideo');
    }

    return this.sendCommand('changeVideo', data, token);
  }

  // ==========================================================================
  // 7. Native Desktop Playlists
  // ==========================================================================

  /** Fetches the user's YouTube Music library playlists from the desktop client */
  async getPlaylists(token?: string, host?: string, port?: number): Promise<PlaylistSummary[]> {
    const url = `${this.getBaseUrl(host, port)}/api/v1/playlists`;
    const res = await fetch(url, {
      headers: this.getAuthHeader(token),
    });

    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to fetch playlists: HTTP ${res.status}`);
    }

    return res.json();
  }

  // ==========================================================================
  // 8. Real-Time Socket.IO Connection
  // ==========================================================================

  /**
   * Establishes real-time WebSocket connection to /api/v1/realtime namespace.
   * Enforces transports: ['websocket'] and handshake authentication.
   */
  connectRealtime(
    host?: string,
    port?: number,
    token?: string,
    onStateUpdate?: (state: CompanionState) => void,
    onDisconnect?: (reason: string) => void
  ): Socket {
    const targetHost = host ?? this.host;
    const targetPort = port ?? this.port;
    const targetToken = token ?? this.token;

    if (!targetToken || typeof targetToken !== 'string' || !targetToken.trim()) {
      throw new Error('Authorization token is required to establish Socket.IO connection');
    }
    const cleanToken = targetToken.replace(/^Bearer\s+/i, '').trim();
    if (!cleanToken) {
      throw new Error('Authorization token is required to establish Socket.IO connection');
    }

    const socketUrl = `http://${targetHost}:${targetPort}/api/v1/realtime`;
    const socket = io(socketUrl, {
      transports: ['websocket'],
      auth: { token: cleanToken },
    });

    if (onStateUpdate) {
      socket.on('state-update', onStateUpdate);
    }
    if (onDisconnect) {
      socket.on('disconnect', onDisconnect);
    }

    return socket;
  }

  // ==========================================================================
  // 9. Local API Middleware Helpers (:5173/api)
  // ==========================================================================

  /** Queries YouTube Music WEB_REMIX search via the Vite local host middleware */
  async searchSongs(
    query: string,
    host?: string,
    apiPort?: number
  ): Promise<{ results: SearchTrack[] }> {
    const url = `${this.getLocalApiBaseUrl(host, apiPort)}/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to search songs: HTTP ${res.status}`);
    }
    return res.json();
  }

  /** Lists all host-persisted editable playlists */
  async getEditablePlaylists(host?: string, apiPort?: number): Promise<EditablePlaylist[]> {
    const url = `${this.getLocalApiBaseUrl(host, apiPort)}/api/playlists`;
    const res = await fetch(url);
    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to fetch editable playlists: HTTP ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : (data.playlists ?? []);
  }

  /** Creates a new editable playlist */
  async createEditablePlaylist(
    title: string,
    host?: string,
    apiPort?: number
  ): Promise<EditablePlaylist> {
    const url = `${this.getLocalApiBaseUrl(host, apiPort)}/api/playlists`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to create playlist: HTTP ${res.status}`);
    }
    return res.json();
  }

  /** Renames an existing editable playlist */
  async renameEditablePlaylist(
    id: string,
    title: string,
    host?: string,
    apiPort?: number
  ): Promise<EditablePlaylist> {
    const url = `${this.getLocalApiBaseUrl(host, apiPort)}/api/playlists/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to rename playlist: HTTP ${res.status}`);
    }
    return res.json();
  }

  /** Deletes an editable playlist */
  async deleteEditablePlaylist(
    id: string,
    host?: string,
    apiPort?: number
  ): Promise<boolean> {
    const url = `${this.getLocalApiBaseUrl(host, apiPort)}/api/playlists/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: 'DELETE',
    });
    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to delete playlist: HTTP ${res.status}`);
    }
    return true;
  }

  /** Appends a track to an editable playlist (deduplication handled on host) */
  async addTrackToPlaylist(
    playlistId: string,
    track: SearchTrack,
    host?: string,
    apiPort?: number
  ): Promise<EditablePlaylist> {
    const url = `${this.getLocalApiBaseUrl(host, apiPort)}/api/playlists/${encodeURIComponent(playlistId)}/tracks`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(track),
    });
    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to add track: HTTP ${res.status}`);
    }
    return res.json();
  }

  /** Removes a track from an editable playlist by videoId */
  async removeTrackFromPlaylist(
    playlistId: string,
    videoId: string,
    host?: string,
    apiPort?: number
  ): Promise<EditablePlaylist> {
    const url = `${this.getLocalApiBaseUrl(host, apiPort)}/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(videoId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
    });
    if (!res.ok) {
      let err: any = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.message ?? `Failed to remove track: HTTP ${res.status}`);
    }
    return res.json();
  }
}
