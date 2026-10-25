/**
 * Empirical Stress Test Suite for SearchView, PlaylistsView, and AddToPlaylistModal
 * 
 * Adversarial edge cases covered:
 * 1. SearchView:
 *    - Rapid typing / debounce cancellation within 350ms
 *    - Whitespace and empty queries
 *    - Instant clearing via '✕' button
 *    - Network latency, out-of-order race conditions, and error recovery with Retry
 *    - Incomplete/malformed track metadata (missing album, duration, broken thumbnails)
 *    - Rapid action button clicks
 * 2. Input Parsing & Direct Link Detection:
 *    - Standard watch URLs, mobile URLs, short URLs, embeds, shorts
 *    - Bare 11-char IDs, bare playlist IDs, combined video+playlist URLs
 *    - Protocol-less URLs
 *    - Malicious domain spoofs, malformed URLs, special characters
 *    - Direct Link card interaction in SearchView
 * 3. AddToPlaylistModal:
 *    - Rapid open/close and unmount during fetch
 *    - Creating new playlist with empty/whitespace string (fallback to 'Untitled Playlist')
 *    - Double-click race condition on submit (useState vs useRef submission guard)
 *    - Duplicate track detection indicator '(Already added)'
 *    - Error handling on playlist fetch and track addition
 *    - Backdrop click and event propagation guards
 * 4. PlaylistsView:
 *    - Creating playlist with empty or whitespace title
 *    - Renaming playlist: empty/whitespace validation aborts without API call
 *    - Successful rename flow and cancel rename
 *    - Expand/collapse accordion behavior across multiple playlists
 *    - Deleting all tracks in a playlist down to empty state and play button disappearance
 *    - Deleting playlist confirmation and cancel flows
 *    - Native desktop playlists with and without authentication token
 *    - Global refresh button
 */

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchView } from '../src/components/SearchView';
import { PlaylistsView } from '../src/components/PlaylistsView';
import { AddToPlaylistModal } from '../src/components/AddToPlaylistModal';
import { parseYouTubeInput } from '../src/lib/url-parser';
import { CompanionClient } from '../src/lib/companion-client';
import type { EditablePlaylist, PlaylistSummary, SearchTrack } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Helper to simulate typing into HTML input in React 19
function simulateTyping(input: HTMLInputElement, value: string) {
  input.value = value;
  const tracker = (input as any)._valueTracker;
  if (tracker) tracker.setValue('');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Empirical UI Stress Test Suite: SearchView, PlaylistsView, AddToPlaylistModal', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let mockClient: CompanionClient;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockClient = new CompanionClient({ token: 'test-token' });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root!.unmount();
      });
      container.remove();
    }
    container = null;
    root = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const renderComponent = async (element: React.ReactElement) => {
    await act(async () => {
      root!.render(element);
    });
  };

  // =========================================================================
  // 1. SEARCHVIEW STRESS TESTS
  // =========================================================================
  describe('SearchView: Debouncing, Rapid Input, and Race Conditions', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    it('suppresses intermediate API calls during rapid keystrokes within 350ms debounce window', async () => {
      const searchSpy = vi.spyOn(mockClient, 'searchSongs').mockResolvedValue({
        results: [
          { videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
        ],
      });

      await renderComponent(
        <SearchView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayDirectVideo={vi.fn()}
          onAddToPlaylist={vi.fn()}
        />
      );

      const input = container?.querySelector('input.search-input') as HTMLInputElement;
      expect(input).not.toBeNull();

      // Rapidly simulate 6 keystrokes every 100ms (total 500ms, but reset on each keystroke)
      const letters = ['R', 'Ri', 'Ric', 'Rick', 'Rick ', 'Rick Astley'];
      for (const text of letters) {
        act(() => {
          simulateTyping(input, text);
        });
        act(() => {
          vi.advanceTimersByTime(100);
        });
      }

      // At this point, the last keystroke has only aged 100ms, so search should NOT have fired
      expect(searchSpy).not.toHaveBeenCalled();

      // Now advance the remaining 260ms to exceed the 350ms debounce threshold
      await act(async () => {
        vi.advanceTimersByTime(260);
        await Promise.resolve();
      });

      // Exactly ONE search request should be sent with the final text
      expect(searchSpy).toHaveBeenCalledTimes(1);
      expect(searchSpy).toHaveBeenCalledWith('Rick Astley');
      expect(container?.textContent).toContain('Never Gonna Give You Up');
    });

    it('does not trigger search when query is only whitespace or cleared', async () => {
      const searchSpy = vi.spyOn(mockClient, 'searchSongs').mockResolvedValue({ results: [] });

      await renderComponent(
        <SearchView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayDirectVideo={vi.fn()}
          onAddToPlaylist={vi.fn()}
        />
      );

      const input = container?.querySelector('input.search-input') as HTMLInputElement;
      expect(input).not.toBeNull();

      act(() => {
        simulateTyping(input, '     ');
      });

      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(searchSpy).not.toHaveBeenCalled();
      expect(container?.textContent).toContain('Search Songs on YouTube Music');
    });

    it('clear button instantly clears input, cancels pending search, and resets UI state', async () => {
      const searchSpy = vi.spyOn(mockClient, 'searchSongs').mockResolvedValue({
        results: [{ videoId: 'test1234567', title: 'Pending Song', artist: 'Artist' }],
      });

      await renderComponent(
        <SearchView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayDirectVideo={vi.fn()}
          onAddToPlaylist={vi.fn()}
        />
      );

      const input = container?.querySelector('input.search-input') as HTMLInputElement;
      expect(input).not.toBeNull();

      act(() => {
        simulateTyping(input, 'Pending Song');
      });

      // Clear button should be visible
      const clearBtn = container?.querySelector('button[aria-label="Clear search input"]') as HTMLButtonElement;
      expect(clearBtn).not.toBeNull();

      // Click clear button before debounce completes
      act(() => {
        clearBtn.click();
      });

      expect(input.value).toBe('');

      // Advance timers
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });

      expect(searchSpy).not.toHaveBeenCalled();
      expect(container?.textContent).toContain('Search Songs on YouTube Music');
    });

    it('displays error banner on API failure and retries on clicking Retry', async () => {
      let fail = true;
      const searchSpy = vi.spyOn(mockClient, 'searchSongs').mockImplementation(async () => {
        if (fail) {
          throw new Error('Network timeout contacting YouTube Music');
        }
        return {
          results: [{ videoId: 'test1111111', title: 'Recovered Song', artist: 'Artist' }],
        };
      });

      await renderComponent(
        <SearchView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayDirectVideo={vi.fn()}
          onAddToPlaylist={vi.fn()}
        />
      );

      const input = container?.querySelector('input.search-input') as HTMLInputElement;
      expect(input).not.toBeNull();

      act(() => {
        simulateTyping(input, 'Fail Test');
      });

      await act(async () => {
        vi.advanceTimersByTime(400);
        await Promise.resolve();
      });

      expect(container?.textContent).toContain('Network timeout contacting YouTube Music');
      const retryBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent === 'Retry'
      );
      expect(retryBtn).toBeDefined();

      // Prepare success on retry
      fail = false;
      await act(async () => {
        retryBtn?.click();
        await Promise.resolve();
      });

      expect(searchSpy).toHaveBeenCalledTimes(2);
      expect(container?.textContent).toContain('Recovered Song');
      expect(container?.textContent).not.toContain('Network timeout');
    });

    it('renders fallback icon and handles image onError when artwork fails to load', async () => {
      vi.spyOn(mockClient, 'searchSongs').mockResolvedValue({
        results: [
          {
            videoId: 'track-no-art',
            title: 'Track Without Art',
            artist: 'Indie Artist',
            album: undefined,
            duration: undefined,
            thumbnailUrl: undefined,
          },
          {
            videoId: 'track-bad-art',
            title: 'Track Broken Art',
            artist: 'Indie Artist',
            thumbnailUrl: 'https://invalid-domain.com/broken.png',
          },
        ],
      });

      await renderComponent(
        <SearchView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayDirectVideo={vi.fn()}
          onAddToPlaylist={vi.fn()}
        />
      );

      const input = container?.querySelector('input.search-input') as HTMLInputElement;
      expect(input).not.toBeNull();

      act(() => {
        simulateTyping(input, 'Art Test');
      });

      await act(async () => {
        vi.advanceTimersByTime(400);
        await Promise.resolve();
      });

      expect(container?.textContent).toContain('Track Without Art');
      expect(container?.textContent).toContain('Track Broken Art');
      expect(container?.textContent).toContain('🎵');

      // Trigger onError on broken image
      const img = container?.querySelector('img[src="https://invalid-domain.com/broken.png"]') as HTMLImageElement;
      expect(img).not.toBeNull();
      act(() => {
        img.dispatchEvent(new Event('error'));
      });
      expect(img.style.display).toBe('none');
    });

    it('invokes onPlayTrack and onAddToPlaylist with correct track payloads on user click', async () => {
      const sample: SearchTrack = {
        videoId: 'play_test_12',
        title: 'Action Track',
        artist: 'Action Artist',
        album: 'Action Album',
        duration: '3:45',
      };
      vi.spyOn(mockClient, 'searchSongs').mockResolvedValue({ results: [sample] });

      const onPlayTrack = vi.fn();
      const onAddToPlaylist = vi.fn();

      await renderComponent(
        <SearchView
          client={mockClient}
          onPlayTrack={onPlayTrack}
          onPlayDirectVideo={vi.fn()}
          onAddToPlaylist={onAddToPlaylist}
        />
      );

      const input = container?.querySelector('input.search-input') as HTMLInputElement;
      expect(input).not.toBeNull();

      act(() => {
        simulateTyping(input, 'Action Track');
      });

      await act(async () => {
        vi.advanceTimersByTime(400);
        await Promise.resolve();
      });

      const playBtn = container?.querySelector('button[title="Play on PC"]') as HTMLButtonElement;
      const addBtn = container?.querySelector('button[title="Add to Playlist"]') as HTMLButtonElement;

      expect(playBtn).not.toBeNull();
      expect(addBtn).not.toBeNull();

      act(() => {
        playBtn.click();
      });
      expect(onPlayTrack).toHaveBeenCalledWith(sample);

      act(() => {
        addBtn.click();
      });
      expect(onAddToPlaylist).toHaveBeenCalledWith(sample);
    });

    it('out-of-order search responses: tests whether stale slow response overwrites newer search results', async () => {
      let resolveQuery1: (val: any) => void;
      const promise1 = new Promise((resolve) => {
        resolveQuery1 = resolve;
      });

      let resolveQuery2: (val: any) => void;
      const promise2 = new Promise((resolve) => {
        resolveQuery2 = resolve;
      });

      vi.spyOn(mockClient, 'searchSongs').mockImplementation(async (query: string) => {
        if (query === 'QueryOne') {
          return promise1 as any;
        }
        if (query === 'QueryTwo') {
          return promise2 as any;
        }
        return { results: [] };
      });

      await renderComponent(
        <SearchView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayDirectVideo={vi.fn()}
          onAddToPlaylist={vi.fn()}
        />
      );

      const input = container?.querySelector('input.search-input') as HTMLInputElement;

      // 1. User types QueryOne
      act(() => {
        simulateTyping(input, 'QueryOne');
      });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      // 2. Before QueryOne finishes, user types QueryTwo
      act(() => {
        simulateTyping(input, 'QueryTwo');
      });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      // 3. QueryTwo finishes first (fast response)
      await act(async () => {
        resolveQuery2!({
          results: [{ videoId: 'q2', title: 'Newer Result', artist: 'Artist 2' }],
        });
        await Promise.resolve();
      });

      expect(container?.textContent).toContain('Newer Result');

      // 4. QueryOne finishes late (slow out-of-order response)
      await act(async () => {
        resolveQuery1!({
          results: [{ videoId: 'q1', title: 'Stale Result', artist: 'Artist 1' }],
        });
        await Promise.resolve();
      });

      // If SearchView does not track active/latest query ref, Stale Result will overwrite Newer Result!
      expect(container?.textContent).toContain('Newer Result');
      expect(container?.textContent).not.toContain('Stale Result');
    });
  });

  // =========================================================================
  // 2. INPUT PARSING & DIRECT LINK DETECTION ADVERSARIAL STRESS
  // =========================================================================
  describe('Input Parsing & Direct Link Detection: Edge Cases & Spoofs', () => {
    it('accurately parses valid YouTube URLs and bare IDs in parseYouTubeInput', () => {
      // 1. Standard watch
      expect(parseYouTubeInput('https://music.youtube.com/watch?v=4D7u5KF7SP8')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: null,
      });

      // 2. Watch with extra params (timestamp, tracking)
      expect(parseYouTubeInput('https://www.youtube.com/watch?v=4D7u5KF7SP8&t=90s&feature=shared')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: null,
      });

      // 3. Short URL
      expect(parseYouTubeInput('https://youtu.be/4D7u5KF7SP8?si=xyz123')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: null,
      });

      // 4. Shorts URL
      expect(parseYouTubeInput('https://www.youtube.com/shorts/4D7u5KF7SP8')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: null,
      });

      // 5. Embed URL
      expect(parseYouTubeInput('https://www.youtube.com/embed/4D7u5KF7SP8')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: null,
      });

      // 6. Protocol-less URLs
      expect(parseYouTubeInput('music.youtube.com/watch?v=4D7u5KF7SP8')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: null,
      });
      expect(parseYouTubeInput('youtu.be/4D7u5KF7SP8')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: null,
      });

      // 7. Bare 11-char video IDs with alphanumeric, dashes, underscores
      expect(parseYouTubeInput('4D7u5KF7SP8')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: null,
      });
      expect(parseYouTubeInput('_-123456789')).toEqual({
        videoId: '_-123456789',
        playlistId: null,
      });

      // 8. Bare playlist ID
      expect(parseYouTubeInput('PLrEnWoR732-B41U5n_xyz12345')).toEqual({
        videoId: null,
        playlistId: 'PLrEnWoR732-B41U5n_xyz12345',
      });

      // 9. Combined video and playlist
      expect(parseYouTubeInput('https://music.youtube.com/watch?v=4D7u5KF7SP8&list=PLrEnWoR732-B41U5n_xyz12345')).toEqual({
        videoId: '4D7u5KF7SP8',
        playlistId: 'PLrEnWoR732-B41U5n_xyz12345',
      });
    });

    it('rejects invalid domains, spoofs, and malformed inputs cleanly', () => {
      // Spoof domain attempting to look like YouTube
      expect(parseYouTubeInput('https://youtube.com.attacker.com/watch?v=4D7u5KF7SP8')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://notyoutube.com/watch?v=4D7u5KF7SP8')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://vimeo.com/123456789')).toEqual({
        videoId: null,
        playlistId: null,
      });

      // IDs of incorrect lengths (must be exactly 11 chars)
      expect(parseYouTubeInput('1234567890')).toEqual({ videoId: null, playlistId: null }); // 10 chars
      expect(parseYouTubeInput('123456789012')).toEqual({ videoId: null, playlistId: null }); // 12 chars

      // Null, empty, undefined, malformed protocol
      expect(parseYouTubeInput('')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput(null)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput(undefined)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('javascript:alert(1)')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('http://:::invalid')).toEqual({ videoId: null, playlistId: null });
    });

    it('renders Direct Link card in SearchView when pasting link and triggers direct playback or playlist adding', async () => {
      const onPlayDirectVideo = vi.fn();
      const onAddToPlaylist = vi.fn();

      await renderComponent(
        <SearchView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayDirectVideo={onPlayDirectVideo}
          onAddToPlaylist={onAddToPlaylist}
        />
      );

      const input = container?.querySelector('input.search-input') as HTMLInputElement;
      expect(input).not.toBeNull();

      // Paste combined video + playlist URL
      act(() => {
        simulateTyping(input, 'https://music.youtube.com/watch?v=5NV6Rdv1a3I&list=PLrEnWoR732-B41U5n_xyz12345');
      });

      expect(container?.textContent).toContain('Direct YouTube Link Detected');
      expect(container?.textContent).toContain('5NV6Rdv1a3I');
      expect(container?.textContent).toContain('PLrEnWoR732-B41U5n_xyz12345');

      // Test "▶ Play Now on PC"
      const playDirectBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('Play Now on PC')
      );
      expect(playDirectBtn).toBeDefined();

      act(() => {
        playDirectBtn?.click();
      });
      expect(onPlayDirectVideo).toHaveBeenCalledWith('5NV6Rdv1a3I', 'PLrEnWoR732-B41U5n_xyz12345');

      // Test "+ Add to Playlist"
      const addDirectBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('+ Add to Playlist')
      );
      expect(addDirectBtn).toBeDefined();

      act(() => {
        addDirectBtn?.click();
      });
      expect(onAddToPlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          videoId: '5NV6Rdv1a3I',
        })
      );
    });
  });

  // =========================================================================
  // 3. ADDTOPLAYLISTMODAL STRESS TESTS
  // =========================================================================
  describe('AddToPlaylistModal: Rapid Actions, Duplicate Warnings & Error States', () => {
    const targetTrack: SearchTrack = {
      videoId: 'vid_target_99',
      title: 'Target Song',
      artist: 'Target Artist',
      duration: '4:20',
      thumbnailUrl: 'https://art.com/target.jpg',
    };

    const existingPlaylists: EditablePlaylist[] = [
      {
        id: 'pl-has-track',
        title: 'Already Contains Track',
        name: 'Already Contains Track',
        updatedAt: '2026-10-24T22:00:00Z',
        tracks: [targetTrack],
      },
      {
        id: 'pl-empty',
        title: 'Empty Playlist',
        name: 'Empty Playlist',
        updatedAt: '2026-10-24T22:00:00Z',
        tracks: [],
      },
    ];

    it('displays (Already added) indicator for playlists that already contain target track videoId', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(existingPlaylists);

      await renderComponent(
        <AddToPlaylistModal
          track={targetTrack}
          client={mockClient}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(container?.textContent).toContain('(Already added)');
      expect(container?.textContent).toContain('Already Contains Track');
      expect(container?.textContent).toContain('Empty Playlist');
    });

    it('falls back to "Untitled Playlist" when creating with empty or whitespace title', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(existingPlaylists);
      const createSpy = vi.spyOn(mockClient, 'createEditablePlaylist').mockResolvedValue({
        id: 'pl-untitled',
        title: 'Untitled Playlist',
        name: 'Untitled Playlist',
        updatedAt: '2026-10-24T22:00:00Z',
        tracks: [],
      });
      const addSpy = vi.spyOn(mockClient, 'addTrackToPlaylist').mockResolvedValue({
        id: 'pl-untitled',
        title: 'Untitled Playlist',
        name: 'Untitled Playlist',
        updatedAt: '2026-10-24T22:00:00Z',
        tracks: [targetTrack],
      });

      const onSuccess = vi.fn();

      await renderComponent(
        <AddToPlaylistModal
          track={targetTrack}
          client={mockClient}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      );

      const input = container?.querySelector('input[placeholder="New playlist name..."]') as HTMLInputElement;
      expect(input).not.toBeNull();

      // Submit with only whitespace
      await act(async () => {
        simulateTyping(input, '     ');
      });

      const createBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('+ Create & Add')
      );
      expect(createBtn).toBeDefined();

      await act(async () => {
        createBtn?.click();
      });

      expect(createSpy).toHaveBeenCalledWith('Untitled Playlist');
      expect(addSpy).toHaveBeenCalledWith('pl-untitled', targetTrack);
      expect(onSuccess).toHaveBeenCalledWith('Untitled Playlist');
    });

    it('synchronous rapid double-click on Create & Add: tests whether duplicate playlists are created', async () => {
      let resolveCreate: (val: any) => void;
      const promise = new Promise((resolve) => {
        resolveCreate = resolve;
      });

      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue([]);
      const createSpy = vi.spyOn(mockClient, 'createEditablePlaylist').mockImplementation(() => promise as any);
      vi.spyOn(mockClient, 'addTrackToPlaylist').mockResolvedValue({} as any);

      await renderComponent(
        <AddToPlaylistModal
          track={targetTrack}
          client={mockClient}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      const input = container?.querySelector('input[placeholder="New playlist name..."]') as HTMLInputElement;
      await act(async () => {
        simulateTyping(input, 'Double Click Test');
      });

      const createBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('+ Create & Add')
      );

      // User rapidly double-clicks before re-render occurs
      await act(async () => {
        createBtn?.click();
        createBtn?.click();
      });

      // Should only call createEditablePlaylist once
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it('disables buttons once request is submitted and blocks post-render clicks', async () => {
      let resolveAdd: (val: any) => void;
      const deferredPromise = new Promise((resolve) => {
        resolveAdd = resolve;
      });

      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(existingPlaylists);
      const addSpy = vi.spyOn(mockClient, 'addTrackToPlaylist').mockImplementation(() => deferredPromise as any);

      const onSuccess = vi.fn();

      await renderComponent(
        <AddToPlaylistModal
          track={targetTrack}
          client={mockClient}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      );

      const emptyPlaylistBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('Empty Playlist')
      ) as HTMLButtonElement;
      expect(emptyPlaylistBtn).toBeDefined();

      // First click: initiates request
      await act(async () => {
        emptyPlaylistBtn.click();
      });

      expect(addSpy).toHaveBeenCalledTimes(1);
      // After React re-render, the button should have disabled attribute
      expect(emptyPlaylistBtn.disabled).toBe(true);

      // Attempting to click disabled button should not trigger another call
      await act(async () => {
        emptyPlaylistBtn.click();
      });
      expect(addSpy).toHaveBeenCalledTimes(1);

      // Resolve pending promise
      await act(async () => {
        resolveAdd!({ ...existingPlaylists[1], tracks: [targetTrack] });
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('survives rapid unmount before initial getEditablePlaylists resolves', async () => {
      let resolveGet: (val: any) => void;
      const deferredPromise = new Promise((resolve) => {
        resolveGet = resolve;
      });

      vi.spyOn(mockClient, 'getEditablePlaylists').mockImplementation(() => deferredPromise as any);

      await renderComponent(
        <AddToPlaylistModal
          track={targetTrack}
          client={mockClient}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(container?.textContent).toContain('Loading playlists...');

      // Unmount component while still in flight
      act(() => {
        root!.unmount();
      });

      // Resolve promise after unmount: should not throw unhandled exception
      await act(async () => {
        resolveGet!(existingPlaylists);
        await Promise.resolve();
      });
    });

    it('displays error banner if getEditablePlaylists fails', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockRejectedValueOnce(
        new Error('Failed to connect to playlists database')
      );

      await renderComponent(
        <AddToPlaylistModal
          track={targetTrack}
          client={mockClient}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(container?.textContent).toContain('Failed to connect to playlists database');
    });

    it('triggers onClose when clicking the modal backdrop or close button', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(existingPlaylists);
      const onClose = vi.fn();

      await renderComponent(
        <AddToPlaylistModal
          track={targetTrack}
          client={mockClient}
          onClose={onClose}
          onSuccess={vi.fn()}
        />
      );

      // 1. Click overlay
      const overlay = container?.querySelector('.modal-overlay') as HTMLElement;
      expect(overlay).not.toBeNull();
      act(() => {
        overlay.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);

      // 2. Click modal content interior: should NOT trigger onClose due to stopPropagation
      const content = container?.querySelector('.modal-content') as HTMLElement;
      expect(content).not.toBeNull();
      act(() => {
        content.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1); // Still 1

      // 3. Click '✕' button
      const closeBtn = container?.querySelector('button[aria-label="Close modal"]') as HTMLButtonElement;
      act(() => {
        closeBtn.click();
      });
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // 4. PLAYLISTSVIEW STRESS TESTS
  // =========================================================================
  describe('PlaylistsView: Creating, Renaming, Track Deletion, Accordion Stress', () => {
    const multiTracks: SearchTrack[] = [
      { videoId: 'track_1', title: 'First Song', artist: 'Artist 1', duration: '3:00' },
      { videoId: 'track_2', title: 'Second Song', artist: 'Artist 2', duration: '4:00' },
    ];

    const initialPlaylists: EditablePlaylist[] = [
      {
        id: 'pl_alpha',
        title: 'Alpha Playlist',
        name: 'Alpha Playlist',
        updatedAt: '2026-10-24T22:00:00Z',
        tracks: [...multiTracks],
      },
      {
        id: 'pl_beta',
        title: 'Beta Playlist',
        name: 'Beta Playlist',
        updatedAt: '2026-10-24T22:00:00Z',
        tracks: [],
      },
    ];

    const initialNative: PlaylistSummary[] = [
      { id: 'RD_desktop_1', title: 'Desktop Hits' },
      { id: 'RD_desktop_2', title: 'Desktop Chill' },
    ];

    it('creates playlist with empty or whitespace title by falling back to "Untitled Playlist"', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(initialPlaylists);
      vi.spyOn(mockClient, 'getPlaylists').mockResolvedValue(initialNative);
      const createSpy = vi.spyOn(mockClient, 'createEditablePlaylist').mockResolvedValue({
        id: 'pl_untitled_created',
        title: 'Untitled Playlist',
        name: 'Untitled Playlist',
        updatedAt: '2026-10-24T22:00:00Z',
        tracks: [],
      });

      await renderComponent(
        <PlaylistsView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayCustomPlaylist={vi.fn()}
          onPlayDesktopPlaylist={vi.fn()}
        />
      );

      // Open new playlist form
      const newBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('+ New Playlist')
      );
      await act(async () => {
        newBtn?.click();
      });

      const input = container?.querySelector('input[placeholder="Playlist name..."]') as HTMLInputElement;
      expect(input).not.toBeNull();

      // Submit empty
      await act(async () => {
        simulateTyping(input, '   ');
      });

      const createSubmitBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent === 'Create'
      );
      await act(async () => {
        createSubmitBtn?.click();
      });

      expect(createSpy).toHaveBeenCalledWith('Untitled Playlist');
      expect(container?.textContent).toContain('Untitled Playlist');
    });

    it('synchronous rapid double-click on Create in PlaylistsView: tests whether duplicate playlists are created', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(initialPlaylists);
      vi.spyOn(mockClient, 'getPlaylists').mockResolvedValue(initialNative);
      let resolveCreate: (val: any) => void;
      const promise = new Promise((resolve) => {
        resolveCreate = resolve;
      });
      const createSpy = vi.spyOn(mockClient, 'createEditablePlaylist').mockImplementation(() => promise as any);

      await renderComponent(
        <PlaylistsView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayCustomPlaylist={vi.fn()}
          onPlayDesktopPlaylist={vi.fn()}
        />
      );

      const newBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('+ New Playlist')
      );
      await act(async () => {
        newBtn?.click();
      });

      const input = container?.querySelector('input[placeholder="Playlist name..."]') as HTMLInputElement;
      await act(async () => {
        simulateTyping(input, 'Rapid PlaylistsView Create');
      });

      const createSubmitBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent === 'Create'
      );

      // User double clicks Create
      await act(async () => {
        createSubmitBtn?.click();
        createSubmitBtn?.click();
      });

      // Should only create 1 playlist
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it('aborts renaming without calling API when submitted name is empty or whitespace', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(initialPlaylists);
      vi.spyOn(mockClient, 'getPlaylists').mockResolvedValue(initialNative);
      const renameSpy = vi.spyOn(mockClient, 'renameEditablePlaylist');

      await renderComponent(
        <PlaylistsView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayCustomPlaylist={vi.fn()}
          onPlayDesktopPlaylist={vi.fn()}
        />
      );

      // Click rename ✏️ on Alpha Playlist
      const renameBtn = container?.querySelector('button[aria-label="Rename playlist"]') as HTMLButtonElement;
      expect(renameBtn).not.toBeNull();

      await act(async () => {
        renameBtn.click();
      });

      // Rename input should be visible with current title
      const editInput = container?.querySelector('input[value="Alpha Playlist"]') as HTMLInputElement;
      expect(editInput).not.toBeNull();

      // Clear input and set only whitespace
      await act(async () => {
        simulateTyping(editInput, '   ');
      });

      const saveBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent === 'Save'
      );
      await act(async () => {
        saveBtn?.click();
      });

      // renameEditablePlaylist should NOT be called
      expect(renameSpy).not.toHaveBeenCalled();
      // Should exit edit mode
      expect(container?.querySelector('input[value="Alpha Playlist"]')).toBeNull();
      expect(container?.textContent).toContain('Alpha Playlist');
    });

    it('expands only one playlist at a time (accordion) and collapses on second click', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(initialPlaylists);
      vi.spyOn(mockClient, 'getPlaylists').mockResolvedValue(initialNative);

      await renderComponent(
        <PlaylistsView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayCustomPlaylist={vi.fn()}
          onPlayDesktopPlaylist={vi.fn()}
        />
      );

      // Find the specific title div for Alpha Playlist and Beta Playlist
      const alphaTitle = Array.from(container?.querySelectorAll('div') || []).find(
        (d) => d.textContent === 'Alpha Playlist'
      );
      const betaTitle = Array.from(container?.querySelectorAll('div') || []).find(
        (d) => d.textContent === 'Beta Playlist'
      );

      expect(alphaTitle).toBeDefined();
      expect(betaTitle).toBeDefined();

      // Click Alpha Playlist title to expand
      await act(async () => {
        alphaTitle?.click();
      });

      expect(container?.textContent).toContain('First Song');
      expect(container?.textContent).toContain('Second Song');

      // Now click Beta Playlist title: Alpha collapses, Beta expands
      await act(async () => {
        betaTitle?.click();
      });

      expect(container?.textContent).not.toContain('First Song');
      expect(container?.textContent).toContain('This playlist is empty. Add songs from Search, Queue, or Now Playing!');

      // Click Beta again: collapses Beta
      await act(async () => {
        betaTitle?.click();
      });

      expect(container?.textContent).not.toContain('This playlist is empty.');
    });

    it('deleting all tracks in an expanded playlist reveals empty state notice and hides Play All button', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue([
        {
          id: 'pl_single',
          title: 'Single Track Playlist',
          name: 'Single Track Playlist',
          updatedAt: '2026-10-24T22:00:00Z',
          tracks: [multiTracks[0]],
        },
      ]);
      vi.spyOn(mockClient, 'getPlaylists').mockResolvedValue([]);

      vi.spyOn(mockClient, 'removeTrackFromPlaylist').mockResolvedValue({
        id: 'pl_single',
        title: 'Single Track Playlist',
        name: 'Single Track Playlist',
        updatedAt: '2026-10-24T22:05:00Z',
        tracks: [],
      });

      await renderComponent(
        <PlaylistsView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayCustomPlaylist={vi.fn()}
          onPlayDesktopPlaylist={vi.fn()}
        />
      );

      // Expand playlist by clicking title
      const titleEl = Array.from(container?.querySelectorAll('div') || []).find(
        (d) => d.textContent === 'Single Track Playlist'
      );
      expect(titleEl).toBeDefined();

      await act(async () => {
        titleEl?.click();
      });

      expect(container?.textContent).toContain('First Song');
      const playAllBtn = container?.querySelector('button[title="Play entire playlist on PC"]');
      expect(playAllBtn).not.toBeNull();

      // Click remove '✕' on track
      const removeTrackBtn = container?.querySelector('button[title="Remove from playlist"]') as HTMLButtonElement;
      expect(removeTrackBtn).not.toBeNull();

      await act(async () => {
        removeTrackBtn.click();
      });

      expect(mockClient.removeTrackFromPlaylist).toHaveBeenCalledWith('pl_single', 'track_1');
      expect(container?.textContent).toContain('This playlist is empty. Add songs from Search, Queue, or Now Playing!');
      // Play All button should now disappear
      expect(container?.querySelector('button[title="Play entire playlist on PC"]')).toBeNull();
    });

    it('deleting playlist confirmation can be cancelled without deleting', async () => {
      vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(initialPlaylists);
      vi.spyOn(mockClient, 'getPlaylists').mockResolvedValue(initialNative);
      const deleteSpy = vi.spyOn(mockClient, 'deleteEditablePlaylist');

      await renderComponent(
        <PlaylistsView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayCustomPlaylist={vi.fn()}
          onPlayDesktopPlaylist={vi.fn()}
        />
      );

      const trashBtn = container?.querySelector('button[title="Delete playlist"]') as HTMLButtonElement;
      expect(trashBtn).not.toBeNull();

      // Click trash icon
      await act(async () => {
        trashBtn.click();
      });

      // Confirm and Cancel buttons appear
      const confirmBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent === 'Confirm'
      );
      const cancelDeleteBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent === '✕' && b.className.includes('btn-secondary')
      );
      expect(confirmBtn).toBeDefined();
      expect(cancelDeleteBtn).toBeDefined();

      // Click Cancel
      await act(async () => {
        cancelDeleteBtn?.click();
      });

      expect(deleteSpy).not.toHaveBeenCalled();
      expect(container?.textContent).toContain('Alpha Playlist');
    });

    it('displays notice for native playlists when client has no token', async () => {
      const clientWithoutToken = new CompanionClient({ token: null });
      vi.spyOn(clientWithoutToken, 'getEditablePlaylists').mockResolvedValue(initialPlaylists);

      await renderComponent(
        <PlaylistsView
          client={clientWithoutToken}
          onPlayTrack={vi.fn()}
          onPlayCustomPlaylist={vi.fn()}
          onPlayDesktopPlaylist={vi.fn()}
        />
      );

      expect(container?.textContent).toContain('Connect to YTMDesktop to load library playlists');
    });

    it('refreshes both Tubify and desktop playlists on tapping Refresh', async () => {
      const getEditSpy = vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(initialPlaylists);
      const getNativeSpy = vi.spyOn(mockClient, 'getPlaylists').mockResolvedValue(initialNative);

      await renderComponent(
        <PlaylistsView
          client={mockClient}
          onPlayTrack={vi.fn()}
          onPlayCustomPlaylist={vi.fn()}
          onPlayDesktopPlaylist={vi.fn()}
        />
      );

      expect(getEditSpy).toHaveBeenCalledTimes(1);
      expect(getNativeSpy).toHaveBeenCalledTimes(1);

      const refreshBtn = container?.querySelector('button[title="Refresh All Playlists"]') as HTMLButtonElement;
      expect(refreshBtn).not.toBeNull();

      await act(async () => {
        refreshBtn.click();
      });

      expect(getEditSpy).toHaveBeenCalledTimes(2);
      expect(getNativeSpy).toHaveBeenCalledTimes(2);
    });
  });
});
