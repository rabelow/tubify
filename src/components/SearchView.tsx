/**
 * Tubify SearchView Component
 * 
 * Features:
 * 1. Debounced search input querying /api/search via CompanionClient
 * 2. Clear input button
 * 3. Direct YouTube URL & 11-char Video ID paste detection with parseYouTubeInput
 * 4. Rich search results list with artwork, title, artist, album, duration
 * 5. One-tap "Play on PC" and "+ Add to Playlist" actions
 * 6. Responsive loading spinner, empty states, and error banner with retry
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SearchTrack } from '../types/companion';
import { parseYouTubeInput, ParsedYouTubeInput } from '../lib/url-parser';
import { CompanionClient } from '../lib/companion-client';
import { TrackActionSheet } from './TrackActionSheet';

export interface SearchViewProps {
  client: CompanionClient;
  onPlayTrack: (track: SearchTrack) => void | Promise<void>;
  onPlayDirectVideo?: (videoId: string | null, playlistId?: string | null) => void | Promise<void>;
  onAddToPlaylist: (track: SearchTrack) => void;
  onPlayNext?: (track: SearchTrack) => void | Promise<void>;
  onPlayLast?: (track: SearchTrack) => void | Promise<void>;
}

export const SearchView: React.FC<SearchViewProps> = ({
  client,
  onPlayTrack,
  onPlayDirectVideo,
  onAddToPlaylist,
  onPlayNext,
  onPlayLast,
}) => {
  const [query, setQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [results, setResults] = useState<SearchTrack[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [directInput, setDirectInput] = useState<ParsedYouTubeInput | null>(null);
  const [actionTrack, setActionTrack] = useState<SearchTrack | null>(null);
  const [queueToast, setQueueToast] = useState<string | null>(null);
  const searchIdRef = useRef<number>(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setQueueToast(msg);
    setTimeout(() => {
      setQueueToast((prev) => (prev === msg ? null : prev));
    }, 2200);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const startLongPress = useCallback(
    (track: SearchTrack) => {
      didLongPressRef.current = false;
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        didLongPressRef.current = true;
        setActionTrack(track);
      }, 420);
    },
    [clearLongPress]
  );

  // Debounce query input by 350ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  // Check for direct YouTube URL / ID paste
  useEffect(() => {
    if (!query.trim()) {
      setDirectInput(null);
      return;
    }

    const parsed = parseYouTubeInput(query);
    if (parsed.videoId || parsed.playlistId) {
      setDirectInput(parsed);
    } else {
      setDirectInput(null);
    }
  }, [query]);

  // Execute search when debounced query changes
  const executeSearch = useCallback(
    async (searchTerm: string) => {
      if (!searchTerm) {
        searchIdRef.current++;
        setResults([]);
        setError(null);
        setIsLoading(false);
        return;
      }

      const currentId = ++searchIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const response = await client.searchSongs(searchTerm);
        if (currentId !== searchIdRef.current) return;
        setResults(response.results ?? []);
      } catch (err: any) {
        if (currentId !== searchIdRef.current) return;
        console.error('[tubify:search-view] Search error:', err);
        setError(err?.message ?? 'Failed to search YouTube Music. Please try again.');
        setResults([]);
      } finally {
        if (currentId === searchIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [client]
  );

  useEffect(() => {
    // Only search if not purely a bare video/playlist ID
    if (debouncedQuery) {
      executeSearch(debouncedQuery);
    } else {
      searchIdRef.current++;
      setResults([]);
      setError(null);
      setIsLoading(false);
    }
  }, [debouncedQuery, executeSearch]);

  const handleClear = () => {
    searchIdRef.current++;
    setQuery('');
    setDebouncedQuery('');
    setResults([]);
    setError(null);
    setDirectInput(null);
  };

  const handlePlayDirect = () => {
    if (!directInput) return;
    if (onPlayDirectVideo) {
      onPlayDirectVideo(directInput.videoId, directInput.playlistId);
    } else if (directInput.videoId) {
      onPlayTrack({
        videoId: directInput.videoId,
        title: `YouTube Video (${directInput.videoId})`,
        artist: 'YouTube',
      });
    }
  };

  const handleAddDirectToPlaylist = () => {
    if (!directInput?.videoId) return;
    onAddToPlaylist({
      videoId: directInput.videoId,
      title: `YouTube Video (${directInput.videoId})`,
      artist: 'YouTube',
    });
  };

  return (
    <div className="tab-view search-view" style={{ paddingBottom: 'calc(var(--bottom-nav-height) + 32px)' }}>
      {/* Sticky Search Header */}
      <div className="search-bar-container">
        <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
          <input
            type="text"
            className="search-input"
            placeholder="Search songs, artists, or paste YouTube link..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search YouTube Music"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search input"
              style={{
                position: 'absolute',
                right: 12,
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Direct Link Detected Card */}
      {directInput && (directInput.videoId || directInput.playlistId) && (
        <div
          className="direct-link-card"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--accent-spotify)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>🔗</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--accent-spotify)' }}>
                Direct YouTube Link Detected
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {directInput.videoId && <span>Video ID: <code>{directInput.videoId}</code> </span>}
                {directInput.playlistId && <span>Playlist ID: <code>{directInput.playlistId}</code></span>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={handlePlayDirect}
              style={{ flex: 1, height: 38, minWidth: 140 }}
            >
              ▶ Play Now on PC
            </button>
            {directInput.videoId && onPlayNext && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onPlayNext({
                    videoId: directInput.videoId!,
                    title: `YouTube Video (${directInput.videoId})`,
                    artist: 'YouTube',
                  });
                  showToast('Added to Play Next');
                }}
                style={{ height: 38, padding: '0 12px' }}
              >
                ⏭ Play Next
              </button>
            )}
            {directInput.videoId && onPlayLast && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onPlayLast({
                    videoId: directInput.videoId!,
                    title: `YouTube Video (${directInput.videoId})`,
                    artist: 'YouTube',
                  });
                  showToast('Added to End of Queue');
                }}
                style={{ height: 38, padding: '0 12px' }}
              >
                ⤵ Play Last
              </button>
            )}
            {directInput.videoId && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleAddDirectToPlaylist}
                style={{ height: 38, padding: '0 14px' }}
              >
                + Add to Playlist
              </button>
            )}
          </div>
        </div>
      )}

      {/* Queue Feedback Toast */}
      {queueToast && (
        <div
          className="banner-info"
          role="status"
          style={{
            marginBottom: 12,
            background: 'rgba(245, 158, 11, 0.16)',
            borderColor: 'rgba(245, 158, 11, 0.45)',
            color: '#fde68a',
            fontWeight: 600,
          }}
        >
          ✨ {queueToast}
        </div>
      )}

      {/* Error Banner with Retry */}
      {error && (
        <div
          className="banner-error"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => executeSearch(debouncedQuery)}
            style={{ height: 30, fontSize: '0.75rem', padding: '0 10px', marginLeft: 12 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton / Spinner */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)' }}>
          <div
            style={{
              display: 'inline-block',
              width: 32,
              height: 32,
              border: '3px solid var(--border-subtle)',
              borderTopColor: 'var(--accent-spotify)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              marginBottom: 12,
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ fontSize: '0.9rem' }}>Searching YouTube Music...</p>
        </div>
      )}

      {/* Search Results List */}
      {!isLoading && results.length > 0 && (
        <div className="search-results-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
              marginBottom: 4,
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            <span>Songs ({results.length})</span>
            <span style={{ fontWeight: 500, textTransform: 'none', fontSize: '0.75rem' }}>
              Hold song or tap ••• for Play Next / Last
            </span>
          </div>

          {results.map((track) => (
            <div
              key={track.videoId}
              className="track-row"
              data-testid={`search-row-${track.videoId}`}
              onPointerDown={() => startLongPress(track)}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              onPointerCancel={clearLongPress}
              onTouchEnd={(e) => {
                clearLongPress();
                if (didLongPressRef.current) {
                  e.preventDefault();
                  didLongPressRef.current = false;
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                clearLongPress();
                didLongPressRef.current = true;
                setActionTrack(track);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px' }}
            >
              {/* Artwork */}
              {track.thumbnailUrl ? (
                <img
                  src={track.thumbnailUrl}
                  alt={track.title}
                  className="track-thumb"
                  loading="lazy"
                  onError={(e) => {
                    // Fallback to placeholder if thumbnail fails
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="track-thumb-fallback">🎵</div>
              )}

              {/* Title & Metadata */}
              <div
                className="track-details"
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                onClick={() => setActionTrack(track)}
              >
                <div className="track-details-title" title={track.title}>
                  {track.title}
                </div>
                <div className="track-details-sub" title={`${track.artist}${track.album ? ` • ${track.album}` : ''}`}>
                  <span>{track.artist}</span>
                  {track.album && <span> • {track.album}</span>}
                  {track.duration && <span> • {track.duration}</span>}
                </div>
              </div>

              {/* Action Buttons */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onPlayTrack(track)}
                  aria-label={`Play ${track.title} on PC`}
                  title="Play on PC"
                  style={{
                    height: 32,
                    padding: '0 9px',
                    fontSize: '0.78rem',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  ▶ Play
                </button>

                {onPlayNext && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      onPlayNext(track);
                      showToast(`Playing "${track.title}" next`);
                    }}
                    aria-label={`Play ${track.title} next`}
                    title="Play Next"
                    data-testid={`search-play-next-${track.videoId}`}
                    style={{
                      height: 32,
                      padding: '0 8px',
                      fontSize: '0.75rem',
                      backgroundColor: 'var(--bg-surface)',
                    }}
                  >
                    ⏭ Next
                  </button>
                )}

                {onPlayLast && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      onPlayLast(track);
                      showToast(`Added "${track.title}" to end of queue`);
                    }}
                    aria-label={`Play ${track.title} last`}
                    title="Play Last"
                    data-testid={`search-play-last-${track.videoId}`}
                    style={{
                      height: 32,
                      padding: '0 8px',
                      fontSize: '0.75rem',
                      backgroundColor: 'var(--bg-surface)',
                    }}
                  >
                    ⤵ Last
                  </button>
                )}

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onAddToPlaylist(track)}
                  aria-label={`Add ${track.title} to playlist`}
                  title="Add to Playlist"
                  style={{
                    height: 32,
                    padding: '0 8px',
                    fontSize: '0.85rem',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  +
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setActionTrack(track)}
                  aria-label={`More actions for ${track.title}`}
                  title="Track options (Play Next, Play Last, Add to Playlist)"
                  data-testid={`search-more-${track.videoId}`}
                  style={{
                    height: 32,
                    padding: '0 7px',
                    fontSize: '0.85rem',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  •••
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Track Action Sheet (Click / Long-Press Menu) */}
      <TrackActionSheet
        track={actionTrack}
        onClose={() => setActionTrack(null)}
        onPlayNow={(t) => onPlayTrack(t)}
        onPlayNext={
          onPlayNext
            ? (t) => {
                onPlayNext(t);
                showToast(`Playing "${t.title}" next`);
              }
            : undefined
        }
        onPlayLast={
          onPlayLast
            ? (t) => {
                onPlayLast(t);
                showToast(`Added "${t.title}" to end of queue`);
              }
            : undefined
        }
        onAddToPlaylist={(t) => onAddToPlaylist(t)}
      />

      {/* Empty State: No results found */}
      {!isLoading && !error && debouncedQuery && results.length === 0 && !directInput && (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔍</div>
          <h3 style={{ fontSize: '1.1rem', marginBottom: 6, color: 'var(--text-primary)' }}>
            No songs found
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            No results for &ldquo;{debouncedQuery}&rdquo;. Try another title, artist, or YouTube URL.
          </p>
        </div>
      )}

      {/* Initial Idle State: No query entered */}
      {!isLoading && !error && !debouncedQuery && !directInput && (
        <div style={{ textAlign: 'center', padding: '60px 16px', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16, opacity: 0.8 }}>🎧</div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: 8, color: 'var(--text-primary)' }}>
            Search Songs on YouTube Music
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', maxWidth: 340, margin: '0 auto' }}>
            Find any song and play it instantly on your Windows desktop, or paste a link to play or save to your playlists.
          </p>
        </div>
      )}
    </div>
  );
};
