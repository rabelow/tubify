import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LyricsView } from '../src/components/LyricsView';
import * as lyricsLib from '../src/lib/lyrics';
import type { VideoMetadata, TrackLyrics } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('T024: LyricsView Component Suite', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let onSeek: ReturnType<typeof vi.fn>;
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  const sampleVideo: VideoMetadata = {
    id: 'test-video-1',
    title: 'Bohemian Rhapsody',
    author: 'Queen',
    album: 'A Night at the Opera',
    durationSeconds: 355,
  };

  const sampleLyrics: TrackLyrics = {
    videoId: 'test-video-1',
    synced: true,
    instrumental: false,
    lines: [
      { timeSeconds: 5.0, text: 'Is this the real life?' },
      { timeSeconds: 10.0, text: 'Is this just fantasy?' },
      { timeSeconds: 15.0, text: '' }, // Musical break
      { timeSeconds: 20.0, text: 'Caught in a landslide' },
    ],
    plainText: null,
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onSeek = vi.fn();

    scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
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

  it('renders idle state when video is null or undefined', async () => {
    await act(async () => {
      root!.render(<LyricsView video={null} currentTime={0} isPlaying={false} onSeek={onSeek} />);
    });

    expect(container?.textContent).toContain('Play a song to see lyrics');
  });

  it('renders loading state while fetchTrackLyrics is in-flight', async () => {
    let resolveLyrics: (val: TrackLyrics | null) => void;
    const pendingPromise = new Promise<TrackLyrics | null>((resolve) => {
      resolveLyrics = resolve;
    });

    vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockReturnValue(pendingPromise);

    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
    });

    expect(container?.textContent).toContain('Loading lyrics...');
    expect(container?.textContent).toContain('Bohemian Rhapsody');

    // Clean up pending promise
    await act(async () => {
      resolveLyrics!(sampleLyrics);
    });
  });

  it('renders instrumental state when track is instrumental', async () => {
    const instrumentalLyrics: TrackLyrics = {
      videoId: 'test-inst',
      synced: false,
      instrumental: true,
      lines: [],
      plainText: null,
    };
    vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(instrumentalLyrics);

    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
    });

    expect(container?.textContent).toContain('Instrumental Track');
    expect(container?.textContent).toContain('No lyrics available — enjoy the music!');
  });

  it('renders plain text fallback when synced lyrics are unavailable', async () => {
    const plainLyrics: TrackLyrics = {
      videoId: 'test-plain',
      synced: false,
      instrumental: false,
      lines: [],
      plainText: 'Line one of poem\nLine two of poem',
    };
    vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(plainLyrics);

    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
    });

    expect(container?.textContent).toContain('Unsynced Lyrics');
    expect(container?.textContent).toContain('Line one of poem');
    expect(container?.textContent).toContain('Line two of poem');
  });

  it('renders missing lyrics state with retry button when no lyrics found', async () => {
    vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(null);

    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
    });

    expect(container?.textContent).toContain('No lyrics found');
    const retryBtn = container?.querySelector('button');
    expect(retryBtn).not.null;
    expect(retryBtn?.textContent).toContain('Retry Search');
  });

  it('renders synced lines with active line highlight and musical pauses', async () => {
    vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(sampleLyrics);

    // Render at currentTime = 6.0s (Line 0 active: "Is this the real life?")
    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={6.0} isPlaying={true} onSeek={onSeek} />);
    });

    const buttons = container?.querySelectorAll('.lyric-line-btn');
    expect(buttons?.length).toBe(4);

    // Line 0 is active
    expect(buttons?.[0].classList.contains('active')).toBe(true);
    expect(buttons?.[0].textContent).toContain('Is this the real life?');

    // Line 1 is inactive
    expect(buttons?.[1].classList.contains('active')).toBe(false);
    expect(buttons?.[1].textContent).toContain('Is this just fantasy?');

    // Line 2 is musical pause
    expect(buttons?.[2].textContent).toContain('♪ ♪ ♪');

    // Update currentTime to 16.0s (Line 2 active: musical pause)
    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={16.0} isPlaying={true} onSeek={onSeek} />);
    });

    const updatedButtons = container?.querySelectorAll('.lyric-line-btn');
    expect(updatedButtons?.[0].classList.contains('active')).toBe(false);
    expect(updatedButtons?.[2].classList.contains('active')).toBe(true);
    expect(updatedButtons?.[2].querySelector('.lyric-pause-notes')).not.null;
  });

  it('triggers onSeek when a lyric line is tapped', async () => {
    vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(sampleLyrics);

    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={0} isPlaying={true} onSeek={onSeek} />);
    });

    const buttons = container?.querySelectorAll('.lyric-line-btn');
    // Click line 3 (Caught in a landslide, timestamp 20.0s)
    await act(async () => {
      buttons?.[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSeek).toHaveBeenCalledWith(20.0);
  });

  it('performs smooth centered auto-scroll on activeIndex change and respects anti-jitter', async () => {
    vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(sampleLyrics);

    // First render at 6s -> line 0 active
    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={6.0} isPlaying={true} onSeek={onSeek} />);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

    // Progress tick within same line (6.2s -> line 0 still active)
    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={6.2} isPlaying={true} onSeek={onSeek} />);
    });

    // Anti-jitter: should NOT call scrollIntoView again!
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    // Progress tick crossing to line 1 (11.0s -> line 1 active)
    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={11.0} isPlaying={true} onSeek={onSeek} />);
    });

    // Now it should have called scrollIntoView a second time!
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });

  it('suspends auto-scroll on manual interaction and resumes on tapping Resume Sync', async () => {
    vi.spyOn(lyricsLib, 'fetchTrackLyrics').mockResolvedValue(sampleLyrics);

    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={6.0} isPlaying={true} onSeek={onSeek} />);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    const scrollArea = container?.querySelector('.lyrics-scroll-area');
    expect(scrollArea).not.null;

    // Simulate user scroll/wheel interaction
    await act(async () => {
      scrollArea?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    });

    // Floating "Resume Sync" button appears
    const resumeBtn = container?.querySelector('.lyrics-resume-sync-btn');
    expect(resumeBtn).not.null;
    expect(resumeBtn?.textContent).toContain('Resume Sync');

    // While interacting, advancing time does NOT trigger scrollIntoView
    await act(async () => {
      root!.render(<LyricsView video={sampleVideo} currentTime={11.0} isPlaying={true} onSeek={onSeek} />);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1); // Still 1!

    // Tap "Resume Sync" button
    await act(async () => {
      container?.querySelector('.lyrics-resume-sync-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Resume sync re-centers immediately
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    // Button disappears
    expect(container?.querySelector('.lyrics-resume-sync-btn')).toBeNull();
  });
});
