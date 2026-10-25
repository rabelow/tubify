/**
 * Tubify LyricsView Component (T024)
 * 
 * Features:
 * 1. Automatic fetching from LRCLIB with abort signal support and local caching
 * 2. Visual Karaoke Glow: active line illuminated with emerald/white styling; inactive lines at 42% opacity
 * 3. Empty lyric lines rendered as rhythmic musical pause indicators (♪ ♪ ♪)
 * 4. Anti-jitter centered smooth auto-scroll (only on activeIndex change, never on 200ms tick)
 * 5. Manual scroll interruption guard (suspends auto-scroll for 4s upon user interaction)
 * 6. Floating "Resume Sync" pill button to immediately snap back to active line
 * 7. Tap-to-seek remote control dispatch (onSeek)
 * 8. Comprehensive fallbacks: instrumental tracks, plain-text lyrics, missing lyrics, and idle state
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { VideoMetadata, LyricLine, TrackLyrics } from '../types/companion';
import { fetchTrackLyrics, getActiveLyricIndex } from '../lib/lyrics';

export interface LyricsViewProps {
  /** Active playing track metadata */
  video: VideoMetadata | null | undefined;
  /** Current interpolated playback progress in seconds */
  currentTime: number;
  /** Playback state (true = playing, false = paused) */
  isPlaying: boolean;
  /** Remote seek dispatch */
  onSeek: (seconds: number) => Promise<void> | void;
}

