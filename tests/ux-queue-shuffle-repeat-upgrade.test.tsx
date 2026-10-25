/**
 * Unit & Integration Test Suite for Iteration 2 Upgrades:
 * - R1: Click/Hold Track Action Sheet & Play Next / Play Last across Search, Queue, and Playlists
 * - R2: Unified Smart Queue (Play Next, Play Last, Reorder, Remove) & Auto-Scroll to Playing Song
 * - R3: Playlists 429 Rate-Limit Caching, YouTube Music Playlist Search, and Save Current Queue as Playlist
 * - R4: Shuffle & Repeat Active Visual States & Mode Cycling Fix
 * - R5: Sunburst Studio Assets & Persistent Floating Mini-Player Bar
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCompanion } from '../src/hooks/useCompanion';
import App from '../src/App';
import { NowPlayingView } from '../src/components/NowPlayingView';
import { QueueView } from '../src/components/QueueView';
import { SearchView } from '../src/components/SearchView';
import { PlaylistsView } from '../src/components/PlaylistsView';
import { CompanionClient } from '../src/lib/companion-client';
import { saveConnectionProfile, clearConnectionProfile } from '../src/lib/storage';
import type { CompanionState, QueueState, SearchTrack } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

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
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('Iteration 2 Upgrade Suite (R1 - R5)', () => {
  let originalFetch: typeof fetch;

  const baseCompanionState: CompanionState = {
    player: {
      trackState: 1,
      videoProgress: 20,
      volume: 65,
      muted: false,
      adPlaying: false,
      queue: {
        items: [
          { title: 'Song One', author: 'Artist 1', duration: '3:10', selected: true, videoId: 'vid_1' },
          { title: 'Song Two', author: 'Artist 2', duration: '3:40', selected: false, videoId: 'vid_2' },
        ],
        automixItems: [],
        selectedItemIndex: 0,
        repeatMode: 1, // Repeat ALL in queue.repeatMode (YTMDesktop v2 structure)
      },
    },
    video: {
      id: 'vid_1',
      title: 'Song One',
      author: 'Artist 1',
      album: 'Album 1',
      durationSeconds: 190,
      thumbnails: [{ url: 'https://example.com/art1.jpg', width: 300, height: 300 }],
    },
    playlistId: null,
  };

  beforeEach(() => {
    localStorage.clear();
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearConnectionProfile();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // R1 & R2: Smart Unified Queue (Play Next, Play Last, Reorder, Remove)
  // ==========================================================================
  describe('Smart Unified Queue in useCompanion (R1 & R2)', () => {
    it('inserts Play Next right after currently playing track and appends Play Last to end', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'valid-token',
      });

      const sentCommands: any[] = [];
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(baseCompanionState), { status: 200 }));
        }
        if (url.includes('/api/v1/command')) {
          sentCommands.push(JSON.parse(init?.body as string));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });

      expect(result.current.state?.player.queue?.items).toHaveLength(2);

      // 1. Add a track via Play Next -> should be inserted at index 1 (right after vid_1)
      const nextTrack: SearchTrack = {
        videoId: 'vid_next_99',
        title: 'Inserted Next Song',
        artist: 'Next Artist',
        duration: '2:55',
      };
      await act(async () => {
        await result.current.playNext(nextTrack);
      });

      const queueAfterNext = result.current.state?.player.queue?.items ?? [];
      expect(queueAfterNext.map((i) => i.videoId)).toEqual(['vid_1', 'vid_next_99', 'vid_2']);
      expect(queueAfterNext[1].source).toBe('play-next');

      // 2. Add a track via Play Last -> should be appended at the end (index 3)
      const lastTrack: SearchTrack = {
        videoId: 'vid_last_88',
        title: 'Appended Last Song',
        artist: 'Last Artist',
        duration: '4:05',
      };
      await act(async () => {
        await result.current.playLast(lastTrack);
      });

      const queueAfterLast = result.current.state?.player.queue?.items ?? [];
      expect(queueAfterLast.map((i) => i.videoId)).toEqual([
        'vid_1',
        'vid_next_99',
        'vid_2',
        'vid_last_88',
      ]);
      expect(queueAfterLast[3].source).toBe('play-last');

      // 3. Reorder queue: move index 2 ('vid_2') to index 1
      act(() => {
        result.current.reorderQueue(2, 1);
      });
      expect(result.current.state?.player.queue?.items.map((i) => i.videoId)).toEqual([
        'vid_1',
        'vid_2',
        'vid_next_99',
        'vid_last_88',
      ]);

      // 4. Remove index 1 ('vid_2') from queue
      act(() => {
        result.current.removeFromQueue(1);
      });
      expect(result.current.state?.player.queue?.items.map((i) => i.videoId)).toEqual([
        'vid_1',
        'vid_next_99',
        'vid_last_88',
      ]);

      // 5. Pressing next() should advance to 'vid_next_99' and play it via changeVideo
      await act(async () => {
        await result.current.next();
      });
      expect(sentCommands).toContainEqual({
        command: 'changeVideo',
        data: { videoId: 'vid_next_99' },
      });
      expect(result.current.state?.player.queue?.selectedItemIndex).toBe(1);

      unmount();
    });
  });

  // ==========================================================================
  // R2: QueueView Auto-Scroll, Reorder Controls, and Action Sheet on Queue Items
  // ==========================================================================
  describe('QueueView Auto-Scroll, Reorder & Action Sheet (R1 & R2)', () => {
    it('automatically scrolls active playing item into view on mount and supports Play Next on queue items', () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;

      const onPlayNext = vi.fn();
      const onPlayLast = vi.fn();
      const onReorderQueue = vi.fn();
      const onRemoveFromQueue = vi.fn();

      const queue: QueueState = {
        items: [
          { title: 'First Song', author: 'A1', duration: '3:00', selected: false, videoId: 'v1' },
          { title: 'Playing Song', author: 'A2', duration: '3:30', selected: true, videoId: 'v2' },
          { title: 'Third Song', author: 'A3', duration: '4:00', selected: false, videoId: 'v3' },
        ],
        automixItems: [],
        selectedItemIndex: 1,
      };

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      act(() => {
        root.render(
          <QueueView
            queue={queue}
            onPlayIndex={vi.fn()}
            onPlayNext={onPlayNext}
            onPlayLast={onPlayLast}
            onReorderQueue={onReorderQueue}
            onRemoveFromQueue={onRemoveFromQueue}
          />
        );
      });

      // Verify auto-scroll was triggered on mount
      expect(scrollSpy).toHaveBeenCalled();

      // Verify reorder Move Up button on item 2
      const moveUpBtn = container.querySelector('[data-testid="queue-move-up-2"]') as HTMLButtonElement;
      expect(moveUpBtn).not.toBeNull();
      act(() => {
        moveUpBtn.click();
      });
      expect(onReorderQueue).toHaveBeenCalledWith(2, 1);

      // Verify clicking '•••' on an existing queue item opens TrackActionSheet so user can queue it again
      const moreBtn0 = container.querySelector('[data-testid="queue-more-0"]') as HTMLButtonElement;
      expect(moreBtn0).not.toBeNull();
      act(() => {
        moreBtn0.click();
      });

      const playNextSheetBtn = container.querySelector('[data-testid="action-play-next"]') as HTMLButtonElement;
      expect(playNextSheetBtn).not.toBeNull();
      act(() => {
        playNextSheetBtn.click();
      });

      expect(onPlayNext).toHaveBeenCalledWith(
        expect.objectContaining({
          videoId: 'v1',
          title: 'First Song',
        })
      );

      act(() => {
        root.unmount();
      });
      container.remove();
    });
  });

  // ==========================================================================
  // R4: Shuffle & Repeat Active Visual Effects & Cycling Fix
  // ==========================================================================
  describe('Shuffle & Repeat Mode Sync and Illuminated Active States (R4)', () => {
    it('cycles Repeat mode 0 -> 1 -> 2 -> 0 and toggles Shuffle active badge in NowPlayingView', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'valid-token',
      });

      const sentCommands: any[] = [];
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(baseCompanionState), { status: 200 }));
        }
        if (url.includes('/api/v1/command')) {
          sentCommands.push(JSON.parse(init?.body as string));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });

      // Initial state from baseCompanionState has queue.repeatMode = 1
      expect(result.current.repeatModeValue).toBe(1);
      expect(result.current.isShuffleActive).toBe(false);

      // Cycle repeatMode(): 1 -> 2
      await act(async () => {
        await result.current.repeatMode();
      });
      expect(result.current.repeatModeValue).toBe(2);
      expect(sentCommands).toContainEqual({ command: 'repeatMode', data: 2 });

      // Cycle repeatMode() again: 2 -> 0
      await act(async () => {
        await result.current.repeatMode();
      });
      expect(result.current.repeatModeValue).toBe(0);
      expect(sentCommands).toContainEqual({ command: 'repeatMode', data: 0 });

      // Toggle shuffle() -> active = true
      await act(async () => {
        await result.current.shuffle();
      });
      expect(result.current.isShuffleActive).toBe(true);

      // Render NowPlayingView with active shuffle and repeatMode = 2
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      act(() => {
        root.render(
          <NowPlayingView
            video={baseCompanionState.video}
            player={baseCompanionState.player}
            trackState={1}
            interpolatedProgress={20}
            durationSeconds={190}
            volume={65}
            isMuted={false}
            isShuffleActive={true}
            repeatModeValue={2}
            onPlayPause={vi.fn()}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
            onSeek={vi.fn()}
            onShuffle={vi.fn()}
            onRepeatMode={vi.fn()}
            onToggleLike={vi.fn()}
            onToggleDislike={vi.fn()}
            onSetVolume={vi.fn()}
            onStepVolume={vi.fn()}
            onToggleMute={vi.fn()}
          />
        );
      });

      const shuffleBtn = container.querySelector('[data-testid="shuffle-btn"]') as HTMLButtonElement;
      const repeatBtn = container.querySelector('[data-testid="repeat-btn"]') as HTMLButtonElement;

      expect(shuffleBtn.classList.contains('active')).toBe(true);
      expect(shuffleBtn.getAttribute('aria-pressed')).toBe('true');
      expect(container.querySelector('[data-testid="shuffle-active-badge"]')?.textContent).toBe('ON');

      expect(repeatBtn.classList.contains('active')).toBe(true);
      expect(repeatBtn.getAttribute('aria-pressed')).toBe('true');
      expect(container.querySelector('[data-testid="repeat-active-badge"]')?.textContent).toBe('1');

      act(() => {
        root.unmount();
      });
      container.remove();
      unmount();
    });
  });

  // ==========================================================================
  // R3: Playlists Rate-Limit Protection & Save Current Queue as Playlist
  // ==========================================================================
  describe('PlaylistsView Rate-Limit Resilience & Save Queue as Playlist (R3)', () => {
    it('preserves cached playlists when YTMDesktop returns 429 Rate limit exceeded and saves current queue', async () => {
      const mockClient = new CompanionClient({ token: 'mock-token' });
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue([]);
      // Pre-populate localStorage cache
      localStorage.setItem(
        'tubify_native_playlists_cache_v1',
        JSON.stringify({
          items: [{ id: 'PL_cached_1', title: 'Cached Favorites Mix' }],
          fetchedAt: Date.now() - 120_000,
        })
      );

      // Simulate YTMDesktop throwing 429 Rate limit exceeded
      vi.spyOn(mockClient, 'getPlaylists').mockRejectedValue(new Error('Rate limit exceeded (HTTP 429)'));
      const createWithTracksSpy = vi
        .spyOn(mockClient, 'createEditablePlaylistWithTracks')
        .mockResolvedValue({
          id: 'pl-saved-queue',
          title: 'Queue Mix (2 songs)',
          name: 'Queue Mix (2 songs)',
          updatedAt: new Date().toISOString(),
          tracks: [
            { videoId: 'v1', title: 'Song 1', artist: 'Artist 1' },
            { videoId: 'v2', title: 'Song 2', artist: 'Artist 2' },
          ],
        });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <PlaylistsView
            client={mockClient}
            onPlayTrack={vi.fn()}
            onPlayCustomPlaylist={vi.fn()}
            onPlayDesktopPlaylist={vi.fn()}
            activeQueueTracks={[
              { videoId: 'v1', title: 'Song 1', artist: 'Artist 1' },
              { videoId: 'v2', title: 'Song 2', artist: 'Artist 2' },
            ]}
          />
        );
      });

      // Cached playlist should still be displayed despite 429 error!
      expect(container.textContent).toContain('Cached Favorites Mix');
      expect(container.textContent).toContain('Showing cached library');

      // Click "Save Queue (2)" button
      const saveQueueBtn = container.querySelector('[data-testid="save-current-queue-btn"]') as HTMLButtonElement;
      expect(saveQueueBtn).not.toBeNull();
      await act(async () => {
        saveQueueBtn.click();
      });

      expect(createWithTracksSpy).toHaveBeenCalledWith('Queue Mix (2 songs)', [
        { videoId: 'v1', title: 'Song 1', artist: 'Artist 1' },
        { videoId: 'v2', title: 'Song 2', artist: 'Artist 2' },
      ]);
      expect(container.textContent).toContain('Queue Mix (2 songs)');

      act(() => {
        root.unmount();
      });
      container.remove();
    });
  });

  // ==========================================================================
  // R1: SearchView Play Next & Play Last Actions
  // ==========================================================================
  describe('SearchView Play Next & Play Last Actions (R1)', () => {
    it('triggers onPlayNext and onPlayLast from search result rows', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const mockClient = new CompanionClient();
      const sampleTrack: SearchTrack = {
        videoId: 'search_vid_1',
        title: 'Sunburst Groove',
        artist: 'Analog Ensemble',
        duration: '3:45',
      };
      vi.spyOn(mockClient, 'searchSongs').mockResolvedValue({ results: [sampleTrack] });

      const onPlayNext = vi.fn();
      const onPlayLast = vi.fn();

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      act(() => {
        root.render(
          <SearchView
            client={mockClient}
            onPlayTrack={vi.fn()}
            onAddToPlaylist={vi.fn()}
            onPlayNext={onPlayNext}
            onPlayLast={onPlayLast}
          />
        );
      });

      const input = container.querySelector('input.search-input') as HTMLInputElement;
      act(() => {
        input.value = 'Sunburst';
        const tracker = (input as any)._valueTracker;
        if (tracker) tracker.setValue('');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await act(async () => {
        vi.advanceTimersByTime(400);
        await Promise.resolve();
      });

      const playNextBtn = container.querySelector('[data-testid="search-play-next-search_vid_1"]') as HTMLButtonElement;
      const playLastBtn = container.querySelector('[data-testid="search-play-last-search_vid_1"]') as HTMLButtonElement;
      expect(playNextBtn).not.toBeNull();
      expect(playLastBtn).not.toBeNull();

      act(() => {
        playNextBtn.click();
      });
      expect(onPlayNext).toHaveBeenCalledWith(sampleTrack);

      act(() => {
        playLastBtn.click();
      });
      expect(onPlayLast).toHaveBeenCalledWith(sampleTrack);

      act(() => {
        root.unmount();
      });
      container.remove();
      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // Iteration 3: Playlist & Queue Continuity for Play Next / Play Last
  // ==========================================================================
  describe('Playlist & Queue Continuity across Play Next / Play Last Transitions', () => {
    it('keeps native playlist intact on Play Last, plays inserted Play Next track, and restores originPlaylistId on return', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'valid-token',
      });

      const playlistState: CompanionState = {
        ...baseCompanionState,
        playlistId: 'PL_fav_mix_2026',
        player: {
          ...baseCompanionState.player,
          queue: {
            items: [
              { title: 'Song One', author: 'Artist 1', duration: '3:10', selected: true, videoId: 'vid_1' },
              null as any, // YTMDesktop continuationItemRenderer null slot
              { title: 'Song Two', author: 'Artist 2', duration: '3:40', selected: false, videoId: 'vid_2' },
            ],
            automixItems: [],
            selectedItemIndex: 0,
            repeatMode: 0,
          },
        },
      };

      const sentCommands: any[] = [];
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(playlistState), { status: 200 }));
        }
        if (url.includes('/api/v1/command')) {
          sentCommands.push(JSON.parse(init?.body as string));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });

      // Insert a Play Next song while playlist PL_fav_mix_2026 is playing
      await act(async () => {
        await result.current.playNext({
          videoId: 'vid_inserted_next',
          title: 'Inserted Next Track',
          artist: 'Guest Artist',
        });
      });

      // Adding Play Next must NOT dispatch changeVideo or interrupt Song One
      expect(sentCommands).toHaveLength(0);
      expect(result.current.state?.player.queue?.items.map((i) => i.videoId)).toEqual([
        'vid_1',
        'vid_inserted_next',
        'vid_2',
      ]);

      // Advance to the Play Next track (index 1)
      await act(async () => {
        await result.current.next();
      });
      expect(sentCommands).toContainEqual({
        command: 'changeVideo',
        data: { videoId: 'vid_inserted_next' },
      });

      // Advance from the inserted Play Next track back to Song Two (index 2) -> must pass playlistId to restore playlist!
      sentCommands.length = 0;
      await act(async () => {
        await result.current.next();
      });
      expect(sentCommands).toContainEqual({
        command: 'changeVideo',
        data: { videoId: 'vid_2', playlistId: 'PL_fav_mix_2026' },
      });
      expect(result.current.state?.player.queue?.selectedItemIndex).toBe(2);

      unmount();
    });

    it('populates Queue when playing a Tubify custom playlist and inserts Play Next without breaking it', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'valid-token',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(baseCompanionState), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 40));
      });

      await act(async () => {
        await result.current.playCustomPlaylist(
          [
            { videoId: 'cust_1', title: 'Custom 1', artist: 'A1' },
            { videoId: 'cust_2', title: 'Custom 2', artist: 'A2' },
          ],
          0
        );
      });

      expect(result.current.state?.player.queue?.items.map((i) => i.videoId)).toEqual(['cust_1', 'cust_2']);

      await act(async () => {
        await result.current.playNext({ videoId: 'cust_next', title: 'Inserted in Custom', artist: 'AX' });
      });

      expect(result.current.state?.player.queue?.items.map((i) => i.videoId)).toEqual([
        'cust_1',
        'cust_next',
        'cust_2',
      ]);

      unmount();
    });
  });

  // ==========================================================================
  // Iteration 3: Back Button / Gesture History & Two-Step App Exit
  // ==========================================================================
  describe('Back Button / Gesture Navigation & Two-Step Exit', () => {
    it('returns to the previous tab vision on Back and requires two Back actions at root to exit', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'valid-token',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(new Response(JSON.stringify(baseCompanionState), { status: 200 }));
        }
        return Promise.resolve(new Response('[]', { status: 200 }));
      });

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<App />);
        await new Promise((r) => setTimeout(r, 50));
      });

      const win = window as unknown as { __handleTubifyBack: () => 'handled' | 'exit' };
      expect(typeof win.__handleTubifyBack).toBe('function');

      // Navigate: Now Playing -> Queue -> Search
      const queueNavBtn = container.querySelector('button[aria-label="Queue"]') as HTMLButtonElement;
      const searchNavBtn = container.querySelector('button[aria-label="Search"]') as HTMLButtonElement;
      const nowPlayingNavBtn = container.querySelector('button[aria-label="Now Playing"]') as HTMLButtonElement;

      act(() => {
        queueNavBtn.click();
      });
      expect(queueNavBtn.classList.contains('active')).toBe(true);

      act(() => {
        searchNavBtn.click();
      });
      expect(searchNavBtn.classList.contains('active')).toBe(true);

      // 1st Back action: Search -> returns to Queue ('handled')
      let outcome: 'handled' | 'exit' = 'exit';
      act(() => {
        outcome = win.__handleTubifyBack();
      });
      expect(outcome).toBe('handled');
      expect(queueNavBtn.classList.contains('active')).toBe(true);

      // 2nd Back action: Queue -> returns to Now Playing ('handled')
      act(() => {
        outcome = win.__handleTubifyBack();
      });
      expect(outcome).toBe('handled');
      expect(nowPlayingNavBtn.classList.contains('active')).toBe(true);

      // 3rd Back action (1st at root Now Playing): arms 2-step exit and shows toast ('handled')
      act(() => {
        outcome = win.__handleTubifyBack();
      });
      expect(outcome).toBe('handled');
      expect(container.textContent).toContain('Press back again to exit Tubify');

      // 4th Back action (2nd consecutive at root within 2.2s): exits app ('exit')
      act(() => {
        outcome = win.__handleTubifyBack();
      });
      expect(outcome).toBe('exit');

      act(() => {
        root.unmount();
      });
      container.remove();
    });
  });

  // ==========================================================================
  // Iteration 3: Shared Companion Session Vault Auto-Recovery
  // ==========================================================================
  describe('Shared Companion Authorization Vault (/api/companion/session)', () => {
    it('automatically recovers shared token from server vault when local token is missing or 401', async () => {
      // Start with an outdated token that returns 401, while shared session has the newer valid token
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'old-overwritten-token',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          const authHeader = (init?.headers as Record<string, string>)?.Authorization;
          if (authHeader === 'shared-permanent-token') {
            return Promise.resolve(new Response(JSON.stringify(baseCompanionState), { status: 200 }));
          }
          return Promise.resolve(new Response('Unauthorized', { status: 401 }));
        }
        if (url.includes('/api/companion/session')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                host: '192.168.0.144',
                port: 9863,
                token: 'shared-permanent-token',
              }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      const { result, unmount } = renderHook(() => useCompanion({ autoConnect: true }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });

      expect(result.current.status).toBe('connected');
      expect(result.current.profile.token).toBe('shared-permanent-token');

      unmount();
    });
  });
});
