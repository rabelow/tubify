import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompanionClient } from '../src/lib/companion-client';
import { io } from 'socket.io-client';

// Mock socket.io-client
vi.mock('socket.io-client', () => {
  return {
    io: vi.fn(),
  };
});

describe('CompanionClient', () => {
  let client: CompanionClient;
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new CompanionClient({
      host: '192.168.0.144',
      port: 9863,
      apiPort: 5173,
      token: 'test-token-512-hex-1234567890',
    });

    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('Discovery & Metadata', () => {
    it('queries /metadata and parses apiVersions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ apiVersions: ['v1'] }),
      });

      const res = await client.checkMetadata('127.0.0.1', 9863);
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:9863/metadata');
      expect(res).toEqual({ apiVersions: ['v1'] });
    });

    it('throws error when server responds with non-200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(client.checkMetadata()).rejects.toThrow('Failed to check metadata: HTTP 500');
    });
  });

  describe('Pairing Flow', () => {
    it('requestCode sends JSON payload and returns code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: '4821' }),
      });

      const res = await client.requestCode('192.168.0.144', 9863, {
        appId: 'tubify',
        appName: 'Tubify Remote',
        appVersion: '1.0.0',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:9863/api/v1/auth/requestcode',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: 'tubify',
            appName: 'Tubify Remote',
            appVersion: '1.0.0',
          }),
        }
      );
      expect(res).toEqual({ code: '4821' });
    });

    it('requestCode provides clear guidance when pairing is disabled on desktop (403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          statusCode: 403,
          code: 'AUTHORIZATION_DISABLED',
          error: 'Forbidden',
          message: 'Authorization requests are disabled',
        }),
      });

      await expect(client.requestCode()).rejects.toThrow(/Pairing disabled/);
    });

    it('requestToken submits 4-digit code and sets client.token upon approval', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'granted-hex-token-999' }),
      });

      const res = await client.requestToken('192.168.0.144', 9863, {
        appId: 'tubify',
        code: '4821',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:9863/api/v1/auth/request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: 'tubify', code: '4821' }),
        }
      );
      expect(res).toEqual({ token: 'granted-hex-token-999' });
      expect(client.token).toBe('granted-hex-token-999');
    });

    it('requestToken throws when desktop user denies pairing (403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          statusCode: 403,
          code: 'AUTHORIZATION_DENIED',
          message: 'Authorization request denied',
        }),
      });

      await expect(client.requestToken({ code: '4821' })).rejects.toThrow(/Pairing denied/);
    });

    it('requestToken throws when desktop user does not respond within 30s (504)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({
          statusCode: 504,
          code: 'AUTHORIZATION_TIME_OUT',
          message: 'Authorization timed out',
        }),
      });

      await expect(client.requestToken({ code: '4821' })).rejects.toThrow(/Pairing timed out/);
    });
  });

  describe('Playback State & Strict Raw Authorization Header', () => {
    it('getState passes raw Authorization header without Bearer prefix', async () => {
      const mockState = {
        player: { trackState: 1, videoProgress: 12.5, volume: 80, muted: false, adPlaying: false, queue: null },
        video: { id: '5NV6Rdv1a3I', title: 'Get Lucky', author: 'Daft Punk', album: 'RAM', durationSeconds: 369 },
        playlistId: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockState,
      });

      const res = await client.getState();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:9863/api/v1/state',
        {
          headers: {
            Authorization: 'test-token-512-hex-1234567890',
          },
        }
      );

      // Verify that Authorization NEVER starts with 'Bearer '
      const calledHeaders = mockFetch.mock.calls[0][1].headers;
      expect(calledHeaders.Authorization).not.toMatch(/^Bearer /i);
      expect(calledHeaders.Authorization).toBe('test-token-512-hex-1234567890');
      expect(res).toEqual(mockState);
    });

    it('getState throws error when no token is present', async () => {
      client.token = null;
      await expect(client.getState()).rejects.toThrow(/Authorization token is required/);
    });
  });

  describe('Transport Commands', () => {
    it('playPause sends { command: "playPause" }', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
      await client.playPause();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:9863/api/v1/command',
        {
          method: 'POST',
          headers: {
            Authorization: 'test-token-512-hex-1234567890',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ command: 'playPause' }),
        }
      );
    });

    it('play, pause, next, previous send correct command names', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.play();
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ command: 'play' });

      await client.pause();
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ command: 'pause' });

      await client.next();
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({ command: 'next' });

      await client.previous();
      expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({ command: 'previous' });
    });

    it('seekTo sends seconds data and floors negative numbers to 0', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.seekTo(95.8);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'seekTo',
        data: 95,
      });

      await client.seekTo(-10);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'seekTo',
        data: 0,
      });
    });

    it('shuffle, repeatMode, toggleLike, toggleDislike send correct bodies', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.shuffle();
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ command: 'shuffle' });

      await client.repeatMode(2);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ command: 'repeatMode', data: 2 });

      await client.toggleLike();
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({ command: 'toggleLike' });

      await client.toggleDislike();
      expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({ command: 'toggleDislike' });
    });
  });

  describe('Dedicated Remote Volume Controls', () => {
    it('setVolume sends clamped volume integer (0..100)', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.setVolume(50);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'setVolume',
        data: 50,
      });

      await client.setVolume(120); // Clamped to 100
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'setVolume',
        data: 100,
      });

      await client.setVolume(-15); // Clamped to 0
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
        command: 'setVolume',
        data: 0,
      });
    });

    it('volumeUp and volumeDown send correct step commands', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.volumeUp();
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ command: 'volumeUp' });

      await client.volumeDown();
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ command: 'volumeDown' });
    });

    it('mute and unmute send correct mute commands', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.mute();
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ command: 'mute' });

      await client.unmute();
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ command: 'unmute' });
    });
  });

  describe('Queue & Video Navigation', () => {
    it('playQueueIndex sends target index integer', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
      await client.playQueueIndex(4);

      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'playQueueIndex',
        data: 4,
      });
    });

    it('changeVideo sends videoId and optional playlistId', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.changeVideo('5NV6Rdv1a3I');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'changeVideo',
        data: { videoId: '5NV6Rdv1a3I' },
      });

      await client.changeVideo('5NV6Rdv1a3I', 'PL12345');
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'changeVideo',
        data: { videoId: '5NV6Rdv1a3I', playlistId: 'PL12345' },
      });

      await client.changeVideo(null, 'PL12345');
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
        command: 'changeVideo',
        data: { playlistId: 'PL12345' },
      });
    });

    it('changeVideo throws error if both videoId and playlistId are omitted', async () => {
      await expect(client.changeVideo(null, null)).rejects.toThrow(/At least one/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Native Desktop Playlists', () => {
    it('getPlaylists queries /api/v1/playlists with raw Authorization header', async () => {
      const mockPlaylists = [
        { id: 'VLPL1', title: 'Favorites' },
        { id: 'VLPL2', title: 'Workout' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPlaylists,
      });

      const res = await client.getPlaylists();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:9863/api/v1/playlists',
        {
          headers: {
            Authorization: 'test-token-512-hex-1234567890',
          },
        }
      );
      expect(res).toEqual(mockPlaylists);
    });
  });

  describe('Real-Time Socket.IO Channel', () => {
    it('connectRealtime configures socket with websocket transport and token auth', () => {
      const mockSocket = {
        on: vi.fn(),
        emit: vi.fn(),
      };
      (io as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockSocket);

      const onStateUpdate = vi.fn();
      const onDisconnect = vi.fn();

      const socket = client.connectRealtime(
        '192.168.0.144',
        9863,
        'test-token',
        onStateUpdate,
        onDisconnect
      );

      expect(io).toHaveBeenCalledWith('http://192.168.0.144:9863/api/v1/realtime', {
        transports: ['websocket'],
        auth: { token: 'test-token' },
      });
      expect(mockSocket.on).toHaveBeenCalledWith('state-update', onStateUpdate);
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', onDisconnect);
      expect(socket).toBe(mockSocket);
    });
  });

  describe('Local API Client (:5173/api)', () => {
    it('searchSongs queries /api/search?q=... and returns results', async () => {
      const mockResults = {
        results: [
          {
            videoId: '5NV6Rdv1a3I',
            title: 'Get Lucky',
            artist: 'Daft Punk',
            duration: '6:09',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResults,
      });

      const res = await client.searchSongs('Daft Punk');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:5173/api/search?q=Daft%20Punk'
      );
      expect(res).toEqual(mockResults);
    });

    it('getEditablePlaylists queries /api/playlists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ playlists: [{ id: 'p1', title: 'Chill', tracks: [] }] }),
      });

      const res = await client.getEditablePlaylists();
      expect(mockFetch).toHaveBeenCalledWith('http://192.168.0.144:5173/api/playlists');
      expect(res).toEqual([{ id: 'p1', title: 'Chill', tracks: [] }]);
    });

    it('createEditablePlaylist sends POST /api/playlists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'p2', title: 'Rock', tracks: [] }),
      });

      const res = await client.createEditablePlaylist('Rock');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:5173/api/playlists',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Rock' }),
        }
      );
      expect(res.title).toBe('Rock');
    });

    it('addTrackToPlaylist sends POST /api/playlists/:id/tracks', async () => {
      const track = {
        videoId: '5NV6Rdv1a3I',
        title: 'Get Lucky',
        artist: 'Daft Punk',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'p1', title: 'Chill', tracks: [track] }),
      });

      const res = await client.addTrackToPlaylist('p1', track);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:5173/api/playlists/p1/tracks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(track),
        }
      );
      expect(res.tracks).toHaveLength(1);
    });

    it('removeTrackFromPlaylist sends DELETE /api/playlists/:id/tracks/:videoId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'p1', title: 'Chill', tracks: [] }),
      });

      const res = await client.removeTrackFromPlaylist('p1', '5NV6Rdv1a3I');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:5173/api/playlists/p1/tracks/5NV6Rdv1a3I',
        {
          method: 'DELETE',
        }
      );
      expect(res.tracks).toHaveLength(0);
    });

    it('deleteEditablePlaylist sends DELETE /api/playlists/:id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const res = await client.deleteEditablePlaylist('p1');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://192.168.0.144:5173/api/playlists/p1',
        {
          method: 'DELETE',
        }
      );
      expect(res).toBe(true);
    });
  });
});
