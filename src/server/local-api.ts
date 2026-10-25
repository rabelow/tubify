/**
 * Tubify Vite Local API Middleware
 * 
 * Provides HTTP endpoints:
 * 1. GET /api/search?q=<query> -> queries YouTube Music WEB_REMIX via ytmusic-search
 * 2. Playlists CRUD backed by PlaylistsStore:
 *    - GET /api/playlists
 *    - POST /api/playlists
 *    - PATCH /api/playlists/:id
 *    - DELETE /api/playlists/:id
 *    - POST /api/playlists/:id/tracks
 *    - DELETE /api/playlists/:id/tracks/:videoId
 * 
 * Emits full CORS headers (Access-Control-Allow-Origin: *) on all responses
 * and handles OPTIONS preflight requests with HTTP 204.
 */

import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PlaylistsStore } from './playlists-store';
import { searchYouTubeMusic, searchYouTubePlaylists } from './ytmusic-search';

export interface LocalApiOptions {
  storeFilePath?: string;
  sessionFilePath?: string;
  playlistsStore?: PlaylistsStore;
}

export interface SharedCompanionSession {
  host: string;
  port: number;
  token: string | null;
  updatedAt: number;
}

/**
 * Sends a JSON response with CORS headers.
 */
function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  const jsonStr = JSON.stringify(data);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(jsonStr);
}

/**
 * Sends a preflight 204 No Content response with CORS headers.
 */
function sendOptionsPreflight(res: ServerResponse): void {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end();
}

/**
 * Buffers and parses JSON body from IncomingMessage.
 */
async function parseJsonBody<T = any>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({} as T);
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Creates the Connect middleware handler for Tubify local API.
 */
