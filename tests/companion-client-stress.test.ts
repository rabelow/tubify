import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompanionClient } from '../src/lib/companion-client';
import { io } from 'socket.io-client';

// Mock socket.io-client
vi.mock('socket.io-client', () => {
  return {
    io: vi.fn(),
  };
});

describe('CompanionClient Empirical Stress Suite', () => {
  let client: CompanionClient;
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new CompanionClient({
      host: '192.168.0.144',
      port: 9863,
      apiPort: 5173,
      token: 'valid-test-token-abcdef123456',
    });

    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Section 1: Volume Clamping & Boundary Numbers Stress Testing
  // ==========================================================================
  describe('Volume Clamping & Boundary Numbers', () => {
    it('clamps negative volumes (< 0) strictly to 0', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.setVolume(-50);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'setVolume',
        data: 0,
      });

      await client.setVolume(-1);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'setVolume',
        data: 0,
      });

      await client.setVolume(-0.0001);
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
        command: 'setVolume',
        data: 0,
      });
    });

    it('clamps overflowing volumes (> 100) strictly to 100', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.setVolume(101);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'setVolume',
        data: 100,
      });

      await client.setVolume(250);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'setVolume',
        data: 100,
      });

      await client.setVolume(999999);
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
        command: 'setVolume',
        data: 100,
      });
    });

    it('rounds floating point volumes to nearest integer', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.setVolume(45.7);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'setVolume',
        data: 46,
      });

      await client.setVolume(45.2);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'setVolume',
        data: 45,
      });

      await client.setVolume(0.4);
      expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({
        command: 'setVolume',
        data: 0,
      });

      await client.setVolume(99.6);
      expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({
        command: 'setVolume',
        data: 100,
      });
    });

    it('handles exact boundaries 0 and 100', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.setVolume(0);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'setVolume',
        data: 0,
      });

      await client.setVolume(100);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'setVolume',
        data: 100,
      });
    });

    it('handles infinite volumes (+Infinity -> 100, -Infinity -> 0)', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.setVolume(Infinity);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'setVolume',
        data: 100,
      });

      await client.setVolume(-Infinity);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'setVolume',
        data: 0,
      });
    });

    it('BUG CHECK: handles NaN volume input without sending null or invalid payload', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.setVolume(NaN);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      
      // The dispatch states: "NaN (fallback to 0 or clamp)"
      // YTMDesktop Companion requires an integer 0..100.
      // If data is null, YTMDesktop rejects with HTTP 400.
      expect(typeof payload.data).toBe('number');
      expect(Number.isNaN(payload.data)).toBe(false);
      expect(payload.data).toBeGreaterThanOrEqual(0);
      expect(payload.data).toBeLessThanOrEqual(100);
    });
  });

  // ==========================================================================
  // Section 2: seekTo & playQueueIndex Boundary Stress Testing
  // ==========================================================================
  describe('seekTo & playQueueIndex Boundary Testing', () => {
    it('seekTo floors floating seconds and clamps negatives to 0', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.seekTo(-500);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'seekTo',
        data: 0,
      });

      await client.seekTo(123.85);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'seekTo',
        data: 123,
      });
    });

    it('BUG CHECK: seekTo handles NaN without sending data: null', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.seekTo(NaN);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(typeof payload.data).toBe('number');
      expect(Number.isNaN(payload.data)).toBe(false);
    });

    it('BUG CHECK: seekTo handles Infinity without sending data: null', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.seekTo(Infinity);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(typeof payload.data).toBe('number');
      expect(Number.isFinite(payload.data)).toBe(true);
    });

    it('playQueueIndex clamps negative indices to 0 and floors floats', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.playQueueIndex(-5);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        command: 'playQueueIndex',
        data: 0,
      });

      await client.playQueueIndex(4.9);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
        command: 'playQueueIndex',
        data: 4,
      });
    });

    it('BUG CHECK: playQueueIndex handles NaN without sending data: null', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.playQueueIndex(NaN);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(typeof payload.data).toBe('number');
      expect(Number.isNaN(payload.data)).toBe(false);
    });
  });

  // ==========================================================================
  // Section 2.5: sendCommand Parameter Resolution Edge Cases
  // ==========================================================================
  describe('sendCommand Parameter Resolution Edge Cases', () => {
    it('BUG CHECK: sendCommand(command, stringData) does not mistake command name for token', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      // Suppose caller does sendCommand('changeVideo', 'dQw4w9WgXcQ')
      await client.sendCommand('changeVideo', 'dQw4w9WgXcQ');

      const calledUrl = mockFetch.mock.calls[0][0];
      const callOptions = mockFetch.mock.calls[0][1];
      const payload = JSON.parse(callOptions.body);

      // It should send command: 'changeVideo' with data: 'dQw4w9WgXcQ'
      // and Authorization should be client.token ('valid-test-token-abcdef123456')
      expect(callOptions.headers.Authorization).toBe('valid-test-token-abcdef123456');
      expect(payload.command).toBe('changeVideo');
      expect(payload.data).toBe('dQw4w9WgXcQ');
    });
  });

  // ==========================================================================
  // Section 3: Raw Authorization Header Enforcement Across ALL Methods
  // ==========================================================================
  describe('Raw Authorization Header Enforcement', () => {
    it('getState never sends Bearer prefix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ player: {}, video: {} }),
      });

      await client.getState();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('valid-test-token-abcdef123456');
      expect(headers.Authorization).not.toMatch(/^Bearer\s+/i);
    });

    it('sendCommand never sends Bearer prefix', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      await client.sendCommand('playPause');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('valid-test-token-abcdef123456');
      expect(headers.Authorization).not.toMatch(/^Bearer\s+/i);
    });

    it('getPlaylists never sends Bearer prefix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await client.getPlaylists();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('valid-test-token-abcdef123456');
      expect(headers.Authorization).not.toMatch(/^Bearer\s+/i);
    });

    it('all transport helper methods send raw Authorization without Bearer', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      const methods = [
        () => client.playPause(),
        () => client.play(),
        () => client.pause(),
        () => client.next(),
        () => client.previous(),
        () => client.seekTo(10),
        () => client.repeatMode(1),
        () => client.shuffle(),
        () => client.toggleLike(),
        () => client.toggleDislike(),
        () => client.setVolume(50),
        () => client.volumeUp(),
        () => client.volumeDown(),
        () => client.mute(),
        () => client.unmute(),
        () => client.playQueueIndex(2),
        () => client.changeVideo('vid123'),
      ];

      for (let i = 0; i < methods.length; i++) {
        await methods[i]();
        const callHeaders = mockFetch.mock.calls[i][1].headers;
        expect(callHeaders.Authorization).toBe('valid-test-token-abcdef123456');
        expect(callHeaders.Authorization).not.toMatch(/^Bearer\s+/i);
      }
    });

    it('BUG CHECK: getAuthHeader strips accidental "Bearer " prefix if user/storage provides it', () => {
      // YTMDesktop strictly rejects Bearer headers.
      // If a token was saved or passed as "Bearer my-token", getAuthHeader should sanitize it.
      const bearerClient = new CompanionClient({ token: 'Bearer my-token-999' });
      const auth = bearerClient.getAuthHeader();
      expect(auth.Authorization).not.toMatch(/^Bearer\s+/i);
      expect(auth.Authorization).toBe('my-token-999');

      const explicitAuth = client.getAuthHeader('Bearer override-token');
      expect(explicitAuth.Authorization).not.toMatch(/^Bearer\s+/i);
      expect(explicitAuth.Authorization).toBe('override-token');
    });

    it('throws descriptive error if token is null or undefined', () => {
      const emptyClient = new CompanionClient({ token: null });
      expect(() => emptyClient.getAuthHeader()).toThrow(/Authorization token is required/);
    });
  });

  // ==========================================================================
  // Section 4: Missing Token Handling & TypeError Crash Bug Check
  // ==========================================================================
  describe('Missing Token Handling & Robustness', () => {
    it('BUG CHECK: calling transport helpers when client.token is null does NOT throw TypeError on .length', async () => {
      const unauthedClient = new CompanionClient({ token: null });

      // Calling transport helpers when token is null should throw a descriptive Error about missing token,
      // NOT an unhandled TypeError: Cannot read properties of null (reading 'length')
      await expect(unauthedClient.playPause()).rejects.toThrow(/Authorization token is required/);
      await expect(unauthedClient.setVolume(50)).rejects.toThrow(/Authorization token is required/);
      await expect(unauthedClient.next()).rejects.toThrow(/Authorization token is required/);
      await expect(unauthedClient.previous()).rejects.toThrow(/Authorization token is required/);
      await expect(unauthedClient.seekTo(10)).rejects.toThrow(/Authorization token is required/);
      await expect(unauthedClient.playQueueIndex(1)).rejects.toThrow(/Authorization token is required/);
      await expect(unauthedClient.changeVideo('abc')).rejects.toThrow(/Authorization token is required/);
    });
  });

  // ==========================================================================
  // Section 5: Socket.IO WebSocket Transport Configuration
  // ==========================================================================
  describe('Socket.IO WebSocket Transport Enforcement', () => {
    it('strictly enforces transports: ["websocket"] and never allows polling fallback', () => {
      const mockSocket = { on: vi.fn(), emit: vi.fn() };
      (io as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockSocket);

      client.connectRealtime('192.168.0.144', 9863, 'my-secret-token');

      expect(io).toHaveBeenCalledTimes(1);
      const [url, options] = (io as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('http://192.168.0.144:9863/api/v1/realtime');
      expect(options.transports).toEqual(['websocket']);
      expect(options.auth).toEqual({ token: 'my-secret-token' });
    });

    it('connectRealtime throws descriptive error if no token is available', () => {
      const noTokenClient = new CompanionClient({ token: null });
      expect(() => noTokenClient.connectRealtime()).toThrow(
        /Authorization token is required to establish Socket.IO connection/
      );
    });

    it('connectRealtime attaches state-update and disconnect handlers when provided', () => {
      const mockSocket = { on: vi.fn(), emit: vi.fn() };
      (io as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockSocket);

      const stateHandler = vi.fn();
      const disconnectHandler = vi.fn();

      client.connectRealtime('192.168.0.144', 9863, 'tok', stateHandler, disconnectHandler);

      expect(mockSocket.on).toHaveBeenCalledWith('state-update', stateHandler);
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', disconnectHandler);
    });
  });

  // ==========================================================================
  // Section 6: Network Error Resilience & HTTP Failure Modes
  // ==========================================================================
  describe('Network Error Resilience & Failure Modes', () => {
    it('handles network drops (fetch throws TypeError / ECONNREFUSED) gracefully', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(client.checkMetadata()).rejects.toThrow('Failed to fetch');
      await expect(client.requestCode()).rejects.toThrow('Failed to fetch');
      await expect(client.requestToken({ code: '1234' })).rejects.toThrow('Failed to fetch');
      await expect(client.getState()).rejects.toThrow('Failed to fetch');
      await expect(client.sendCommand('playPause')).rejects.toThrow('Failed to fetch');
      await expect(client.getPlaylists()).rejects.toThrow('Failed to fetch');
      await expect(client.searchSongs('test')).rejects.toThrow('Failed to fetch');
    });

    it('handles HTTP 401 Unauthorized (token revoked) on getState and sendCommand', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized', message: 'Invalid or expired token' }),
      });

      await expect(client.getState()).rejects.toThrow(/Invalid or expired token/);
      await expect(client.sendCommand('playPause')).rejects.toThrow(/Invalid or expired token/);
      await expect(client.getPlaylists()).rejects.toThrow(/Invalid or expired token/);
    });

    it('handles HTTP 403 AUTHORIZATION_DISABLED on requestCode with actionable message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          statusCode: 403,
          code: 'AUTHORIZATION_DISABLED',
          message: 'Authorization requests are disabled',
        }),
      });

      await expect(client.requestCode()).rejects.toThrow(/Pairing disabled.*Allow Pairing/);
    });

    it('handles HTTP 403 generic/unrecognized response on requestCode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ message: 'IP address not allowed' }),
      });

      await expect(client.requestCode()).rejects.toThrow('IP address not allowed');
    });

    it('handles non-JSON error bodies (HTML 500 error page or proxy error) gracefully without crashing json()', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      });

      await expect(client.checkMetadata()).rejects.toThrow('Failed to check metadata: HTTP 500');
      await expect(client.requestCode()).rejects.toThrow('Failed to request code: HTTP 500');
      await expect(client.requestToken({ code: '1111' })).rejects.toThrow('Failed to request token: HTTP 500');
      await expect(client.getState()).rejects.toThrow('Failed to fetch state: HTTP 500');
      await expect(client.sendCommand('playPause')).rejects.toThrow(/HTTP 500/);
    });

    it('handles HTTP 404 Not Found on getState and commands', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Endpoint not found' }),
      });

      await expect(client.getState()).rejects.toThrow('Endpoint not found');
      await expect(client.sendCommand('unknownCommand')).rejects.toThrow('Endpoint not found');
    });

    it('handles HTTP 504 Gateway Timeout during pairing requestToken', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({
          statusCode: 504,
          code: 'AUTHORIZATION_TIME_OUT',
          message: 'Timed out waiting for approval',
        }),
      });

      await expect(client.requestToken({ code: '1234' })).rejects.toThrow(/Pairing timed out.*30 seconds/);
    });

    it('handles HTTP 400 Bad Request during pairing requestToken', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          statusCode: 400,
          code: 'AUTHORIZATION_INVALID',
          message: 'Invalid pairing code',
        }),
      });

      await expect(client.requestToken({ code: '9999' })).rejects.toThrow(/Pairing invalid.*expired or invalid/);
    });

    it('handles HTTP 403 Forbidden during pairing requestToken (user denied)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          statusCode: 403,
          code: 'AUTHORIZATION_DENIED',
          message: 'Authorization request denied',
        }),
      });

      await expect(client.requestToken({ code: '1234' })).rejects.toThrow(/Pairing denied.*rejected on the desktop/);
    });
  });
});
