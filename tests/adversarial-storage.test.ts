import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  STORAGE_KEY,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_API_PORT,
  DEFAULT_APP_ID,
  getDefaultHost,
  getDefaultConnectionProfile,
  loadConnectionProfile,
  saveConnectionProfile,
  clearConnectionProfile,
  hasValidToken,
} from '../src/lib/storage';

describe('Adversarial Stress Suite: src/lib/storage.ts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    delete (Object.prototype as any).polluted;
  });

  describe('Corrupted & Malformed localStorage raw values', () => {
    const corruptedValues = [
      '{',
      '{"host": "192.168.1.1"',
      'invalid json',
      'undefined',
      'null',
      'true',
      'false',
      '12345',
      '"just a string"',
      '[]',
      '[1, 2, 3]',
      '{"host": null, "port": null}',
      '{"host": "", "port": 0, "apiPort": 70000}',
      '{"host": "  ", "port": -5, "appId": ""}',
      '{"token": ""}',
      '{"token": "   "}',
      '{"lastConnected": ""}',
      '{"host": 12345, "port": "9863"}',
      '{"__proto__": {"polluted": true}}',
      '{"constructor": {"prototype": {"polluted": true}}}',
      '{"port": 9863.5, "apiPort": NaN}',
      '{"port": Infinity}',
    ];

    corruptedValues.forEach((val, idx) => {
      it(`falls back safely to default profile for corrupted value #${idx}: ${val.slice(0, 30)}`, () => {
        localStorage.setItem(STORAGE_KEY, val);

        let profile: any;
        expect(() => {
          profile = loadConnectionProfile();
        }).not.toThrow();

        expect(profile).toBeDefined();
        expect(profile.host).toBe(DEFAULT_HOST);
        expect(profile.port).toBe(DEFAULT_PORT);
        expect(profile.apiPort).toBe(DEFAULT_API_PORT);
        expect(profile.appId).toBe(DEFAULT_APP_ID);
        expect(profile.token).toBeNull();
      });
    });

    it('handles raw null byte strings in storage without crashing', () => {
      localStorage.setItem(STORAGE_KEY, '{"host": "192.168.0.1\0", "token": "tok\0en"}');
      const profile = loadConnectionProfile();
      expect(profile).toBeDefined();
      expect(typeof profile.host).toBe('string');
    });

    it('handles huge payloads in localStorage without memory exhaustion', () => {
      const hugeString = 'a'.repeat(100000);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        host: hugeString,
        port: DEFAULT_PORT,
        apiPort: DEFAULT_API_PORT,
        appId: DEFAULT_APP_ID,
      }));

      const profile = loadConnectionProfile();
      expect(profile.host).toBe(hugeString);
      expect(profile.port).toBe(DEFAULT_PORT);
    });
  });

  describe('Port validation & TCP boundary checks (isValidPort)', () => {
    it('accepts valid TCP boundary port numbers (1 and 65535)', () => {
      saveConnectionProfile({ port: 1, apiPort: 65535 });
      const loaded = loadConnectionProfile();
      expect(loaded.port).toBe(1);
      expect(loaded.apiPort).toBe(65535);

      saveConnectionProfile({ port: 65535, apiPort: 1 });
      const loaded2 = loadConnectionProfile();
      expect(loaded2.port).toBe(65535);
      expect(loaded2.apiPort).toBe(1);
    });

    it('rejects invalid boundaries (0, 65536, negative, floats, NaN, Infinity)', () => {
      const invalidPorts = [0, -1, -9863, 65536, 100000, 9863.5, 3.14, NaN, Infinity, -Infinity];

      for (const badPort of invalidPorts) {
        localStorage.clear();
        saveConnectionProfile({ port: badPort as any, apiPort: badPort as any });
        const loaded = loadConnectionProfile();
        expect(loaded.port).toBe(DEFAULT_PORT);
        expect(loaded.apiPort).toBe(DEFAULT_API_PORT);
      }
    });

    it('rejects string-encoded port numbers to maintain strict type contracts', () => {
      saveConnectionProfile({ port: '9863' as any, apiPort: '5173' as any });
      const loaded = loadConnectionProfile();
      expect(loaded.port).toBe(DEFAULT_PORT);
      expect(loaded.apiPort).toBe(DEFAULT_API_PORT);
      expect(typeof loaded.port).toBe('number');
      expect(typeof loaded.apiPort).toBe('number');
    });
  });

  describe('saveConnectionProfile edge cases and sanitization', () => {
    it('trims whitespace-padded host and appId', () => {
      saveConnectionProfile({
        host: '   192.168.1.200 \n',
        appId: '  tubify-remote\t ',
      });

      const loaded = loadConnectionProfile();
      expect(loaded.host).toBe('192.168.1.200');
      expect(loaded.appId).toBe('tubify-remote');
    });

    it('preserves existing host/appId when passed whitespace-only or empty strings', () => {
      saveConnectionProfile({ host: '192.168.1.99', appId: 'my-custom-app' });
      saveConnectionProfile({ host: '   ', appId: '' });

      const loaded = loadConnectionProfile();
      expect(loaded.host).toBe('192.168.1.99');
      expect(loaded.appId).toBe('my-custom-app');
    });

    it('clears token when given empty string, whitespace, or null', () => {
      saveConnectionProfile({ token: 'active-session-token' });
      expect(hasValidToken()).toBe(true);

      saveConnectionProfile({ token: '' });
      expect(hasValidToken()).toBe(false);
      expect(loadConnectionProfile().token).toBeNull();

      saveConnectionProfile({ token: 'active-session-token-2' });
      expect(hasValidToken()).toBe(true);

      saveConnectionProfile({ token: '   ' });
      expect(hasValidToken()).toBe(false);
      expect(loadConnectionProfile().token).toBeNull();

      saveConnectionProfile({ token: 'active-session-token-3' });
      expect(hasValidToken()).toBe(true);

      saveConnectionProfile({ token: null });
      expect(hasValidToken()).toBe(false);
      expect(loadConnectionProfile().token).toBeNull();
    });

    it('automatically generates ISO timestamp for lastConnected on new token unless explicitly specified', () => {
      const before = new Date().toISOString();
      const saved = saveConnectionProfile({ token: 'token-abc' });
      const after = new Date().toISOString();

      expect(saved.lastConnected).toBeDefined();
      expect(saved.lastConnected! >= before).toBe(true);
      expect(saved.lastConnected! <= after).toBe(true);

      // Explicit lastConnected override
      const customDate = '2025-01-01T12:00:00.000Z';
      const savedExplicit = saveConnectionProfile({
        token: 'token-xyz',
        lastConnected: customDate,
      });
      expect(savedExplicit.lastConnected).toBe(customDate);
      expect(loadConnectionProfile().lastConnected).toBe(customDate);
    });

    it('does not mutate or pollute Object.prototype with malicious keys', () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}');
      saveConnectionProfile(malicious);

      expect((Object.prototype as any).polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();

      const loaded = loadConnectionProfile();
      expect((loaded as any).polluted).toBeUndefined();
    });
  });

  describe('DOMException & Storage Quota / Security Handling', () => {
    it('recovers gracefully if localStorage.getItem throws SecurityError', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });

      const profile = loadConnectionProfile();
      expect(profile.host).toBe(DEFAULT_HOST);
      expect(profile.token).toBeNull();
    });

    it('does not throw if localStorage.setItem throws QuotaExceededError', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

      expect(() => {
        const res = saveConnectionProfile({ host: '10.0.0.1' });
        expect(res.host).toBe('10.0.0.1');
      }).not.toThrow();
    });

    it('does not throw if localStorage.removeItem throws', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });

      expect(() => {
        clearConnectionProfile();
      }).not.toThrow();
    });
  });

  describe('getDefaultHost & SSR environment resilience', () => {
    it('returns DEFAULT_HOST when hostname is localhost or 127.0.0.1', () => {
      // In jsdom test environment, window.location.hostname is typically localhost
      const host = getDefaultHost();
      expect(host).toBe(DEFAULT_HOST);
    });

    it('resolves LAN IP from window.location when non-localhost', () => {
      const originalLocation = window.location;
      delete (window as any).location;
      (window as any).location = { hostname: '192.168.1.150' };

      expect(getDefaultHost()).toBe('192.168.1.150');

      (window as any).location = { hostname: 'tubify.local' };
      expect(getDefaultHost()).toBe('tubify.local');

      (window as any).location = { hostname: '' };
      expect(getDefaultHost()).toBe(DEFAULT_HOST);

      (window as any).location = originalLocation;
    });

    it('getDefaultConnectionProfile returns unauthenticated default profile', () => {
      const defaultProfile = getDefaultConnectionProfile();
      expect(defaultProfile).toEqual({
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        apiPort: DEFAULT_API_PORT,
        appId: DEFAULT_APP_ID,
        token: null,
      });
    });
  });
});