export function createLocalApiMiddleware(options: LocalApiOptions = {}): Connect.NextHandleFunction {
  const store = options.playlistsStore ?? new PlaylistsStore(options.storeFilePath);
  const sessionFilePath =
    options.sessionFilePath ?? path.resolve(process.cwd(), 'data', 'companion-session.json');

  function readSharedSession(): SharedCompanionSession | null {
    try {
      if (!fs.existsSync(sessionFilePath)) return null;
      const raw = fs.readFileSync(sessionFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.token === 'string' && parsed.token.trim()) {
        return {
          host: typeof parsed.host === 'string' && parsed.host.trim() ? parsed.host.trim() : '127.0.0.1',
          port: typeof parsed.port === 'number' && parsed.port > 0 ? parsed.port : 9863,
          token: parsed.token.trim(),
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        };
      }
    } catch {}
    return null;
  }

  function writeSharedSession(session: SharedCompanionSession | null): void {
    try {
      const dir = path.dirname(sessionFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!session || !session.token) {
        if (fs.existsSync(sessionFilePath)) {
          fs.unlinkSync(sessionFilePath);
        }
        return;
      }
      fs.writeFileSync(sessionFilePath, JSON.stringify(session, null, 2), 'utf-8');
    } catch {}
  }

  return async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const rawUrl = req.url ?? '/';
    if (!rawUrl.startsWith('/api')) {
      return next();
    }

    // Set CORS headers on all API responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const method = (req.method ?? 'GET').toUpperCase();

    // Handle OPTIONS Preflight
    if (method === 'OPTIONS') {
      return sendOptionsPreflight(res);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
    } catch {
      return sendJson(res, 400, { error: 'Invalid URL' });
    }

    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

    try {
      // 0. /api/companion/session -> shared authorization token vault across Web & Android APK
      if (pathname === '/api/companion/session') {
        if (method === 'GET') {
          const session = readSharedSession();
          return sendJson(res, 200, session ?? { host: null, port: 9863, token: null, updatedAt: 0 });
        }
        if (method === 'POST' || method === 'PUT') {
          let body: any;
          try {
            body = await parseJsonBody(req);
          } catch {
            return sendJson(res, 400, { error: 'Invalid JSON' });
          }
          const token = typeof body?.token === 'string' ? body.token.trim() : '';
          if (!token) {
            return sendJson(res, 400, { error: 'Missing required token' });
          }
          const saved: SharedCompanionSession = {
            host: typeof body?.host === 'string' && body.host.trim() ? body.host.trim() : '127.0.0.1',
            port: typeof body?.port === 'number' && body.port > 0 ? body.port : 9863,
            token,
            updatedAt: Date.now(),
          };
          writeSharedSession(saved);
          return sendJson(res, 200, saved);
        }
        if (method === 'DELETE') {
          writeSharedSession(null);
          return sendJson(res, 200, { ok: true });
        }
      }

      // 1. GET /api/search?q=<query>
      if (pathname === '/api/search' && method === 'GET') {
        const query = parsedUrl.searchParams.get('q') ?? '';
        try {
          const results = await searchYouTubeMusic(query);
          return sendJson(res, 200, { results });
        } catch (err: any) {
          console.error('[tubify:local-api] Search error:', err);
          return sendJson(res, 502, {
            error: 'Failed to search YouTube Music upstream',
            details: err?.message ?? String(err),
          });
        }
      }

      // 2. GET /api/playlists/search?q=<query> -> search YouTube Music playlists without YTMDesktop rate limit
      if (pathname === '/api/playlists/search' && method === 'GET') {
        const query = parsedUrl.searchParams.get('q') ?? '';
        try {
          const results = await searchYouTubePlaylists(query);
          return sendJson(res, 200, { results });
        } catch (err: any) {
          console.error('[tubify:local-api] Playlist search error:', err);
          return sendJson(res, 502, {
            error: 'Failed to search YouTube Music playlists upstream',
            details: err?.message ?? String(err),
          });
        }
      }

      // 3. GET /api/playlists -> list playlists
      if (pathname === '/api/playlists' && method === 'GET') {
        const playlists = store.getPlaylists();
        return sendJson(res, 200, { playlists });
      }

      // 4. POST /api/playlists -> create new playlist (with optional initial tracks)
      if (pathname === '/api/playlists' && method === 'POST') {
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON' });
        }

        const title = typeof body?.title === 'string'
          ? body.title
          : (typeof body?.name === 'string' ? body.name : undefined);
        const tracks = Array.isArray(body?.tracks) ? body.tracks : undefined;

        const newPlaylist = store.createPlaylist(title, tracks);
        return sendJson(res, 200, newPlaylist);
      }

      // 4. /api/playlists/:id Routes
      const playlistIdMatch = pathname.match(/^\/api\/playlists\/([^/]+)$/);
      if (playlistIdMatch) {
        const playlistId = decodeURIComponent(playlistIdMatch[1]);

        if (method === 'GET') {
          const pl = store.getPlaylist(playlistId);
          if (!pl) {
            return sendJson(res, 404, { error: 'Playlist not found' });
          }
          return sendJson(res, 200, pl);
        }

        if (method === 'PATCH') {
          let body: any;
          try {
            body = await parseJsonBody(req);
          } catch {
            return sendJson(res, 400, { error: 'Invalid JSON' });
          }

          const title = typeof body?.title === 'string'
            ? body.title
            : (typeof body?.name === 'string' ? body.name : '');

          const updated = store.renamePlaylist(playlistId, title);
          if (!updated) {
            return sendJson(res, 404, { error: 'Playlist not found' });
          }
          return sendJson(res, 200, updated);
        }

        if (method === 'DELETE') {
          const ok = store.deletePlaylist(playlistId);
          if (!ok) {
            return sendJson(res, 404, { error: 'Playlist not found' });
          }
          return sendJson(res, 200, { ok: true, success: true });
        }
      }

      // 5. POST /api/playlists/:id/tracks -> add track
      const addTrackMatch = pathname.match(/^\/api\/playlists\/([^/]+)\/tracks$/);
      if (addTrackMatch && method === 'POST') {
        const playlistId = decodeURIComponent(addTrackMatch[1]);
        let trackPayload: any;
        try {
          trackPayload = await parseJsonBody(req);
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON' });
        }

        if (!trackPayload || typeof trackPayload.videoId !== 'string' || !trackPayload.videoId.trim()) {
          return sendJson(res, 400, { error: 'Missing required videoId in track payload' });
        }

        const updated = store.addTrack(playlistId, trackPayload);
        if (!updated) {
          return sendJson(res, 404, { error: 'Playlist not found' });
        }
        return sendJson(res, 200, updated);
      }

      // 6. DELETE /api/playlists/:id/tracks/:videoId -> remove track
      const removeTrackMatch = pathname.match(/^\/api\/playlists\/([^/]+)\/tracks\/([^/]+)$/);
      if (removeTrackMatch && method === 'DELETE') {
        const playlistId = decodeURIComponent(removeTrackMatch[1]);
        const videoId = decodeURIComponent(removeTrackMatch[2]);

        const updated = store.removeTrack(playlistId, videoId);
        if (!updated) {
          return sendJson(res, 404, { error: 'Playlist not found' });
        }
        return sendJson(res, 200, updated);
      }

      // Any unrecognized /api/* path
      return sendJson(res, 404, { error: `Endpoint not found: ${pathname}` });
    } catch (err: any) {
      console.error('[tubify:local-api] Unhandled error:', err);
      return sendJson(res, 500, { error: 'Internal Server Error', details: err?.message });
    }
  };
}

/**
 * Vite plugin mounting local API endpoints (/api/search, /api/playlists).
 * Hooks into both configureServer and configurePreviewServer.
 */
export function localApiPlugin(storeFilePath?: string): Plugin {
  const middleware = createLocalApiMiddleware({ storeFilePath });

  return {
    name: 'tubify-local-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
