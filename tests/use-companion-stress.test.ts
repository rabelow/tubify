/**
 * Empirical Stress Test Suite for useCompanion Hook
 * 
 * Verifies:
 * 1. Rapid connection/disconnection cycles, async unmount races, and socket teardown leaks.
 * 2. 200ms timer interpolation behavior during track state transitions (paused -> playing -> ad -> finished).
 * 3. Clock drift re-alignment when local interpolated progress drifts > 0.8s from authoritative Socket.IO state.
 * 4. Custom playlist queue runner auto-advance when a track finishes, including rapid update skipping checks.
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { useCompanion, UseCompanionReturn } from '../src/hooks/useCompanion';
import type { CompanionState, SearchTrack } from '../src/types/companion';
import { saveConnectionProfile, clearConnectionProfile } from '../src/lib/storage';

// Mock Socket implementation tracking lifecycle
class MockSocket {
  public listeners: Record<string, Function[]> = {};
  public disconnected = false;
  public id: string;

  constructor() {
    this.id = Math.random().toString(36).substring(2, 9);
  }

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
      for (const cb of [...this.listeners[event]]) {
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

const createdSockets: MockSocket[] = [];
let activeMockSocket: MockSocket | null = null;

vi.mock('socket.io-client', () => {
  return {
    io: vi.fn(() => {
      const sock = new MockSocket();
      createdSockets.push(sock);
      activeMockSocket = sock;
      return sock;
    }),
  };
});

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

describe('useCompanion Empirical Stress Harness', () => {
  let originalFetch: typeof fetch;

  const sampleState: CompanionState = {
    player: {
      trackState: 1, // Playing
      videoProgress: 10.0,
      volume: 60,
      volumePercent: 60,
      muted: false,
      adPlaying: false,
      isPaused: false,
      seekbarCurrentPosition: 10.0,
      queue: {
        items: [],
        automixItems: [],
        selectedItemIndex: 0,
      },
    },
    video: {
      id: 'song-1',
      title: 'Stress Track 1',
      author: 'Stress Artist',
      album: 'Test Album',
      durationSeconds: 100,
    },
    playlistId: null,
  };

  beforeEach(() => {
    localStorage.clear();
    originalFetch = globalThis.fetch;
    createdSockets.length = 0;
    activeMockSocket = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // AREA 1: Rapid Connect / Disconnect & Async Teardown Leaks
  // ==========================================================================
  describe('Area 1: Connection Lifecycle, Rapid Toggling & Teardown Races', () => {
    it('rapidly mounts and unmounts 25 times without dangling active sockets', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'stress-token-1',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      // Mount and unmount rapidly in sequence
      for (let i = 0; i < 25; i++) {
        const { unmount } = renderHook(() => useCompanion({ autoConnect: true }));
        unmount();
      }

      // Allow any microtasks/promises to drain
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });

      // Every socket created must have been disconnected
      const activeSockets = createdSockets.filter((s) => !s.disconnected);
      expect(activeSockets.length).toBe(0);
    });

    it('unmounting while connection handshake is in flight does not leak a connected socket', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'stress-token-slow',
      });

      let resolveStateFetch: (val: any) => void;
      const slowStatePromise = new Promise((resolve) => {
        resolveStateFetch = resolve;
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return slowStatePromise;
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      const { unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      // Unmount while getState is still pending
      unmount();

      // Now resolve the pending getState response
      await act(async () => {
        resolveStateFetch!(new Response(JSON.stringify(sampleState), { status: 200 }));
        await new Promise((r) => setTimeout(r, 20));
      });

      // Verify no socket was created after unmount or any created socket was disconnected
      const leakedSockets = createdSockets.filter((s) => !s.disconnected);
      expect(leakedSockets.length).toBe(0);
    });

    it('calling disconnect() while auto-connect is in flight prevents transitioning back to connected', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'token-to-disconnect',
      });

      let resolveStateFetch: (val: any) => void;
      const slowStatePromise = new Promise((resolve) => {
        resolveStateFetch = resolve;
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return slowStatePromise;
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      // User calls disconnect() while getState is pending
      act(() => {
        result.current.disconnect();
      });

      expect(result.current.status).toBe('unpaired');
      expect(result.current.profile.token).toBeNull();

      // Now resolve the late getState response
      await act(async () => {
        resolveStateFetch!(new Response(JSON.stringify(sampleState), { status: 200 }));
        await new Promise((r) => setTimeout(r, 20));
      });

      // The hook must REMAIN unpaired and NOT resurrect into connected!
      expect(result.current.status).toBe('unpaired');
      const leakedSockets = createdSockets.filter((s) => !s.disconnected);
      expect(leakedSockets.length).toBe(0);

      unmount();
    });

    it('cancelling pairing while metadata check is in flight halts the pairing flow', async () => {
      let resolveMetadata: (val: any) => void;
      const slowMetadataPromise = new Promise((resolve) => {
        resolveMetadata = resolve;
      });

      const requestCodeMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: '9999' }), { status: 200 })
      );

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return slowMetadataPromise;
        }
        if (url.includes('/api/v1/auth/requestcode')) {
          return requestCodeMock();
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: false }));

      // Start pairing
      let pairingPromise: Promise<void>;
      act(() => {
        pairingPromise = result.current.startPairing('192.168.0.144', 9863);
      });

      // Immediately cancel pairing
      act(() => {
        result.current.cancelPairing();
      });

      expect(result.current.status).toBe('unpaired');

      // Now resolve metadata
      await act(async () => {
        resolveMetadata!(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        await pairingPromise!;
      });

      // Must NOT have requested a code or progressed to awaiting_approval
      expect(requestCodeMock).not.toHaveBeenCalled();
      expect(result.current.status).toBe('unpaired');
      expect(result.current.pairingCode).toBeNull();

      unmount();
    });
  });

  // ==========================================================================
  // AREA 2: 200ms Timer Interpolation & Track State Transitions
  // ==========================================================================
  describe('Area 2: 200ms Timer Interpolation Across Playback State Transitions', () => {
    it('accurately advances by 0.2s every 200ms when playing', async () => {
      vi.useFakeTimers();

      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'interp-token',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(result.current.interpolatedProgress).toBe(10.0);

      // Advance by 1000ms = 5 ticks of 200ms = +1.0s
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.interpolatedProgress).toBeCloseTo(11.0, 1);

      // Advance by another 400ms = 2 ticks = +0.4s
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(result.current.interpolatedProgress).toBeCloseTo(11.4, 1);

      unmount();
      vi.useRealTimers();
    });

    it('halts interpolation when transitioning to paused and resumes when resumed', async () => {
      vi.useFakeTimers();

      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'interp-token-transitions',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(activeMockSocket).not.toBeNull();

      // Playing: tick 400ms -> 10.4
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(result.current.interpolatedProgress).toBeCloseTo(10.4, 1);

      // Transition to Paused via Socket.IO
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            trackState: 0, // Paused
            isPaused: true,
            videoProgress: 10.4,
          },
        });
      });

      // Advance 1000ms: must NOT advance
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.interpolatedProgress).toBeCloseTo(10.4, 1);

      // Transition back to Playing
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            trackState: 1, // Playing
            isPaused: false,
            videoProgress: 10.4,
          },
        });
      });

      // Advance 600ms: advances by 0.6s -> 11.0
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(result.current.interpolatedProgress).toBeCloseTo(11.0, 1);

      unmount();
      vi.useRealTimers();
    });

    it('halts interpolation during ad playback and resumes after ad finishes', async () => {
      vi.useFakeTimers();

      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'ad-token',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      // Advance 400ms -> 10.4
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(result.current.interpolatedProgress).toBeCloseTo(10.4, 1);

      // Ad starts: trackState 1 but adPlaying: true
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            trackState: 1,
            adPlaying: true,
            videoProgress: 10.4,
          },
        });
      });

      // Advance 2000ms: must freeze
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.interpolatedProgress).toBeCloseTo(10.4, 1);

      // Ad ends
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            trackState: 1,
            adPlaying: false,
            videoProgress: 10.4,
          },
        });
      });

      // Advance 400ms -> resumes to 10.8
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(result.current.interpolatedProgress).toBeCloseTo(10.8, 1);

      unmount();
      vi.useRealTimers();
    });

    it('clamps interpolated progress strictly at durationSeconds without over-running', async () => {
      vi.useFakeTimers();

      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'clamp-token',
      });

      const nearEndState: CompanionState = {
        ...sampleState,
        player: {
          ...sampleState.player,
          videoProgress: 99.8,
        },
        video: {
          ...sampleState.video!,
          durationSeconds: 100,
        },
      };

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(nearEndState), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(result.current.interpolatedProgress).toBe(99.8);

      // Tick 200ms -> 100.0 (exact duration)
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current.interpolatedProgress).toBe(100);

      // Tick 1000ms more: must NOT exceed 100.0
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.interpolatedProgress).toBe(100);

      unmount();
      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // AREA 3: Clock Drift Re-alignment (> 0.8s threshold)
  // ==========================================================================
  describe('Area 3: Clock Drift Alignment and 0.8s Re-alignment Boundary', () => {
    it('preserves smooth local interpolation when authoritative drift is <= 0.8s', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'drift-token',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      expect(result.current.interpolatedProgress).toBe(10.0);

      // Minor drift: server reports 10.5 (+0.5s diff <= 0.8s)
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            videoProgress: 10.5,
          },
        });
      });

      // Must remain at local 10.0 to avoid micro-jitter
      expect(result.current.interpolatedProgress).toBe(10.0);

      // Minor negative drift: server reports 9.4 (-0.6s diff <= 0.8s)
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            videoProgress: 9.4,
          },
        });
      });

      // Must still remain at local 10.0
      expect(result.current.interpolatedProgress).toBe(10.0);

      unmount();
    });

    it('snaps immediately to authoritative progress when drift strictly exceeds 0.8s', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'snap-token',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      expect(result.current.interpolatedProgress).toBe(10.0);

      // Drift exceeds threshold: server reports 11.2 (diff = 1.2 > 0.8)
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            videoProgress: 11.2,
          },
        });
      });

      expect(result.current.interpolatedProgress).toBe(11.2);

      // User seeks backwards on desktop: server reports 3.0 (diff = 8.2 > 0.8)
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            videoProgress: 3.0,
          },
        });
      });

      expect(result.current.interpolatedProgress).toBe(3.0);

      // User seeks forward on desktop: server reports 75.0 (diff = 72.0 > 0.8)
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            videoProgress: 75.0,
          },
        });
      });

      expect(result.current.interpolatedProgress).toBe(75.0);

      unmount();
    });

    it('handles seekbarCurrentPosition fallback when videoProgress is omitted in state payload', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'seekbar-fallback-token',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      // Emit state where videoProgress is undefined, but seekbarCurrentPosition has shifted by 5.0s
      act(() => {
        activeMockSocket!.emit('state-update', {
          ...sampleState,
          player: {
            ...sampleState.player,
            videoProgress: undefined as any,
            seekbarCurrentPosition: 15.0,
          },
        });
      });

      expect(result.current.interpolatedProgress).toBe(15.0);

      unmount();
    });
  });

  // ==========================================================================
  // AREA 4: Custom Playlist Queue Runner Auto-Advance & Rapid-Update Vulnerability
  // ==========================================================================
  describe('Area 4: Custom Playlist Queue Runner Auto-Advance & Race Conditions', () => {
    it('advances to next track when track finishes (videoProgress >= duration - 1.5)', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'playlist-runner-token',
      });

      const dispatchedCommands: any[] = [];

      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        if (url.includes('/api/v1/command')) {
          dispatchedCommands.push(JSON.parse(init?.body as string));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      const customTracks: SearchTrack[] = [
        { videoId: 'trackA', title: 'Song A', artist: 'Artist A' },
        { videoId: 'trackB', title: 'Song B', artist: 'Artist B' },
      ];

      // Start custom playlist
      await act(async () => {
        await result.current.playCustomPlaylist(customTracks, 0);
      });

      expect(result.current.customQueueIndex).toBe(0);
      expect(dispatchedCommands).toEqual([
        { command: 'changeVideo', data: { videoId: 'trackA' } },
      ]);

      // Simulate track finishing on desktop: duration 100, progress 98.6 (>= 100 - 1.5)
      await act(async () => {
        activeMockSocket!.emit('state-update', {
          player: {
            ...sampleState.player,
            trackState: 1,
            videoProgress: 98.6,
          },
          video: {
            id: 'trackA',
            title: 'Song A',
            author: 'Artist A',
            durationSeconds: 100,
          },
          playlistId: null,
        });
        await new Promise((r) => setTimeout(r, 20));
      });

      // Must have advanced to trackB
      expect(result.current.customQueueIndex).toBe(1);
      expect(dispatchedCommands).toContainEqual({
        command: 'changeVideo',
        data: { videoId: 'trackB' },
      });

      unmount();
    });

    it('does NOT skip tracks if multiple rapid state updates arrive before desktop loads the next track', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'playlist-runner-token-skip',
      });

      const dispatchedCommands: any[] = [];

      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        if (url.includes('/api/v1/command')) {
          dispatchedCommands.push(JSON.parse(init?.body as string));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      const customTracks: SearchTrack[] = [
        { videoId: 'track1', title: 'Song 1', artist: 'Artist 1' },
        { videoId: 'track2', title: 'Song 2', artist: 'Artist 2' },
        { videoId: 'track3', title: 'Song 3', artist: 'Artist 3' },
        { videoId: 'track4', title: 'Song 4', artist: 'Artist 4' },
      ];

      // Start custom playlist at index 0 (track1)
      await act(async () => {
        await result.current.playCustomPlaylist(customTracks, 0);
      });

      expect(dispatchedCommands.length).toBe(1);
      expect(dispatchedCommands[0]).toEqual({ command: 'changeVideo', data: { videoId: 'track1' } });

      // Track 1 reaches near-end: update 1 at 98.6s
      await act(async () => {
        activeMockSocket!.emit('state-update', {
          player: {
            ...sampleState.player,
            trackState: 1,
            videoProgress: 98.6,
          },
          video: {
            id: 'track1',
            title: 'Song 1',
            author: 'Artist 1',
            durationSeconds: 100,
          },
          playlistId: null,
        });
        await new Promise((r) => setTimeout(r, 10));
      });

      // Update 1 triggered advance to track2
      expect(result.current.customQueueIndex).toBe(1);

      // Now, before desktop has switched to track2, desktop sends update 2 at 98.8s (track1 still ending)
      await act(async () => {
        activeMockSocket!.emit('state-update', {
          player: {
            ...sampleState.player,
            trackState: 1,
            videoProgress: 98.8,
          },
          video: {
            id: 'track1',
            title: 'Song 1',
            author: 'Artist 1',
            durationSeconds: 100,
          },
          playlistId: null,
        });
        await new Promise((r) => setTimeout(r, 10));
      });

      // CRITICAL STRESS CHECK:
      // Did update 2 incorrectly advance again to track3, skipping track2?
      // It must NOT advance to track3! It should stay at track2 while waiting for track2 to play.
      expect(result.current.customQueueIndex).toBe(1);
      const track3Commands = dispatchedCommands.filter(
        (cmd) => cmd.command === 'changeVideo' && cmd.data?.videoId === 'track3'
      );
      expect(track3Commands.length).toBe(0);

      unmount();
    });

    it('does not advance past the end of the custom playlist', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'playlist-runner-token-end',
      });

      const dispatchedCommands: any[] = [];

      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        if (url.includes('/api/v1/command')) {
          dispatchedCommands.push(JSON.parse(init?.body as string));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      const singleTrack: SearchTrack[] = [
        { videoId: 'onlyTrack', title: 'Only Song', artist: 'Solo' },
      ];

      await act(async () => {
        await result.current.playCustomPlaylist(singleTrack, 0);
      });

      // Single track finishes
      await act(async () => {
        activeMockSocket!.emit('state-update', {
          player: {
            ...sampleState.player,
            trackState: 1,
            videoProgress: 99.5,
          },
          video: {
            id: 'onlyTrack',
            title: 'Only Song',
            author: 'Solo',
            durationSeconds: 100,
          },
          playlistId: null,
        });
        await new Promise((r) => setTimeout(r, 10));
      });

      // customQueueIndex must remain 0
      expect(result.current.customQueueIndex).toBe(0);
      // Only initial play command dispatched
      expect(dispatchedCommands.length).toBe(1);

      unmount();
    });

    it('stopCustomPlaylist halts auto-advance completely', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'playlist-runner-token-stop',
      });

      const dispatchedCommands: any[] = [];

      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(sampleState), { status: 200 }));
        }
        if (url.includes('/api/v1/command')) {
          dispatchedCommands.push(JSON.parse(init?.body as string));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      const customTracks: SearchTrack[] = [
        { videoId: 'trackA', title: 'Song A', artist: 'Artist A' },
        { videoId: 'trackB', title: 'Song B', artist: 'Artist B' },
      ];

      await act(async () => {
        await result.current.playCustomPlaylist(customTracks, 0);
      });

      // User stops custom playlist
      act(() => {
        result.current.stopCustomPlaylist();
      });

      expect(result.current.customQueue).toBeNull();

      // Track finishes
      await act(async () => {
        activeMockSocket!.emit('state-update', {
          player: {
            ...sampleState.player,
            trackState: 1,
            videoProgress: 99.0,
          },
          video: {
            id: 'trackA',
            title: 'Song A',
            author: 'Artist A',
            durationSeconds: 100,
          },
          playlistId: null,
        });
        await new Promise((r) => setTimeout(r, 10));
      });

      // No second command should be sent
      expect(dispatchedCommands.length).toBe(1);

      unmount();
    });
  });
});
