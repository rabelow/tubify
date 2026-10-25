import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLocalApiMiddleware } from '../src/server/local-api';
import { PlaylistsStore } from '../src/server/playlists-store';
import * as ytSearchModule from '../src/server/ytmusic-search';

class MockIncomingMessage extends EventEmitter {
  public method: string;
  public url: string;
  public headers: Record<string, string>;

  constructor(method: string, url: string, headers: Record<string, string> = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
  }
}

class MockServerResponse {
  public statusCode: number = 200;
  public headers: Record<string, string> = {};
  public body: string = '';
  public finished: boolean = false;

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }

  end(data?: string) {
    if (data) this.body = data;
    this.finished = true;
  }
}

describe('Local API Middleware (Connect/Vite)', () => {
  let tempDir: string;
  let storePath: string;
  let store: PlaylistsStore;
  let middleware: ReturnType<typeof createLocalApiMiddleware>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubify-local-api-test-'));
    storePath = path.join(tempDir, 'playlists.json');
    store = new PlaylistsStore(storePath);
    middleware = createLocalApiMiddleware({ playlistsStore: store });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('delegates non-/api requests to next()', async () => {
    const req = new MockIncomingMessage('GET', '/index.html') as any;
    const res = new MockServerResponse() as any;
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.finished).toBe(false);
  });

  it('handles OPTIONS preflight with 204 and CORS headers', async () => {
    const req = new MockIncomingMessage('OPTIONS', '/api/playlists') as any;
    const res = new MockServerResponse() as any;

    await middleware(req, res, () => {});

    expect(res.statusCode).toBe(204);
    expect(res.getHeader('access-control-allow-origin')).toBe('*');
    expect(res.getHeader('access-control-allow-methods')).toContain('GET');
    expect(res.getHeader('access-control-allow-methods')).toContain('POST');
    expect(res.getHeader('access-control-allow-headers')).toContain('Content-Type');
    expect(res.finished).toBe(true);
  });

  it('GET /api/search delegates to searchYouTubeMusic and returns results', async () => {
    const searchSpy = vi.spyOn(ytSearchModule, 'searchYouTubeMusic').mockResolvedValueOnce([
      {
        videoId: '4D7u5KF7SP8',
        title: 'Get Lucky',
        artist: 'Daft Punk',
      },
    ]);

    const req = new MockIncomingMessage('GET', '/api/search?q=Daft+Punk') as any;
    const res = new MockServerResponse() as any;

    await middleware(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('access-control-allow-origin')).toBe('*');
    const parsed = JSON.parse(res.body);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].videoId).toBe('4D7u5KF7SP8');
    expect(searchSpy).toHaveBeenCalledWith('Daft Punk');
  });

  it('GET /api/search handles upstream errors with HTTP 502', async () => {
    vi.spyOn(ytSearchModule, 'searchYouTubeMusic').mockRejectedValueOnce(
      new Error('Network failure')
    );

    const req = new MockIncomingMessage('GET', '/api/search?q=error') as any;
    const res = new MockServerResponse() as any;

    await middleware(req, res, () => {});

    expect(res.statusCode).toBe(502);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('Failed to search');
  });

  it('full Playlists CRUD lifecycle: create, list, add track, rename, remove track, delete', async () => {
    // 1. POST /api/playlists (Create)
    const createReq = new MockIncomingMessage('POST', '/api/playlists') as any;
    const createRes = new MockServerResponse() as any;
    const createPromise = middleware(createReq, createRes, () => {});
    createReq.emit('data', JSON.stringify({ title: 'My Favorites' }));
    createReq.emit('end');
    await createPromise;

    expect(createRes.statusCode).toBe(200);
    const createdPlaylist = JSON.parse(createRes.body);
    expect(createdPlaylist.title).toBe('My Favorites');
    const playlistId = createdPlaylist.id;

    // 2. GET /api/playlists (List)
    const listReq = new MockIncomingMessage('GET', '/api/playlists') as any;
    const listRes = new MockServerResponse() as any;
    await middleware(listReq, listRes, () => {});
    expect(listRes.statusCode).toBe(200);
    const listData = JSON.parse(listRes.body);
    expect(listData.playlists).toHaveLength(1);
    expect(listData.playlists[0].id).toBe(playlistId);

    // 3. POST /api/playlists/:id/tracks (Add Track)
    const addTrackReq = new MockIncomingMessage(
      'POST',
      `/api/playlists/${playlistId}/tracks`
    ) as any;
    const addTrackRes = new MockServerResponse() as any;
    const addPromise = middleware(addTrackReq, addTrackRes, () => {});
    addTrackReq.emit(
      'data',
      JSON.stringify({
        videoId: 'fJ9rUzIMcZQ',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
      })
    );
    addTrackReq.emit('end');
    await addPromise;

    expect(addTrackRes.statusCode).toBe(200);
    const withTrack = JSON.parse(addTrackRes.body);
    expect(withTrack.tracks).toHaveLength(1);
    expect(withTrack.tracks[0].videoId).toBe('fJ9rUzIMcZQ');

    // Duplicate Add Test
    const addDupReq = new MockIncomingMessage(
      'POST',
      `/api/playlists/${playlistId}/tracks`
    ) as any;
    const addDupRes = new MockServerResponse() as any;
    const dupPromise = middleware(addDupReq, addDupRes, () => {});
    addDupReq.emit('data', JSON.stringify({ videoId: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody' }));
    addDupReq.emit('end');
    await dupPromise;
    const afterDup = JSON.parse(addDupRes.body);
    expect(afterDup.tracks).toHaveLength(1); // Length did not change

    // 4. PATCH /api/playlists/:id (Rename)
    const patchReq = new MockIncomingMessage('PATCH', `/api/playlists/${playlistId}`) as any;
    const patchRes = new MockServerResponse() as any;
    const patchPromise = middleware(patchReq, patchRes, () => {});
    patchReq.emit('data', JSON.stringify({ title: 'Best Rock' }));
    patchReq.emit('end');
    await patchPromise;

    expect(patchRes.statusCode).toBe(200);
    const renamed = JSON.parse(patchRes.body);
    expect(renamed.title).toBe('Best Rock');

    // 5. DELETE /api/playlists/:id/tracks/:videoId (Remove Track)
    const removeTrackReq = new MockIncomingMessage(
      'DELETE',
      `/api/playlists/${playlistId}/tracks/fJ9rUzIMcZQ`
    ) as any;
    const removeTrackRes = new MockServerResponse() as any;
    await middleware(removeTrackReq, removeTrackRes, () => {});

    expect(removeTrackRes.statusCode).toBe(200);
    const withoutTrack = JSON.parse(removeTrackRes.body);
    expect(withoutTrack.tracks).toHaveLength(0);

    // 6. DELETE /api/playlists/:id (Delete Playlist)
    const delReq = new MockIncomingMessage('DELETE', `/api/playlists/${playlistId}`) as any;
    const delRes = new MockServerResponse() as any;
    await middleware(delReq, delRes, () => {});

    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).ok).toBe(true);

    // Verify gone
    const verifyReq = new MockIncomingMessage('GET', `/api/playlists/${playlistId}`) as any;
    const verifyRes = new MockServerResponse() as any;
    await middleware(verifyReq, verifyRes, () => {});
    expect(verifyRes.statusCode).toBe(404);
  });

  it('returns 400 when adding track with missing videoId', async () => {
    const pl = store.createPlaylist('Test');
    const req = new MockIncomingMessage('POST', `/api/playlists/${pl.id}/tracks`) as any;
    const res = new MockServerResponse() as any;
    const promise = middleware(req, res, () => {});
    req.emit('data', JSON.stringify({ title: 'No Video ID' }));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('videoId');
  });

  it('returns 404 for unknown /api/* endpoints', async () => {
    const req = new MockIncomingMessage('GET', '/api/unknown-endpoint') as any;
    const res = new MockServerResponse() as any;
    await middleware(req, res, () => {});

    expect(res.statusCode).toBe(404);
  });
});