export function LyricsView({ video, currentTime, isPlaying, onSeek }: LyricsViewProps) {
  const [lyrics, setLyrics] = useState<TrackLyrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isUserInteracting, setIsUserInteracting] = useState<boolean>(false);

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  const prevActiveIndexRef = useRef<number>(-1);
  const interactionTimerRef = useRef<any>(null);

  // Compute the current active lyric line index via logarithmic binary search
  const lines = lyrics?.lines ?? [];
  const activeIndex = lyrics?.synced ? getActiveLyricIndex(lines, currentTime) : -1;
  const activeIndexRef = useRef<number>(activeIndex);
  activeIndexRef.current = activeIndex;

  // 1. Fetch lyrics whenever video changes
  useEffect(() => {
    // Reset user interaction state on song switch
    setIsUserInteracting(false);
    if (interactionTimerRef.current) {
      clearTimeout(interactionTimerRef.current);
      interactionTimerRef.current = null;
    }

    if (!video || !video.title) {
      setLyrics(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const abortController = new AbortController();
    setIsLoading(true);
    setError(null);
    prevActiveIndexRef.current = -1;

    fetchTrackLyrics(video, { signal: abortController.signal })
      .then((result) => {
        if (abortController.signal.aborted) return;
        setLyrics(result);
        setIsLoading(false);
      })
      .catch((err) => {
        if (abortController.signal.aborted || err?.name === 'AbortError') return;
        console.error('[tubify:lyrics] Error fetching track lyrics:', err);
        setError('Failed to fetch lyrics');
        setIsLoading(false);
      });

    return () => {
      abortController.abort();
    };
  }, [video?.id, video?.title]);

  // Clean up interaction timer on unmount
  useEffect(() => {
    return () => {
      if (interactionTimerRef.current) {
        clearTimeout(interactionTimerRef.current);
        interactionTimerRef.current = null;
      }
    };
  }, []);

  // 2. Smooth center-scroll to active line
  // CRITICAL ANTI-JITTER RULE: Only trigger when activeIndex actually changes!
  useEffect(() => {
    if (!lyrics?.synced || isLoading) {
      return;
    }

    if (activeIndex === prevActiveIndexRef.current) {
      return;
    }
    prevActiveIndexRef.current = activeIndex;

    // Do not auto-scroll if the user is currently scrolling / reading
    if (isUserInteracting) {
      return;
    }

    if (activeIndex >= 0 && activeLineRef.current) {
      activeLineRef.current.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex, isUserInteracting, lyrics, isLoading]);

  // 3. User interaction listener (touch, wheel, pointer)
  const handleUserInteraction = useCallback(() => {
    setIsUserInteracting(true);

    if (interactionTimerRef.current) {
      clearTimeout(interactionTimerRef.current);
    }

    interactionTimerRef.current = setTimeout(() => {
      setIsUserInteracting(false);
      // Re-center on active line once interaction timeout expires
      if (activeIndexRef.current >= 0 && activeLineRef.current) {
        activeLineRef.current.scrollIntoView?.({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }, 4000);
  }, []);

  // 4. Resume sync button handler
  const handleResumeSync = () => {
    if (interactionTimerRef.current) {
      clearTimeout(interactionTimerRef.current);
      interactionTimerRef.current = null;
    }
    setIsUserInteracting(false);
    if (activeIndex >= 0 && activeLineRef.current) {
      activeLineRef.current.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
      });
    }
  };

  // 5. Tap-to-seek handler
  const handleLineClick = (line: LyricLine) => {
    onSeek(line.timeSeconds);
  };

  // Retry fetch
  const handleRetry = () => {
    if (!video) return;
    setIsLoading(true);
    setError(null);
    fetchTrackLyrics(video)
      .then((result) => {
        setLyrics(result);
        setIsLoading(false);
      })
      .catch(() => {
        setError('Failed to fetch lyrics');
        setIsLoading(false);
      });
  };

  // State 1: No active song loaded
  if (!video) {
    return (
      <div className="lyrics-view-container">
        <div className="lyrics-state-card">
          <div className="lyrics-state-icon">🎤</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Play a song to see lyrics</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 320 }}>
            Time-synced karaoke lyrics will appear here automatically when music is playing on Windows.
          </p>
        </div>
      </div>
    );
  }

  // State 2: Loading lyrics
  if (isLoading) {
    return (
      <div className="lyrics-view-container">
        <div className="lyrics-state-card">
          <div className="status-dot" style={{ width: 14, height: 14, backgroundColor: 'var(--accent-spotify)', animation: 'pulse-dot 1s infinite' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Loading lyrics...</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Fetching from LRCLIB for <strong>{video.title}</strong>
          </p>
        </div>
      </div>
    );
  }

  // State 3: Instrumental Track
  if (lyrics?.instrumental) {
    return (
      <div className="lyrics-view-container">
        <div className="lyrics-state-card">
          <div className="lyrics-state-icon">🎷</div>
          <span className="lyrics-badge">Instrumental Track</span>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{video.title}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {video.author}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 12 }}>
            No lyrics available — enjoy the music!
          </p>
        </div>
      </div>
    );
  }

  // State 4: Unsynced Plain Text Lyrics Fallback
  if (lyrics && !lyrics.synced && lyrics.plainText) {
    return (
      <div className="lyrics-view-container">
        <div style={{ textAlign: 'center', paddingTop: 20 }}>
          <span className="lyrics-badge">Unsynced Lyrics</span>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{video.title}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 12 }}>
            {video.author}
          </p>
        </div>
        <div className="lyrics-plain-view">
          {lyrics.plainText}
        </div>
      </div>
    );
  }

  // State 5: Missing Lyrics or Error
  if (!lyrics || (!lyrics.synced && !lyrics.plainText)) {
    return (
      <div className="lyrics-view-container">
        <div className="lyrics-state-card">
          <div className="lyrics-state-icon">📝</div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>No lyrics found</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 340 }}>
            {error || `We couldn't find time-synced lyrics for "${video.title}" by ${video.author}.`}
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRetry}
            style={{ marginTop: 12, padding: '8px 20px', borderRadius: 9999 }}
          >
            🔄 Retry Search
          </button>
        </div>
      </div>
    );
  }

  // State 6: Time-Synced Karaoke Lyrics
  return (
    <div className="lyrics-view-container">
      {/* Scrollable Lyric Lines List */}
      <div
        className="lyrics-scroll-area"
        ref={scrollAreaRef}
        onWheel={handleUserInteraction}
        onTouchMove={handleUserInteraction}
        onPointerDown={handleUserInteraction}
        role="region"
        aria-label="Synchronized lyrics"
      >
        {lines.map((line, idx) => {
          const isActive = idx === activeIndex;
          const isPause = line.text === '';

          return (
            <button
              key={`${line.timeSeconds}-${idx}`}
              ref={isActive ? activeLineRef : null}
              type="button"
              className={`lyric-line-btn ${isActive ? 'active' : ''}`}
              onClick={() => handleLineClick(line)}
              title={`Jump to ${Math.floor(line.timeSeconds / 60)}:${String(Math.floor(line.timeSeconds % 60)).padStart(2, '0')}`}
              aria-current={isActive ? 'true' : undefined}
            >
              {isPause ? (
                <span className="lyric-pause-notes" aria-label="Musical break">
                  ♪ ♪ ♪
                </span>
              ) : (
                line.text
              )}
            </button>
          );
        })}
      </div>

      {/* Floating "Resume Sync" Pill Button */}
      {isUserInteracting && activeIndex >= 0 && (
        <button
          type="button"
          className="lyrics-resume-sync-btn"
          onClick={handleResumeSync}
          aria-label="Resume auto-scroll sync"
        >
          <span>🎯</span>
          <span>Resume Sync</span>
        </button>
      )}
    </div>
  );
}
