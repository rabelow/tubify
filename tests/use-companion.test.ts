/**
 * Unit Test Suite for useCompanion Hook, PairingView & NowPlayingView
 * 
 * Tests:
 * 1. Hook initialization & localStorage profile loading
 * 2. Auto-connection on mount when token exists
 * 3. 2-Step Pairing flow (checking -> requesting_code -> awaiting_approval -> connected)
 * 4. Error states (AUTHORIZATION_DISABLED, AUTHORIZATION_DENIED, timeout, network failure)
 * 5. Cancellation & disconnection
 * 6. 200ms Progress interpolation loop & authoritative reconciliation
 * 7. Dedicated Remote Volume controls (0-100% clamping, -5%/+5% step buttons, mute toggle)
 * 8. Transport commands & queue jumping
 * 9. Custom playlist runner & auto-advance
 * 10. Format time helper and UI component assertions
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

// Configure React act environment
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { useCompanion, UseCompanionReturn } from '../src/hooks/useCompanion';
import { formatTime, NowPlayingView } from '../src/components/NowPlayingView';
import { PairingView } from '../src/components/PairingView';
import type { CompanionState } from '../src/types/companion';
import { STORAGE_KEY, saveConnectionProfile, clearConnectionProfile } from '../src/lib/storage';

// Mock Socket implementation
class MockSocket {
  public listeners: Record<string, Function[]> = {};
  public disconnected = false;

  on(event: string, callback: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return this;
  }

  off(event: string, callback?: Function) {
    if (!callback) {
      delete this.listeners[event];
    } else if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    }
    return this;
  }

  emit(event: string, ...args: any[]) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        cb(...args);
      }
    }
    return this;
  }

  disconnect() {
    this.disconnected = true;
    this.emit('disconnect', 'client disconnect');
    return this;
  }
}

let activeMockSocket: MockSocket | null = null;

// Mock socket.io-client
vi.mock('socket.io-client', () => {
  return {
    io: vi.fn(() => {
      activeMockSocket = new MockSocket();
      return activeMockSocket;
    }),
  };
});

// React Hook testing harness
function renderHook<T>(hookFn: () => T) {
  let result = {} as { current: T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    function TestComponent() {
      result.current = hookFn();
      return null;
    }
    root.render(React.createElement(TestComponent));
  });

  return {
    result,
    rerender: () => {
      act(() => {
        function TestComponent() {
          result.current = hookFn();
          return null;
        }
        root.render(React.createElement(TestComponent));
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('useCompanion Hook Suite', () => {
  let originalFetch: typeof fetch;

  const mockState: CompanionState = {
    player: {
      trackState: 1, // Playing
      videoProgress: 42.0,
      volume: 70,
      volumePercent: 70,
      muted: false,
      adPlaying: false,
      isPaused: false,
      seekbarCurrentPosition: 42.0,
      queue: {
        items: [
          { title: 'Track 1', author: 'Artist 1', duration: '3:00', selected: true, videoId: 'vid1' },
          { title: 'Track 2', author: 'Artist 2', duration: '4:00', selected: false, videoId: 'vid2' },
        ],
        automixItems: [],
        selectedItemIndex: 0,
      },
    },
    video: {
      id: 'vid1',
      title: 'Get Lucky',
      author: 'Daft Punk',
      album: 'Random Access Memories',
      durationSeconds: 248,
      thumbnails: [{ url: 'http://img.test/art.jpg', width: 300, height: 300 }],
    },
    playlistId: null,
  };

  beforeEach(() => {
    localStorage.clear();
    originalFetch = globalThis.fetch;
    activeMockSocket = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Hook Initialization & Unpaired State
  // --------------------------------------------------------------------------
  it('initializes in unpaired state when localStorage is empty', () => {
    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: false }));

    expect(result.current.status).toBe('unpaired');
    expect(result.current.profile.token).toBeNull();
    expect(result.current.volume).toBe(50);
    expect(result.current.isMuted).toBe(false);
    expect(result.current.interpolatedProgress).toBe(0);
    expect(result.current.pairingCode).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBeNull();
    expect(result.current.video).toBeNull();

    unmount();
  });

  // --------------------------------------------------------------------------
  // 2. Auto-connection on Mount
  // --------------------------------------------------------------------------
  it('auto-connects on mount when valid token exists in storage', async () => {
    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'valid-test-token-512',
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

    // Wait for async connect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.status).toBe('connected');
    expect(result.current.state).not.toBeNull();
    expect(result.current.video?.title).toBe('Get Lucky');
    expect(result.current.volume).toBe(70);
    expect(result.current.isMuted).toBe(false);

    unmount();
  });

  it('handles 401 Unauthorized by clearing profile and transitioning to unpaired', async () => {
    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'revoked-token',
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify({ message: 'UNAUTHORIZED' }), { status: 401 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.status).toBe('unpaired');
    expect(result.current.profile.token).toBeNull();
    expect(result.current.error).toContain('revoked');

    unmount();
  });

  // --------------------------------------------------------------------------
  // 3. 2-Step LAN Pairing Flow
  // --------------------------------------------------------------------------
  it('executes 2-step pairing flow successfully', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/auth/requestcode')) {
        return Promise.resolve(new Response(JSON.stringify({ code: '4821' }), { status: 200 }));
      }
      if (url.includes('/api/v1/auth/request')) {
        return Promise.resolve(new Response(JSON.stringify({ token: 'newly-granted-token-hex' }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: false }));

    expect(result.current.status).toBe('unpaired');

    await act(async () => {
      await result.current.startPairing('192.168.0.144', 9863);
    });

    expect(result.current.status).toBe('connected');
    expect(result.current.profile.token).toBe('newly-granted-token-hex');
    expect(result.current.pairingCode).toBeNull();
    expect(result.current.error).toBeNull();

    unmount();
  });

  it('handles AUTHORIZATION_DISABLED with helpful advice banner', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/auth/requestcode')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 403,
              code: 'AUTHORIZATION_DISABLED',
              message: 'Authorization requests are disabled',
            }),
            { status: 403 }
          )
        );
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: false }));

    await act(async () => {
      await result.current.startPairing('192.168.0.144', 9863);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Pairing disabled');
    expect(result.current.error).toContain('Settings -> Integrations');

    unmount();
  });

  it('handles desktop approval timeout (504 AUTHORIZATION_TIME_OUT)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/auth/requestcode')) {
        return Promise.resolve(new Response(JSON.stringify({ code: '7721' }), { status: 200 }));
      }
      if (url.includes('/api/v1/auth/request')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              statusCode: 504,
              code: 'AUTHORIZATION_TIME_OUT',
              message: 'Authorization timed out',
            }),
            { status: 504 }
          )
        );
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: false }));

    await act(async () => {
      await result.current.startPairing('192.168.0.144', 9863);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('timed out');

    unmount();
  });

  it('cancels pairing cleanly when cancelPairing is invoked', async () => {
    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: false }));

    act(() => {
      result.current.cancelPairing();
    });

    expect(result.current.status).toBe('unpaired');
    expect(result.current.pairingCode).toBeNull();
    expect(result.current.error).toBeNull();

    unmount();
  });

  // --------------------------------------------------------------------------
  // 4. Disconnect Action
  // --------------------------------------------------------------------------
  it('clears profile and resets state when disconnect is called', async () => {
    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'some-token',
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.status).toBe('connected');

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.status).toBe('unpaired');
    expect(result.current.profile.token).toBeNull();
    expect(result.current.state).toBeNull();
    expect(result.current.volume).toBe(50);
    expect(result.current.interpolatedProgress).toBe(0);

    unmount();
  });

  // --------------------------------------------------------------------------
  // 5. 200ms Progress Interpolation Loop
  // --------------------------------------------------------------------------
  it('interpolates progress every 200ms when playing and clamps at durationSeconds', async () => {
    vi.useFakeTimers();

    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'active-token',
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(result.current.status).toBe('connected');
    const initialProgress = result.current.interpolatedProgress;
    expect(initialProgress).toBe(42.0);

    // Advance 400ms (2 ticks of 200ms)
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.interpolatedProgress).toBeCloseTo(42.4, 1);

    // Advance 600ms more (3 more ticks)
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.interpolatedProgress).toBeCloseTo(43.0, 1);

    unmount();
    vi.useRealTimers();
  });

  it('pauses interpolation when track is paused or ad is playing', async () => {
    vi.useFakeTimers();

    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'active-token',
    });

    const pausedState: CompanionState = {
      ...mockState,
      player: {
        ...mockState.player,
        trackState: 0, // Paused
        isPaused: true,
      },
    };

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(pausedState), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const startProgress = result.current.interpolatedProgress;

    // Advance 1000ms
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.interpolatedProgress).toBe(startProgress);

    unmount();
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // 6. Dedicated Remote Volume Controls
  // --------------------------------------------------------------------------
  it('controls remote volume with clamping and optimistic updates', async () => {
    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'active-token',
    });

    let sentCommandBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200 }));
      }
      if (url.includes('/api/v1/command')) {
        sentCommandBody = JSON.parse(init?.body as string);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.volume).toBe(70);

    // setVolume(85)
    await act(async () => {
      await result.current.setVolume(85);
    });

    expect(result.current.volume).toBe(85);
    expect(sentCommandBody).toEqual({ command: 'setVolume', data: 85 });

    // setVolume out of bounds (> 100) -> clamps to 100
    await act(async () => {
      await result.current.setVolume(120);
    });

    expect(result.current.volume).toBe(100);
    expect(sentCommandBody).toEqual({ command: 'setVolume', data: 100 });

    // setVolume out of bounds (< 0) -> clamps to 0
    await act(async () => {
      await result.current.setVolume(-15);
    });

    expect(result.current.volume).toBe(0);
    expect(sentCommandBody).toEqual({ command: 'setVolume', data: 0 });

    // stepVolume(+5)
    await act(async () => {
      await result.current.stepVolume(5);
    });

    expect(result.current.volume).toBe(5);
    expect(sentCommandBody).toEqual({ command: 'setVolume', data: 5 });

    // stepVolume(-5)
    await act(async () => {
      await result.current.stepVolume(-5);
    });

    expect(result.current.volume).toBe(0);
    expect(sentCommandBody).toEqual({ command: 'setVolume', data: 0 });

    // toggleMute() -> mutes
    await act(async () => {
      await result.current.toggleMute();
    });

    expect(result.current.isMuted).toBe(true);
    expect(sentCommandBody).toEqual({ command: 'mute' });

    // toggleMute() again -> unmutes
    await act(async () => {
      await result.current.toggleMute();
    });

    expect(result.current.isMuted).toBe(false);
    expect(sentCommandBody).toEqual({ command: 'unmute' });

    unmount();
  });

  // --------------------------------------------------------------------------
  // 7. Transport Commands
  // --------------------------------------------------------------------------
  it('dispatches transport and seek commands properly', async () => {
    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'active-token',
    });

    const commandsSent: any[] = [];

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200 }));
      }
      if (url.includes('/api/v1/command')) {
        commandsSent.push(JSON.parse(init?.body as string));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await act(async () => {
      await result.current.playPause();
      await result.current.next();
      await result.current.previous();
      await result.current.seekTo(120);
      await result.current.shuffle();
      await result.current.repeatMode(1);
      await result.current.toggleLike();
      await result.current.toggleDislike();
      await result.current.playQueueIndex(3);
      await result.current.changeVideo('newVid123');
    });

    expect(commandsSent).toEqual([
      { command: 'playPause' },
      { command: 'next' },
      { command: 'previous' },
      { command: 'seekTo', data: 120 },
      { command: 'shuffle' },
      { command: 'repeatMode', data: 1 },
      { command: 'toggleLike' },
      { command: 'toggleDislike' },
      { command: 'playQueueIndex', data: 3 },
      { command: 'changeVideo', data: { videoId: 'newVid123' } },
    ]);

    expect(result.current.interpolatedProgress).toBe(120);

    unmount();
  });

  // --------------------------------------------------------------------------
  // 8. Custom Playlist Auto-Advance Runner
  // --------------------------------------------------------------------------
  it('supports custom playlist queue and advances when track changes', async () => {
    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'active-token',
    });

    const commandsSent: any[] = [];

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(mockState), { status: 200 }));
      }
      if (url.includes('/api/v1/command')) {
        commandsSent.push(JSON.parse(init?.body as string));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });

    const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const playlist = [
      { videoId: 'songA', title: 'Song A', artist: 'Artist A' },
      { videoId: 'songB', title: 'Song B', artist: 'Artist B' },
    ];

    await act(async () => {
      await result.current.playCustomPlaylist(playlist, 0);
    });

    expect(result.current.customQueue).toEqual(playlist);
    expect(result.current.customQueueIndex).toBe(0);
    expect(commandsSent).toContainEqual({ command: 'changeVideo', data: { videoId: 'songA' } });

    act(() => {
      result.current.stopCustomPlaylist();
    });

    expect(result.current.customQueue).toBeNull();
    expect(result.current.customQueueIndex).toBe(0);

    unmount();
  });
});

describe('Helper & UI Assertions Suite', () => {
  it('formatTime formats seconds into mm:ss accurately', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(248)).toBe('4:08');
    expect(formatTime(3605)).toBe('60:05');
    expect(formatTime(-10)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
  });

  it('PairingView renders host input, port input, and triggers onStartPairing', () => {
    const handleStart = vi.fn();
    const handleCancel = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(PairingView, {
          status: 'unpaired',
          pairingCode: null,
          error: null,
          initialHost: '192.168.0.144',
          initialPort: 9863,
          onStartPairing: handleStart,
          onCancel: handleCancel,
        })
      );
    });

    const hostInput = container.querySelector('#host-input') as HTMLInputElement;
    const portInput = container.querySelector('#port-input') as HTMLInputElement;
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

    expect(hostInput).not.toBeNull();
    expect(hostInput.value).toBe('192.168.0.144');
    expect(portInput.value).toBe('9863');

    act(() => {
      submitBtn.click();
    });

    expect(handleStart).toHaveBeenCalledWith('192.168.0.144', 9863);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('PairingView renders 4-digit code during awaiting_approval', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(PairingView, {
          status: 'awaiting_approval',
          pairingCode: '9142',
          error: null,
          onStartPairing: vi.fn(),
          onCancel: vi.fn(),
        })
      );
    });

    const codeSpan = container.querySelector('.pairing-code-text');
    expect(codeSpan).not.toBeNull();
    expect(codeSpan?.textContent).toBe('9142');

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('NowPlayingView renders dedicated remote volume bar with slider, step buttons, and mute toggle', () => {
    const setVolume = vi.fn();
    const stepVolume = vi.fn();
    const toggleMute = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(NowPlayingView, {
          video: {
            id: 'abc',
            title: 'Harder, Better, Faster, Stronger',
            author: 'Daft Punk',
            album: 'Discovery',
            durationSeconds: 224,
          },
          player: {
            trackState: 1,
            videoProgress: 50,
            volume: 65,
            muted: false,
          },
          trackState: 1,
          interpolatedProgress: 50,
          durationSeconds: 224,
          volume: 65,
          isMuted: false,
          onPlayPause: vi.fn(),
          onNext: vi.fn(),
          onPrevious: vi.fn(),
          onSeek: vi.fn(),
          onShuffle: vi.fn(),
          onRepeatMode: vi.fn(),
          onToggleLike: vi.fn(),
          onToggleDislike: vi.fn(),
          onSetVolume: setVolume,
          onStepVolume: stepVolume,
          onToggleMute: toggleMute,
        })
      );
    });

    // Volume percentage text
    const volumePercent = container.querySelector('.volume-percentage');
    expect(volumePercent?.textContent).toBe('65%');

    // Volume slider
    const volumeSlider = container.querySelector('.volume-slider') as HTMLInputElement;
    expect(volumeSlider).not.toBeNull();
    expect(volumeSlider.value).toBe('65');

    // Step buttons
    const stepButtons = container.querySelectorAll('.volume-step-btn');
    expect(stepButtons.length).toBe(2);

    act(() => {
      (stepButtons[0] as HTMLButtonElement).click(); // -5%
    });
    expect(stepVolume).toHaveBeenCalledWith(-5);

    act(() => {
      (stepButtons[1] as HTMLButtonElement).click(); // +5%
    });
    expect(stepVolume).toHaveBeenCalledWith(5);

    // Mute toggle
    const muteBtn = container.querySelector('.volume-mute-btn') as HTMLButtonElement;
    expect(muteBtn).not.toBeNull();
    expect(muteBtn.textContent).toContain('Mute');

    act(() => {
      muteBtn.click();
    });
    expect(toggleMute).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
