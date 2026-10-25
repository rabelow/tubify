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
import { PlaylistsStore } from './playlists-store';
import { searchYouTubeMusic } from './ytmusic-search';

export interface LocalApiOptions {
  storeFilePath?: string;
  playlistsStore?: PlaylistsStore;
}

/**
 * Sends a JSON response with CORS headers.
 */
function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  const jsonStr = JSON.stringify(data);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(jsonStr);
}

/**
 * Sends a preflight 204 No Content response with CORS headers.
 */
function sendOptionsPreflight(res: ServerResponse): void {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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

  return async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const rawUrl = req.url ?? '/';
    if (!rawUrl.startsWith('/api')) {
      return next();
    }

    // Set CORS headers on all API responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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

      // 2. GET /api/playlists -> list playlists
      if (pathname === '/api/playlists' && method === 'GET') {
        const playlists = store.getPlaylists();
        return sendJson(res, 200, { playlists });
      }

      // 3. POST /api/playlists -> create new playlist
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

        const newPlaylist = store.createPlaylist(title);
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
