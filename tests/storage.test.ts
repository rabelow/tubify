import { describe, it, expect, beforeEach } from 'vitest';
import {
  STORAGE_KEY,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_API_PORT,
  DEFAULT_APP_ID,
  loadConnectionProfile,
  saveConnectionProfile,
  clearConnectionProfile,
  hasValidToken,
} from '../src/lib/storage';

describe('src/lib/storage.ts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default connection profile when storage is empty', () => {
    const profile = loadConnectionProfile();
    expect(profile.host).toBe(DEFAULT_HOST);
    expect(profile.port).toBe(DEFAULT_PORT);
    expect(profile.apiPort).toBe(DEFAULT_API_PORT);
    expect(profile.appId).toBe(DEFAULT_APP_ID);
    expect(profile.token).toBeNull();
    expect(profile.lastConnected).toBeUndefined();
  });

  it('saves and reloads a complete connection profile', () => {
    const saved = saveConnectionProfile({
      host: '100.72.29.107',
      port: 9863,
      apiPort: 5173,
      appId: 'tubify',
      token: 'abcd1234token',
    });

    expect(saved.host).toBe('100.72.29.107');
    expect(saved.token).toBe('abcd1234token');
    expect(saved.lastConnected).toBeDefined();

    const loaded = loadConnectionProfile();
    expect(loaded.host).toBe('100.72.29.107');
    expect(loaded.token).toBe('abcd1234token');
    expect(hasValidToken()).toBe(true);
  });

  it('merges partial updates without losing existing fields', () => {
    saveConnectionProfile({
      host: '192.168.1.50',
      port: 9863,
      token: 'initial-token',
    });

    saveConnectionProfile({
      token: 'updated-token',
    });

    const loaded = loadConnectionProfile();
    expect(loaded.host).toBe('192.168.1.50');
    expect(loaded.token).toBe('updated-token');
  });

  it('recovers gracefully from corrupted JSON in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid-json{{{');
    const profile = loadConnectionProfile();
    expect(profile.host).toBe(DEFAULT_HOST);
    expect(profile.token).toBeNull();
  });

  it('ignores invalid port numbers and enforces defaults', () => {
    saveConnectionProfile({
      port: 999999 as any,
      apiPort: -1 as any,
    });

    const loaded = loadConnectionProfile();
    expect(loaded.port).toBe(DEFAULT_PORT);
    expect(loaded.apiPort).toBe(DEFAULT_API_PORT);
  });

  it('clears connection profile accurately', () => {
    saveConnectionProfile({ token: 'test-token' });
    expect(hasValidToken()).toBe(true);

    clearConnectionProfile();
    expect(hasValidToken()).toBe(false);
    expect(loadConnectionProfile().token).toBeNull();
  });
});
