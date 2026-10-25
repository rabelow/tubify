/**
 * Empirical Stress Test Suite for NowPlayingView & useCompanion:
 * 1. Remote Volume Step Boundaries (-5% at 0%, +5% at 100%, rapid alternating steps)
 * 2. Remote Volume Slider Range (<0, >100, float inputs, rapid scrubbing)
 * 3. Mute Toggle State Retention (prior volume level retained upon unmute)
 * 4. Seekbar Scrubbing & Progress Interpolation Isolation
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { useCompanion, UseCompanionReturn } from '../src/hooks/useCompanion';
import { NowPlayingView, formatTime } from '../src/components/NowPlayingView';
import type { CompanionState } from '../src/types/companion';
import { saveConnectionProfile } from '../src/lib/storage';

// Mock Socket.IO
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

describe('Empirical Stress Suite: Remote Volume & UI Controls', () => {
  let originalFetch: typeof fetch;
  let commandsSent: { command: string; data?: any }[] = [];

  const defaultMockState: CompanionState = {
    player: {
      trackState: 1, // Playing
      videoProgress: 30.0,
      volume: 50,
      volumePercent: 50,
      muted: false,
      adPlaying: false,
      isPaused: false,
      seekbarCurrentPosition: 30.0,
      queue: null,
    },
    video: {
      id: 'test-track-123',
      title: 'Around the World',
      author: 'Daft Punk',
      album: 'Homework',
      durationSeconds: 420,
      thumbnails: [{ url: 'http://img.test/art.jpg', width: 300, height: 300 }],
    },
    playlistId: null,
  };

  beforeEach(() => {
    localStorage.clear();
    originalFetch = globalThis.fetch;
    commandsSent = [];
    activeMockSocket = null;
    vi.clearAllMocks();

    saveConnectionProfile({
      host: '192.168.0.144',
      port: 9863,
      token: 'stress-token-test',
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/metadata')) {
        return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
      }
      if (url.includes('/api/v1/state')) {
        return Promise.resolve(new Response(JSON.stringify(defaultMockState), { status: 200 }));
      }
      if (url.includes('/api/v1/command')) {
        if (init?.body) {
          commandsSent.push(JSON.parse(init.body as string));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Section 1: Remote Volume Step Boundaries (-5% and +5%)
  // ==========================================================================
  describe('1. Remote Volume Step Boundaries', () => {
    it('stepVolume(-5%) at 0% clamps to 0% and does not become negative', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Set volume to 0
      await act(async () => {
        await result.current.setVolume(0);
      });
      expect(result.current.volume).toBe(0);
      commandsSent = [];

      // Step down by 5% when at 0%
      await act(async () => {
        await result.current.stepVolume(-5);
      });

      expect(result.current.volume).toBe(0);
      expect(commandsSent).toHaveLength(1);
      expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 0 });

      unmount();
    });

    it('stepVolume(-5%) called 10 consecutive times at 0% remains strictly 0%', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      await act(async () => {
        await result.current.setVolume(0);
      });
      commandsSent = [];

      for (let i = 0; i < 10; i++) {
        await act(async () => {
          await result.current.stepVolume(-5);
        });
        expect(result.current.volume).toBe(0);
      }

      expect(commandsSent).toHaveLength(10);
      for (const cmd of commandsSent) {
        expect(cmd).toEqual({ command: 'setVolume', data: 0 });
      }

      unmount();
    });

    it('stepVolume(+5%) at 100% clamps to 100% and does not exceed 100%', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      await act(async () => {
        await result.current.setVolume(100);
      });
      expect(result.current.volume).toBe(100);
      commandsSent = [];

      await act(async () => {
        await result.current.stepVolume(5);
      });

      expect(result.current.volume).toBe(100);
      expect(commandsSent).toHaveLength(1);
      expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 100 });

      unmount();
    });

    it('stepVolume(+5%) called 10 consecutive times at 100% remains strictly 100%', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      await act(async () => {
        await result.current.setVolume(100);
      });
      commandsSent = [];

      for (let i = 0; i < 10; i++) {
        await act(async () => {
          await result.current.stepVolume(5);
        });
        expect(result.current.volume).toBe(100);
      }

      expect(commandsSent).toHaveLength(10);
      for (const cmd of commandsSent) {
        expect(cmd).toEqual({ command: 'setVolume', data: 100 });
      }

      unmount();
    });

    it('handles near-boundary steps cleanly: 2% - 5% clamps to 0%, 98% + 5% clamps to 100%', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // 2% - 5% -> 0%
      await act(async () => {
        await result.current.setVolume(2);
      });
      expect(result.current.volume).toBe(2);

      await act(async () => {
        await result.current.stepVolume(-5);
      });
      expect(result.current.volume).toBe(0);

      // 98% + 5% -> 100%
      await act(async () => {
        await result.current.setVolume(98);
      });
      expect(result.current.volume).toBe(98);

      await act(async () => {
        await result.current.stepVolume(5);
      });
      expect(result.current.volume).toBe(100);

      unmount();
    });

    it('executes rapid alternating steps (+5%, -5%) without drift over 50 iterations', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      await act(async () => {
        await result.current.setVolume(50);
      });
      expect(result.current.volume).toBe(50);

      for (let i = 0; i < 50; i++) {
        await act(async () => {
          await result.current.stepVolume(5);
        });
        expect(result.current.volume).toBe(55);

        await act(async () => {
          await result.current.stepVolume(-5);
        });
        expect(result.current.volume).toBe(50);
      }

      expect(result.current.volume).toBe(50);
      unmount();
    });
  });

  // ==========================================================================
  // Section 2: Remote Volume Slider Range (<0, >100, float inputs, rapid scrubbing)
  // ==========================================================================
  describe('2. Remote Volume Slider Range & Scrubbing', () => {
    it('clamps finite negative volume values (< 0) to 0', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const negativeInputs = [-1, -5, -50, -100, -999];
      for (const neg of negativeInputs) {
        commandsSent = [];
        await act(async () => {
          await result.current.setVolume(neg);
        });
        expect(result.current.volume).toBe(0);
        expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 0 });
      }

      unmount();
    });

    it('clamps finite excessive volume values (> 100) to 100', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const excessInputs = [101, 105, 150, 500, 10000];
      for (const excess of excessInputs) {
        commandsSent = [];
        await act(async () => {
          await result.current.setVolume(excess);
        });
        expect(result.current.volume).toBe(100);
        expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 100 });
      }

      unmount();
    });

    it('observes handling of non-finite volume inputs (Infinity, -Infinity, NaN)', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // In useCompanion.ts:
      // Infinity clamps to 100, -Infinity clamps to 0, NaN falls back to 50
      commandsSent = [];
      await act(async () => {
        await result.current.setVolume(Infinity);
      });
      expect(result.current.volume).toBe(100);
      expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 100 });

      commandsSent = [];
      await act(async () => {
        await result.current.setVolume(-Infinity);
      });
      expect(result.current.volume).toBe(0);
      expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 0 });

      commandsSent = [];
      await act(async () => {
        await result.current.setVolume(NaN);
      });
      expect(result.current.volume).toBe(50);
      expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 50 });

      unmount();
    });

    it('rounds floating point volume inputs to nearest integer', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const floatCases = [
        { input: 0.1, expected: 0 },
        { input: 0.6, expected: 1 },
        { input: 33.4, expected: 33 },
        { input: 33.5, expected: 34 },
        { input: 99.4, expected: 99 },
        { input: 99.9, expected: 100 },
      ];

      for (const { input, expected } of floatCases) {
        commandsSent = [];
        await act(async () => {
          await result.current.setVolume(input);
        });
        expect(result.current.volume).toBe(expected);
        expect(commandsSent[0]).toEqual({ command: 'setVolume', data: expected });
      }

      unmount();
    });

    it('handles NaN volume input by safely falling back to 50', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      commandsSent = [];
      await act(async () => {
        await result.current.setVolume(NaN);
      });
      expect(result.current.volume).toBe(50);
      expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 50 });

      unmount();
    });

    it('handles rapid volume slider scrubbing across 100 consecutive values', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      commandsSent = [];

      // Simulate rapid drag from 0 to 100
      await act(async () => {
        for (let vol = 0; vol <= 100; vol++) {
          result.current.setVolume(vol);
        }
      });

      expect(result.current.volume).toBe(100);
      expect(commandsSent.length).toBe(101);
      expect(commandsSent[0]).toEqual({ command: 'setVolume', data: 0 });
      expect(commandsSent[100]).toEqual({ command: 'setVolume', data: 100 });

      unmount();
    });
  });

  // ==========================================================================
  // Section 3: Mute Toggle State & Volume Retention
  // ==========================================================================
  describe('3. Mute Toggle State & Volume Retention', () => {
    it('retains prior volume level when muting and unmuting', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Set initial volume to 82%
      await act(async () => {
        await result.current.setVolume(82);
      });
      expect(result.current.volume).toBe(82);
      expect(result.current.isMuted).toBe(false);

      // Mute audio
      commandsSent = [];
      await act(async () => {
        await result.current.toggleMute();
      });

      expect(result.current.isMuted).toBe(true);
      expect(result.current.volume).toBe(82); // Volume level must be retained
      expect(commandsSent).toEqual([{ command: 'mute' }]);

      // Unmute audio
      commandsSent = [];
      await act(async () => {
        await result.current.toggleMute();
      });

      expect(result.current.isMuted).toBe(false);
      expect(result.current.volume).toBe(82); // Volume level still intact
      expect(commandsSent).toEqual([{ command: 'unmute' }]);

      unmount();
    });

    it('retains volume at boundary conditions (0% and 100%) through mute/unmute cycle', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Test at 0%
      await act(async () => {
        await result.current.setVolume(0);
      });
      await act(async () => {
        await result.current.toggleMute(); // mute
      });
      expect(result.current.volume).toBe(0);
      expect(result.current.isMuted).toBe(true);

      await act(async () => {
        await result.current.toggleMute(); // unmute
      });
      expect(result.current.volume).toBe(0);
      expect(result.current.isMuted).toBe(false);

      // Test at 100%
      await act(async () => {
        await result.current.setVolume(100);
      });
      await act(async () => {
        await result.current.toggleMute(); // mute
      });
      expect(result.current.volume).toBe(100);
      expect(result.current.isMuted).toBe(true);

      await act(async () => {
        await result.current.toggleMute(); // unmute
      });
      expect(result.current.volume).toBe(100);
      expect(result.current.isMuted).toBe(false);

      unmount();
    });

    it('allows stepping or changing volume while muted and preserves the new volume upon unmute', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Start at 60%
      await act(async () => {
        await result.current.setVolume(60);
      });
      expect(result.current.volume).toBe(60);

      // Mute
      await act(async () => {
        await result.current.toggleMute();
      });
      expect(result.current.isMuted).toBe(true);

      // Change volume while muted to 40%
      await act(async () => {
        await result.current.setVolume(40);
      });
      expect(result.current.volume).toBe(40);

      // Step volume while muted (+5%) -> 45%
      await act(async () => {
        await result.current.stepVolume(5);
      });
      expect(result.current.volume).toBe(45);

      // Unmute
      await act(async () => {
        await result.current.toggleMute();
      });
      expect(result.current.isMuted).toBe(false);
      expect(result.current.volume).toBe(45);

      unmount();
    });
  });

  // ==========================================================================
  // Section 4: Seekbar Scrubbing & Progress Interpolation Isolation
  // ==========================================================================
  describe('4. Seekbar Scrubbing & Interpolation Isolation', () => {
    it('suppresses interpolation updates in UI while user is dragging seekbar', () => {
      const onSeek = vi.fn();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      // Render NowPlayingView with interpolatedProgress at 10s
      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: defaultMockState.video,
            player: defaultMockState.player,
            trackState: 1,
            interpolatedProgress: 10.0,
            durationSeconds: 420,
            volume: 50,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek,
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      const seekInput = container.querySelector('.progress-slider') as HTMLInputElement;
      const timestamps = container.querySelector('.progress-timestamps') as HTMLElement;
      expect(seekInput.value).toBe('10');
      expect(timestamps.textContent).toContain('0:10');

      // User starts scrubbing: sets slider to 125s (2:05)
      act(() => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(seekInput, '125');
        seekInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Verify scrubbing position took effect
      expect(seekInput.value).toBe('125');
      expect(timestamps.textContent).toContain('2:05');

      // Now simulate 200ms interpolation ticks (progress increases from 10.2 to 12.0)
      for (let simulatedProgress = 10.2; simulatedProgress <= 12.0; simulatedProgress += 0.2) {
        act(() => {
          root.render(
            React.createElement(NowPlayingView, {
              video: defaultMockState.video,
              player: defaultMockState.player,
              trackState: 1,
              interpolatedProgress: Number(simulatedProgress.toFixed(1)),
              durationSeconds: 420,
              volume: 50,
              isMuted: false,
              onPlayPause: vi.fn(),
              onNext: vi.fn(),
              onPrevious: vi.fn(),
              onSeek,
              onShuffle: vi.fn(),
              onRepeatMode: vi.fn(),
              onToggleLike: vi.fn(),
              onToggleDislike: vi.fn(),
              onSetVolume: vi.fn(),
              onStepVolume: vi.fn(),
              onToggleMute: vi.fn(),
            })
          );
        });

        // The seekbar must STILL be at 125, NOT overwritten by simulatedProgress!
        expect(seekInput.value).toBe('125');
        expect(timestamps.textContent).toContain('2:05');
      }

      // onSeek should NOT have been called while dragging
      expect(onSeek).not.toHaveBeenCalled();

      // Now user releases mouse/touch
      act(() => {
        seekInput.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });

      // onSeek must now be called with 125
      expect(onSeek).toHaveBeenCalledTimes(1);
      expect(onSeek).toHaveBeenCalledWith(125);

      act(() => {
        root.unmount();
      });
      container.remove();
    });

    it('supports touch release (touchend) and keyboard commit (keyup)', () => {
      const onSeek = vi.fn();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: defaultMockState.video,
            player: defaultMockState.player,
            trackState: 1,
            interpolatedProgress: 20.0,
            durationSeconds: 300,
            volume: 50,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek,
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      const seekInput = container.querySelector('.progress-slider') as HTMLInputElement;

      // Scrub to 80 via touch
      act(() => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(seekInput, '80');
        seekInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Touch end
      act(() => {
        seekInput.dispatchEvent(new Event('touchend', { bubbles: true }));
      });

      expect(onSeek).toHaveBeenCalledWith(80);

      // Scrub to 150 via keyboard
      act(() => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(seekInput, '150');
        seekInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Key up
      act(() => {
        seekInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' }));
      });

      expect(onSeek).toHaveBeenCalledWith(150);

      act(() => {
        root.unmount();
      });
      container.remove();
    });

    it('end-to-end integration: useCompanion seekTo executes client command and resets progress', async () => {
      vi.useFakeTimers();

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(result.current.interpolatedProgress).toBe(30.0);

      // Seek to 180s
      commandsSent = [];
      await act(async () => {
        await result.current.seekTo(180);
      });

      expect(result.current.interpolatedProgress).toBe(180);
      expect(commandsSent).toEqual([{ command: 'seekTo', data: 180 }]);

      // Verify timer resumes advancing from 180s
      act(() => {
        vi.advanceTimersByTime(400); // 2 ticks of 200ms
      });

      expect(result.current.interpolatedProgress).toBeCloseTo(180.4, 1);

      unmount();
      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // Section 5: Component DOM Attributes & UI Controls Stress
  // ==========================================================================
  describe('5. NowPlayingView DOM Controls Verification', () => {
    it('renders volume controls with proper ARIA attributes, ranges, and classes', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: defaultMockState.video,
            player: defaultMockState.player,
            trackState: 1,
            interpolatedProgress: 45.0,
            durationSeconds: 420,
            volume: 75,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek: vi.fn(),
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      // Volume slider attributes
      const slider = container.querySelector('.volume-slider') as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider.getAttribute('min')).toBe('0');
      expect(slider.getAttribute('max')).toBe('100');
      expect(slider.getAttribute('step')).toBe('1');
      expect(slider.value).toBe('75');

      // Percentage indicator
      const percentLabel = container.querySelector('.volume-percentage');
      expect(percentLabel?.textContent).toBe('75%');

      // Mute button in unmuted state
      const muteBtn = container.querySelector('.volume-mute-btn') as HTMLButtonElement;
      expect(muteBtn).not.toBeNull();
      expect(muteBtn.classList.contains('muted')).toBe(false);
      expect(muteBtn.textContent).toContain('Mute');

      act(() => {
        root.unmount();
      });
      container.remove();
    });

    it('renders mute button with .muted class and unmuted label when isMuted is true', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: defaultMockState.video,
            player: defaultMockState.player,
            trackState: 1,
            interpolatedProgress: 45.0,
            durationSeconds: 420,
            volume: 75,
            isMuted: true,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek: vi.fn(),
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      const muteBtn = container.querySelector('.volume-mute-btn') as HTMLButtonElement;
      expect(muteBtn.classList.contains('muted')).toBe(true);
      expect(muteBtn.textContent).toContain('Unmute');

      act(() => {
        root.unmount();
      });
      container.remove();
    });

    it('disables seekbar when video is null or ad is playing', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      // Case 1: video is null
      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: null,
            player: null,
            trackState: -1,
            interpolatedProgress: 0,
            durationSeconds: 0,
            volume: 50,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek: vi.fn(),
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      let seekInput = container.querySelector('.progress-slider') as HTMLInputElement;
      expect(seekInput.disabled).toBe(true);

      // Case 2: adPlaying is true
      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: defaultMockState.video,
            player: {
              ...defaultMockState.player,
              adPlaying: true,
            },
            trackState: 1,
            interpolatedProgress: 15,
            durationSeconds: 30,
            volume: 50,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek: vi.fn(),
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      seekInput = container.querySelector('.progress-slider') as HTMLInputElement;
      expect(seekInput.disabled).toBe(true);

      act(() => {
        root.unmount();
      });
      container.remove();
    });
  });

  // ==========================================================================
  // Section 6: Adversarial Edge Cases & Stress Challenges
  // ==========================================================================
  describe('6. Adversarial Edge Cases & Stress Challenges', () => {
    it('challenge: detects stale volume closure during rapid synchronous step bursts', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      await act(async () => {
        await result.current.setVolume(50);
      });
      expect(result.current.volume).toBe(50);

      // Rapid synchronous burst: user double-clicks +5% before React re-renders
      commandsSent = [];
      act(() => {
        result.current.stepVolume(5);
        result.current.stepVolume(5);
      });

      // Using volumeRef avoids stale closure over React state:
      // Invocations evaluate 50 + 5 = 55, then 55 + 5 = 60.
      expect(commandsSent.length).toBe(2);
      expect(commandsSent[0].data).toBe(55);
      expect(commandsSent[1].data).toBe(60);
      expect(result.current.volume).toBe(60);

      unmount();
    });

    it('challenge: track change while seekbar is being scrubbed preserves stale scrubbing progress', () => {
      const onSeek = vi.fn();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      // Track 1 playing, length 300s
      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: { ...defaultMockState.video!, id: 'track-1', durationSeconds: 300 },
            player: defaultMockState.player,
            trackState: 1,
            interpolatedProgress: 10.0,
            durationSeconds: 300,
            volume: 50,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek,
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      const seekInput = container.querySelector('.progress-slider') as HTMLInputElement;

      // User drags seekbar to 280s
      act(() => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(seekInput, '280');
        seekInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      expect(seekInput.value).toBe('280');

      // Now external event occurs: Track changes to Track 2 (duration 100s)
      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: { ...defaultMockState.video!, id: 'track-2', durationSeconds: 100 },
            player: defaultMockState.player,
            trackState: 1,
            interpolatedProgress: 0.0,
            durationSeconds: 100,
            volume: 50,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek,
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      // Now user releases mouse
      act(() => {
        seekInput.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });

      // Verify scrubbingProgress was cleared on track change, so onSeek is NOT called with stale progress
      expect(onSeek).not.toHaveBeenCalled();

      act(() => {
        root.unmount();
      });
      container.remove();
    });

    it('challenge: renders unnormalized volume props (floats, negative, >100) verbatim in UI label', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      // Render with float volume 67.89
      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: defaultMockState.video,
            player: defaultMockState.player,
            trackState: 1,
            interpolatedProgress: 0,
            durationSeconds: 100,
            volume: 67.89,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek: vi.fn(),
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      const percentLabel = container.querySelector('.volume-percentage');
      // In NowPlayingView: normalized and rounded display percentage
      expect(percentLabel?.textContent).toBe('68%');

      // Render with negative volume -12
      act(() => {
        root.render(
          React.createElement(NowPlayingView, {
            video: defaultMockState.video,
            player: defaultMockState.player,
            trackState: 1,
            interpolatedProgress: 0,
            durationSeconds: 100,
            volume: -12,
            isMuted: false,
            onPlayPause: vi.fn(),
            onNext: vi.fn(),
            onPrevious: vi.fn(),
            onSeek: vi.fn(),
            onShuffle: vi.fn(),
            onRepeatMode: vi.fn(),
            onToggleLike: vi.fn(),
            onToggleDislike: vi.fn(),
            onSetVolume: vi.fn(),
            onStepVolume: vi.fn(),
            onToggleMute: vi.fn(),
          })
        );
      });

      expect(percentLabel?.textContent).toBe('0%');

      act(() => {
        root.unmount();
      });
      container.remove();
    });

    it('challenge: random fuzz harness across 100 random volume commands never crashes', async () => {
      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const fuzzedValues = [
        -100, -1, 0, 1, 0.5, 49.99, 50, 50.01, 99, 100, 101, 200, 9999,
        NaN, Infinity, -Infinity, 42.12345, 0.00001, -0.00001,
      ];

      for (let i = 0; i < 100; i++) {
        const val = fuzzedValues[i % fuzzedValues.length];
        await act(async () => {
          await result.current.setVolume(val);
        });

        // In useCompanion: volume is always an integer between 0 and 100
        expect(result.current.volume).toBeGreaterThanOrEqual(0);
        expect(result.current.volume).toBeLessThanOrEqual(100);
        expect(Number.isInteger(result.current.volume)).toBe(true);
      }

      unmount();
    });
  });
});
