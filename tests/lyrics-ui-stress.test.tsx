import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LyricsView } from '../src/components/LyricsView';
import * as lyricsLib from '../src/lib/lyrics';
import type { VideoMetadata, TrackLyrics, LyricLine } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Empirical Adversarial Stress Suite: LyricsView UI Component', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let onSeek: ReturnType<typeof vi.fn>;
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  const baseVideo: VideoMetadata = {
    id: 'vid-queen-bohemian',
    title: 'Bohemian Rhapsody',
    author: 'Queen',
    album: 'A Night at the Opera',
    durationSeconds: 355,
  };

  const sampleSyncedLines: LyricLine[] = [
    { timeSeconds: 5.0, text: 'Is this the real life?' },
    { timeSeconds: 10.0, text: 'Is this just fantasy?' },
    { timeSeconds: 15.0, text: '' }, // Musical interlude
    { timeSeconds: 20.0, text: 'Caught in a landslide' },
    { timeSeconds: 25.0, text: 'No escape from reality' },
    { timeSeconds: 30.0, text: 'Open your eyes' },
  ];

  const standardLyrics: TrackLyrics = {
    videoId: 'vid-queen-bohemian',
    synced: true,
    instrumental: false,
    lines: sampleSyncedLines,
    plainText: null,
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onSeek = vi.fn();

    scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    lyricsLib.clearLyricsCache();
    vi.restoreAllMocks();
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
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // SECTION 1: Rapid Song Switches & Asynchronous Race Conditions
  // ==========================================================================
  describe('1. Rapid Song Switches & Race Condition Stress', () => {
    it('prevents stale lyrics from overwriting newer song when responses resolve out of order', async () => {
      // Setup 4 songs with out-of-order latency:
      // Song A takes 150ms, Song B takes 100ms, Song C takes 50ms, Song D takes 10ms
      const songs: VideoMetadata[] = [
        { id: 'song-A', title: 'Song Alpha', author: 'Artist A', album: 'Album A', durationSeconds: 200 },
        { id: 'song-B', title: 'Song Beta', author: 'Artist B', album: 'Album B', durationSeconds: 200 },
        { id: 'song-C', title: 'Song Gamma', author: 'Artist C', album: 'Album C', durationSeconds: 200 },
        { id: 'song-D', title: 'Song Delta', author: 'Artist D', album: 'Album D', durationSeconds: 200 },
      ];

      const resolvers: Record<string, (lyrics: TrackLyrics | null) => void> = {};
      const abortSignals: Record<string, boolean> = {};

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockImplementation((video, options) => {
        const id = video?.id || '';
        return new Promise<TrackLyrics | null>((resolve, reject) => {
          resolvers[id] = resolve;
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              abortSignals[id] = true;
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      // 1. Mount with Song A
      await act(async () => {
        root!.render(<LyricsView video={songs[0]} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(container?.textContent).toContain('Song Alpha');

      // 2. Rapid switch to Song B
      await act(async () => {
        root!.render(<LyricsView video={songs[1]} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(abortSignals['song-A']).toBe(true);

      // 3. Rapid switch to Song C
      await act(async () => {
        root!.render(<LyricsView video={songs[2]} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(abortSignals['song-B']).toBe(true);

      // 4. Rapid switch to Song D (final song)
      await act(async () => {
        root!.render(<LyricsView video={songs[3]} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(abortSignals['song-C']).toBe(true);

      // Now resolve Song D (the latest song) first
      const songDLyrics: TrackLyrics = {
        videoId: 'song-D',
        synced: true,
        instrumental: false,
        lines: [{ timeSeconds: 5, text: 'Delta Lyric Line 1' }],
        plainText: null,
      };

      await act(async () => {
        resolvers['song-D'](songDLyrics);
      });

      // Song D lyrics should now be displayed
      expect(container?.textContent).toContain('Delta Lyric Line 1');

      // Try resolving stale songs A, B, C (they were aborted, but simulate late resolution attempt)
      const songALyrics: TrackLyrics = {
        videoId: 'song-A',
        synced: true,
        instrumental: false,
        lines: [{ timeSeconds: 5, text: 'Alpha Lyric Line 1' }],
        plainText: null,
      };

      try {
        await act(async () => {
          resolvers['song-A']?.(songALyrics);
        });
      } catch {
        // Ignored
      }

      // Song D must STILL be displayed, Alpha must NOT appear
      expect(container?.textContent).toContain('Delta Lyric Line 1');
      expect(container?.textContent).not.toContain('Alpha Lyric Line 1');
    });

    it('handles rapid switches between cached and uncached tracks seamlessly', async () => {
      const cachedSong: VideoMetadata = {
        id: 'cached-1',
        title: 'Cached Track',
        author: 'Cached Artist',
        album: 'Cached Album',
        durationSeconds: 180,
      };
      const uncachedSong: VideoMetadata = {
        id: 'uncached-1',
        title: 'Uncached Track',
        author: 'Uncached Artist',
        album: 'Uncached Album',
        durationSeconds: 240,
      };

      const cachedLyrics: TrackLyrics = {
        videoId: 'cached-1',
        synced: true,
        instrumental: false,
        lines: [{ timeSeconds: 2.0, text: 'Instant cached lyric' }],
        plainText: null,
      };

      let resolveUncached: (val: TrackLyrics | null) => void;
      const uncachedPromise = new Promise<TrackLyrics | null>((res) => {
        resolveUncached = res;
      });

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockImplementation((video) => {
        if (video?.id === 'cached-1') {
          return Promise.resolve(cachedLyrics);
        }
        return uncachedPromise;
      });

      // Mount cached song -> renders instantly
      await act(async () => {
        root!.render(<LyricsView video={cachedSong} currentTime={2.5} isPlaying={true} onSeek={onSeek} />);
      });
      expect(container?.textContent).toContain('Instant cached lyric');

      // Switch to uncached song -> displays loading state
      await act(async () => {
        root!.render(<LyricsView video={uncachedSong} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(container?.textContent).toContain('Loading lyrics...');
      expect(container?.textContent).toContain('Uncached Track');

      // Switch back to cached song before uncached finishes
      await act(async () => {
        root!.render(<LyricsView video={cachedSong} currentTime={2.5} isPlaying={true} onSeek={onSeek} />);
      });
      expect(container?.textContent).toContain('Instant cached lyric');

      // Resolve uncached song
      await act(async () => {
        resolveUncached!({
          videoId: 'uncached-1',
          synced: true,
          instrumental: false,
          lines: [{ timeSeconds: 1, text: 'Late uncached lyric' }],
          plainText: null,
        });
      });

      // Must still show cached song lyrics
      expect(container?.textContent).toContain('Instant cached lyric');
      expect(container?.textContent).not.toContain('Late uncached lyric');
    });

    it('immediately resets to idle when video becomes null while fetch is in-flight', async () => {
      let resolveInFlight: (val: TrackLyrics | null) => void;
      const inFlightPromise = new Promise<TrackLyrics | null>((res) => {
        resolveInFlight = res;
      });

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockReturnValue(inFlightPromise);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(container?.textContent).toContain('Loading lyrics...');

      // Playback stopped: video becomes null
      await act(async () => {
        root!.render(<LyricsView video={null} currentTime={0} isPlaying={false} onSeek={onSeek} />);
      });
      expect(container?.textContent).toContain('Play a song to see lyrics');

      // Later, promise resolves
      await act(async () => {
        resolveInFlight!(standardLyrics);
      });

      // Must remain in idle state
      expect(container?.textContent).toContain('Play a song to see lyrics');
      expect(container?.textContent).not.toContain('Bohemian Rhapsody');
    });

    it('isolates network error from previous song so next song renders cleanly', async () => {
      const songError: VideoMetadata = { id: 'err-1', title: 'Error Track', author: 'Err', album: null, durationSeconds: 100 };
      const songGood: VideoMetadata = { id: 'good-1', title: 'Good Track', author: 'Good', album: null, durationSeconds: 100 };

      let rejectErrorTrack: (err: any) => void;
      const errorPromise = new Promise<TrackLyrics | null>((_, rej) => {
        rejectErrorTrack = rej;
      });

      const goodLyrics: TrackLyrics = {
        videoId: 'good-1',
        synced: true,
        instrumental: false,
        lines: [{ timeSeconds: 3, text: 'Good track lyrics line' }],
        plainText: null,
      };

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockImplementation((video) => {
        if (video?.id === 'err-1') return errorPromise;
        return Promise.resolve(goodLyrics);
      });

      // 1. Mount error song
      await act(async () => {
        root!.render(<LyricsView video={songError} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(container?.textContent).toContain('Loading lyrics...');

      // 2. Switch to good song
      await act(async () => {
        root!.render(<LyricsView video={songGood} currentTime={3.5} isPlaying={true} onSeek={onSeek} />);
      });
      expect(container?.textContent).toContain('Good track lyrics line');

      // 3. Error track rejects
      await act(async () => {
        rejectErrorTrack!(new Error('503 Service Unavailable'));
      });

      // Good track must remain displayed without showing error banner
      expect(container?.textContent).toContain('Good track lyrics line');
      expect(container?.textContent).not.toContain('Failed to fetch lyrics');
    });

    it('survives 30 rapid back-and-forth toggles between two songs without crashing', async () => {
      const song1: VideoMetadata = { id: 'toggle-1', title: 'Toggle Track 1', author: 'A1', album: null, durationSeconds: 120 };
      const song2: VideoMetadata = { id: 'toggle-2', title: 'Toggle Track 2', author: 'A2', album: null, durationSeconds: 120 };

      const lyrics1: TrackLyrics = {
        videoId: 'toggle-1',
        synced: true,
        instrumental: false,
        lines: [{ timeSeconds: 1, text: 'Lyrics for Track 1' }],
        plainText: null,
      };
      const lyrics2: TrackLyrics = {
        videoId: 'toggle-2',
        synced: true,
        instrumental: false,
        lines: [{ timeSeconds: 1, text: 'Lyrics for Track 2' }],
        plainText: null,
      };

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockImplementation(async (video) => {
        if (video?.id === 'toggle-1') return lyrics1;
        return lyrics2;
      });

      // Rapidly toggle 30 times
      for (let i = 0; i < 30; i++) {
        const v = i % 2 === 0 ? song1 : song2;
        await act(async () => {
          root!.render(<LyricsView video={v} currentTime={1.5} isPlaying={true} onSeek={onSeek} />);
        });
      }

      // Last was i=29 (odd) -> song2
      expect(container?.textContent).toContain('Lyrics for Track 2');
    });
  });

  // ==========================================================================
  // SECTION 2: Anti-Jitter Auto-Scroll on 200ms Progress Ticks
  // ==========================================================================
  describe('2. Anti-Jitter Auto-Scroll on 200ms Progress Ticks', () => {
    it('executes scrollIntoView EXACTLY ONCE across 75 dense 200ms ticks within the same line', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      // Line 0 is [5.0s, 10.0s). Render at 5.0s
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });

      // Initial active index 0 triggers scrollIntoView once
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

      // Now send 24 dense ticks within Line 0 (from 5.2s to 9.8s at 0.2s increments)
      for (let sec = 5.2; sec < 10.0; sec += 0.2) {
        await act(async () => {
          root!.render(<LyricsView video={baseVideo} currentTime={sec} isPlaying={true} onSeek={onSeek} />);
        });
      }

      // CRITICAL ANTI-JITTER VERIFICATION: Call count must STILL be exactly 1!
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });

    it('triggers scrollIntoView exactly once per line transition across entire song', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      // Start at intro t=0 (no line active yet, activeIndex = -1)
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      // Intro should NOT trigger scroll
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(0);

      // Advance through lines:
      // Line 0 at 5.0s
      // Line 1 at 10.0s
      // Line 2 at 15.0s
      // Line 3 at 20.0s
      // Line 4 at 25.0s
      // Line 5 at 30.0s

      let expectedScrollCount = 0;
      const lineTimes = [5.0, 10.0, 15.0, 20.0, 25.0, 30.0];

      for (const lineTime of lineTimes) {
        // Send transition tick
        await act(async () => {
          root!.render(<LyricsView video={baseVideo} currentTime={lineTime} isPlaying={true} onSeek={onSeek} />);
        });
        expectedScrollCount++;
        expect(scrollIntoViewMock).toHaveBeenCalledTimes(expectedScrollCount);

        // Send 4 sub-ticks inside this line
        for (let sub = 0.2; sub <= 0.8; sub += 0.2) {
          await act(async () => {
            root!.render(
              <LyricsView video={baseVideo} currentTime={lineTime + sub} isPlaying={true} onSeek={onSeek} />
            );
          });
        }
        // Count must not increase during sub-ticks
        expect(scrollIntoViewMock).toHaveBeenCalledTimes(expectedScrollCount);
      }

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(6);
    });

    it('triggers auto-scroll immediately upon backward scrub / seek', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      // Start at 26.0s (Line 4 active)
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={26.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      // Scrub backward to 6.0s (Line 0 active)
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={6.0} isPlaying={true} onSeek={onSeek} />);
      });

      // activeIndex changed from 4 to 0 -> must call scrollIntoView again
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);

      // Scrub forward to 31.0s (Line 5 active)
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={31.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(3);
    });

    it('remains dormant past the last line without superfluous scroll calls', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      // Last line is at 30.0s
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={30.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      // Advance time past the last line: 35s, 40s, 60s, 120s
      for (const t of [35, 40, 60, 120, 200, 350]) {
        await act(async () => {
          root!.render(<LyricsView video={baseVideo} currentTime={t} isPlaying={true} onSeek={onSeek} />);
        });
      }

      // Must remain at 1
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });

    it('does not trigger scroll on microscopic floating-point progress increments', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      // 50 sub-millisecond float ticks
      for (let i = 1; i <= 50; i++) {
        await act(async () => {
          root!.render(
            <LyricsView video={baseVideo} currentTime={5.0 + i * 0.001} isPlaying={true} onSeek={onSeek} />
          );
        });
      }

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // SECTION 3: User Interaction Suspension & "Resume Sync" Recovery
  // ==========================================================================
  describe('3. User Interaction Suspension & Resume Sync Recovery', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('suspends auto-scroll across line transitions upon wheel/touch interaction', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      // Render at line 0 (5.0s)
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      const scrollArea = container?.querySelector('.lyrics-scroll-area');
      expect(scrollArea).not.null;

      // Simulate user wheel gesture
      await act(async () => {
        scrollArea?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      });

      // Resume sync button appears
      expect(container?.querySelector('.lyrics-resume-sync-btn')).not.null;

      // Advance progress to line 1 (10s), line 2 (15s), line 3 (20s) while user is interacting
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={10.0} isPlaying={true} onSeek={onSeek} />);
      });
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={15.0} isPlaying={true} onSeek={onSeek} />);
      });
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={20.0} isPlaying={true} onSeek={onSeek} />);
      });

      // Auto-scroll MUST be completely suspended (still 1 call from initial render)
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });

    it('automatically re-centers and restores auto-scroll after 4000ms idle timeout', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      const scrollArea = container?.querySelector('.lyrics-scroll-area');
      await act(async () => {
        scrollArea?.dispatchEvent(new TouchEvent('touchmove', { bubbles: true }));
      });
      expect(container?.querySelector('.lyrics-resume-sync-btn')).not.null;

      // Advance time to Line 2 (15.0s) while suspended
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={15.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      // Fast forward 3999ms -> still suspended
      await act(async () => {
        vi.advanceTimersByTime(3999);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
      expect(container?.querySelector('.lyrics-resume-sync-btn')).not.null;

      // Fast forward 1ms more (reaching 4000ms) -> timeout fires!
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Immediately re-centers on active line 2!
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
      expect(container?.querySelector('.lyrics-resume-sync-btn')).toBeNull();

      // Subsequent line transitions resume normal auto-scroll
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={20.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(3);
    });

    it('repeated user interactions continuously reset the 4000ms timer', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });

      const scrollArea = container?.querySelector('.lyrics-scroll-area');

      // Scroll at t = 0
      await act(async () => {
        scrollArea?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      });

      // Advance 2500ms
      await act(async () => {
        vi.advanceTimersByTime(2500);
      });

      // Scroll again at t = 2500ms (resets timer for another 4000ms)
      await act(async () => {
        scrollArea?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      });

      // Advance 2500ms (total elapsed: 5000ms from start, but 2500ms from last scroll)
      await act(async () => {
        vi.advanceTimersByTime(2500);
      });

      // Should still be interacting because timer was reset!
      expect(container?.querySelector('.lyrics-resume-sync-btn')).not.null;

      // Advance remaining 1500ms (4000ms from second scroll)
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });

      // Now it clears
      expect(container?.querySelector('.lyrics-resume-sync-btn')).toBeNull();
    });

    it('tapping "Resume Sync" button immediately snaps back to active line and clears timer', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      const scrollArea = container?.querySelector('.lyrics-scroll-area');
      await act(async () => {
        scrollArea?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      });

      // Advance progress to Line 3 (20.0s) while suspended
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={20.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      const resumeBtn = container?.querySelector('.lyrics-resume-sync-btn');
      expect(resumeBtn).not.null;

      // Tap Resume Sync button
      await act(async () => {
        resumeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      // Snaps to active line immediately
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
      expect(container?.querySelector('.lyrics-resume-sync-btn')).toBeNull();

      // Advancing time immediately auto-scrolls without waiting 4s
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={25.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(3);
    });

    it('does not display Resume Sync button during song intro before line 0', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      // At t = 2.0s (Line 0 is at 5.0s, so activeIndex = -1)
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={2.0} isPlaying={true} onSeek={onSeek} />);
      });

      const scrollArea = container?.querySelector('.lyrics-scroll-area');
      await act(async () => {
        scrollArea?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      });

      // activeIndex is -1, so button should NOT appear
      expect(container?.querySelector('.lyrics-resume-sync-btn')).toBeNull();

      // When progress reaches Line 0 at 5.0s, activeIndex >= 0, so button appears!
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(container?.querySelector('.lyrics-resume-sync-btn')).not.null;
    });

    it('clears interaction state and enables auto-scroll when switching to a different song', async () => {
      const song2: VideoMetadata = { id: 'song-2', title: 'Song 2', author: 'Artist 2', album: null, durationSeconds: 150 };
      const song2Lyrics: TrackLyrics = {
        videoId: 'song-2',
        synced: true,
        instrumental: false,
        lines: [
          { timeSeconds: 5.0, text: 'Song 2 Line 0' },
          { timeSeconds: 10.0, text: 'Song 2 Line 1' },
        ],
        plainText: null,
      };

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockImplementation(async (video) => {
        if (video?.id === 'song-2') return song2Lyrics;
        return standardLyrics;
      });

      // 1. Mount song 1 at line 0
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      // User scrolls during song 1
      const scrollArea = container?.querySelector('.lyrics-scroll-area');
      await act(async () => {
        scrollArea?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      });
      expect(container?.querySelector('.lyrics-resume-sync-btn')).not.null;

      // 2. Song switches to Song 2 at line 0 (5.0s)
      await act(async () => {
        root!.render(<LyricsView video={song2} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });

      // Song 2 should NOT have Resume Sync button stuck on screen
      expect(container?.querySelector('.lyrics-resume-sync-btn')).toBeNull();
      // Song 2 should have auto-scrolled to its active line
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // SECTION 4: Rapid Line Taps (Tap-to-Seek) Fidelity & Boundary Handling
  // ==========================================================================
  describe('4. Rapid Line Taps (Tap-to-Seek) Fidelity & Boundary Handling', () => {
    it('dispatches onSeek with exact float and integer timestamps for boundary and internal lines', async () => {
      const boundaryLyrics: TrackLyrics = {
        videoId: 'boundary-test',
        synced: true,
        instrumental: false,
        lines: [
          { timeSeconds: 0.0, text: 'First line at zero' },
          { timeSeconds: 4.25, text: 'Fractional centiseconds line' },
          { timeSeconds: 12.008, text: 'Fractional milliseconds line' },
          { timeSeconds: 18.0, text: '' }, // Musical pause
          { timeSeconds: 354.95, text: 'Last boundary line' },
        ],
        plainText: null,
      };

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(boundaryLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });

      const buttons = container?.querySelectorAll('.lyric-line-btn');
      expect(buttons?.length).toBe(5);

      // Click each line in order
      for (let i = 0; i < buttons!.length; i++) {
        await act(async () => {
          buttons![i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      }

      expect(onSeek).toHaveBeenCalledTimes(5);
      expect(onSeek).toHaveBeenNthCalledWith(1, 0.0);
      expect(onSeek).toHaveBeenNthCalledWith(2, 4.25);
      expect(onSeek).toHaveBeenNthCalledWith(3, 12.008);
      expect(onSeek).toHaveBeenNthCalledWith(4, 18.0);
      expect(onSeek).toHaveBeenNthCalledWith(5, 354.95);
    });

    it('handles a rapid burst of 20 line taps in rapid succession', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });

      const buttons = container?.querySelectorAll('.lyric-line-btn');
      expect(buttons?.length).toBe(6);

      // Rapidly fire 20 clicks
      for (let k = 0; k < 20; k++) {
        const targetBtn = buttons![k % buttons!.length];
        await act(async () => {
          targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      }

      expect(onSeek).toHaveBeenCalledTimes(20);
    });

    it('taps on musical pause lines (empty text ♪ ♪ ♪) successfully', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });

      const pauseBtn = container?.querySelectorAll('.lyric-line-btn')[2];
      expect(pauseBtn?.querySelector('.lyric-pause-notes')).not.null;

      await act(async () => {
        pauseBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onSeek).toHaveBeenCalledWith(15.0);
    });

    it('survives onSeek throwing an error or returning a rejected promise without unmounting', async () => {
      const rejectingOnSeek = vi.fn().mockRejectedValue(new Error('Network error on companion server'));
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={0} isPlaying={true} onSeek={rejectingOnSeek} />);
      });

      const lineBtn = container?.querySelectorAll('.lyric-line-btn')[1];

      await act(async () => {
        lineBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(rejectingOnSeek).toHaveBeenCalledWith(10.0);
      // View should remain intact and still rendered
      expect(container?.querySelectorAll('.lyric-line-btn').length).toBe(6);
    });
  });

  // ==========================================================================
  // SECTION 5: Rapid Component Unmounting & Remounting Stress
  // ==========================================================================
  describe('5. Rapid Component Unmounting & Remounting Stress', () => {
    it('aborts in-flight fetch and prevents state update when unmounted during loading', async () => {
      let capturedSignal: AbortSignal | undefined;
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockImplementation((_, opts) => {
        capturedSignal = opts?.signal;
        return new Promise(() => {}); // Never resolves
      });

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);

      // Unmount while in flight
      await act(async () => {
        root!.unmount();
      });

      // Signal must have been aborted
      expect(capturedSignal?.aborted).toBe(true);
    });

    it('clears interaction timers on unmount to prevent ghost callbacks', async () => {
      vi.useFakeTimers();
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });

      const scrollArea = container?.querySelector('.lyrics-scroll-area');
      await act(async () => {
        scrollArea?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      });

      // Unmount while 4s timer is pending
      await act(async () => {
        root!.unmount();
      });

      // Advance timer by 10s
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      // No errors should be thrown
      vi.useRealTimers();
    });

    it('performs 25 mount-and-unmount cycles rapidly without leaking listeners or throwing', async () => {
      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(standardLyrics);

      for (let i = 0; i < 25; i++) {
        const testContainer = document.createElement('div');
        document.body.appendChild(testContainer);
        const testRoot = createRoot(testContainer);

        await act(async () => {
          testRoot.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
        });

        await act(async () => {
          testRoot.unmount();
        });

        testContainer.remove();
      }
    });
  });

  // ==========================================================================
  // SECTION 6: Visual State Fallbacks & Adversarial Edge Cases
  // ==========================================================================
  describe('6. Visual State Fallbacks & Adversarial Edge Cases', () => {
    it('handles empty lines array gracefully when synced is true', async () => {
      const emptySynced: TrackLyrics = {
        videoId: 'empty-synced',
        synced: true,
        instrumental: false,
        lines: [],
        plainText: null,
      };

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(emptySynced);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={10.0} isPlaying={true} onSeek={onSeek} />);
      });

      const scrollArea = container?.querySelector('.lyrics-scroll-area');
      expect(scrollArea).not.null;
      expect(container?.querySelectorAll('.lyric-line-btn').length).toBe(0);
    });

    it('handles single-line synced lyrics across boundary times', async () => {
      const singleLineLyrics: TrackLyrics = {
        videoId: 'single-line',
        synced: true,
        instrumental: false,
        lines: [{ timeSeconds: 10.0, text: 'Only Line in Song' }],
        plainText: null,
      };

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(singleLineLyrics);

      // Before line at 5s -> inactive
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });
      const btnBefore = container?.querySelector('.lyric-line-btn');
      expect(btnBefore?.classList.contains('active')).toBe(false);
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(0);

      // At 10s -> active
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={10.0} isPlaying={true} onSeek={onSeek} />);
      });
      const btnActive = container?.querySelector('.lyric-line-btn');
      expect(btnActive?.classList.contains('active')).toBe(true);
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      // At 50s -> still active, no extra scroll calls
      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={50.0} isPlaying={true} onSeek={onSeek} />);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });

    it('renders duplicate-timestamp lines with unique keys and distinct elements', async () => {
      const duplicateTimestampLyrics: TrackLyrics = {
        videoId: 'dup-time',
        synced: true,
        instrumental: false,
        lines: [
          { timeSeconds: 5.0, text: 'Chorus Part A' },
          { timeSeconds: 5.0, text: 'Chorus Part B' },
          { timeSeconds: 5.0, text: 'Chorus Part C' },
        ],
        plainText: null,
      };

      vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(duplicateTimestampLyrics);

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={5.0} isPlaying={true} onSeek={onSeek} />);
      });

      const buttons = container?.querySelectorAll('.lyric-line-btn');
      expect(buttons?.length).toBe(3);
      expect(buttons?.[0].textContent).toBe('Chorus Part A');
      expect(buttons?.[1].textContent).toBe('Chorus Part B');
      expect(buttons?.[2].textContent).toBe('Chorus Part C');
    });

    it('renders and re-attempts fetch when clicking Retry Search button', async () => {
      const fetchSpy = vi.spyOn(lyricsLib, 'fetchTrackLyrics');
      fetchSpy.mockResolvedValueOnce(null); // First call returns no lyrics

      await act(async () => {
        root!.render(<LyricsView video={baseVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
      });

      expect(container?.textContent).toContain('No lyrics found');
      const retryBtn = container?.querySelector('button');
      expect(retryBtn?.textContent).toContain('Retry Search');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Setup success for retry call
      fetchSpy.mockResolvedValueOnce(standardLyrics);

      await act(async () => {
        retryBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(container?.textContent).toContain('Is this the real life?');
    });
  });
});
