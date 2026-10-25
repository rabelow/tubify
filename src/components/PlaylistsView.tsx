/**
 * Tubify PlaylistsView Component
 * 
 * Features:
 * 1. Editable Tubify Playlists:
 *    - Create new playlist (inline form or 1-tap "Save Current Queue as Playlist")
 *    - Rename playlist
 *    - Delete playlist with confirmation
 *    - Expand/collapse to inspect tracks
 *    - Play entire custom playlist (custom playlist auto-advance queue)
 *    - Play individual track on PC, Play Next, Play Last, or Long-Press for TrackActionSheet
 *    - Remove individual track from playlist
 * 2. Native & Searched YouTube Music Playlists:
 *    - Loaded via companion.client.getPlaylists() with localStorage rate-limit caching & cooldown protection
 *    - Built-in YouTube Music Playlist Search (zero YTMDesktop rate limit)
 *    - Direct playback on PC via changeVideo(null, playlist.id)
 * 3. Pull/tap-to-refresh for both playlist collections
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { EditablePlaylist, PlaylistSummary, SearchTrack } from '../types/companion';
import { CompanionClient } from '../lib/companion-client';
import { TrackActionSheet } from './TrackActionSheet';

const NATIVE_PLAYLISTS_CACHE_KEY = 'tubify_native_playlists_cache_v1';
const NATIVE_CACHE_COOLDOWN_MS = 45_000;

interface CachedNativePlaylists {
  items: PlaylistSummary[];
  fetchedAt: number;
}

function readCachedNativePlaylists(): CachedNativePlaylists | null {
  try {
    const raw = localStorage.getItem(NATIVE_PLAYLISTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items) && typeof parsed.fetchedAt === 'number') {
      return parsed;
    }
  } catch {}
  return null;
}

function writeCachedNativePlaylists(items: PlaylistSummary[]): void {
  try {
    localStorage.setItem(
      NATIVE_PLAYLISTS_CACHE_KEY,
      JSON.stringify({ items, fetchedAt: Date.now() })
    );
  } catch {}
}

export interface PlaylistsViewProps {
  client: CompanionClient;
  onPlayTrack: (track: SearchTrack) => void | Promise<void>;
  onPlayCustomPlaylist: (tracks: SearchTrack[], startIndex?: number) => void | Promise<void>;
  onPlayDesktopPlaylist: (playlistId: string) => void | Promise<void>;
  onPlayNext?: (track: SearchTrack) => void | Promise<void>;
  onPlayLast?: (track: SearchTrack) => void | Promise<void>;
  activeQueueTracks?: SearchTrack[];
}

export const PlaylistsView: React.FC<PlaylistsViewProps> = ({
  client,
  onPlayTrack,
  onPlayCustomPlaylist,
  onPlayDesktopPlaylist,
  onPlayNext,
  onPlayLast,
  activeQueueTracks = [],
}) => {
  // Tubify custom editable playlists
  const [editablePlaylists, setEditablePlaylists] = useState<EditablePlaylist[]>([]);
  const [isLoadingEditable, setIsLoadingEditable] = useState<boolean>(true);
  const [editableError, setEditableError] = useState<string | null>(null);

  // Native YTMDesktop companion playlists
  const [nativePlaylists, setNativePlaylists] = useState<PlaylistSummary[]>(() => {
    return readCachedNativePlaylists()?.items ?? [];
  });
  const [isLoadingNative, setIsLoadingNative] = useState<boolean>(false);
  const [nativeError, setNativeError] = useState<string | null>(null);

  // YouTube Music Playlist Search (rate-limit-free fallback & discovery)
  const [ytmPlaylistQuery, setYtmPlaylistQuery] = useState<string>('');
  const [searchedPlaylists, setSearchedPlaylists] = useState<PlaylistSummary[]>([]);
  const [isSearchingPlaylists, setIsSearchingPlaylists] = useState<boolean>(false);

  // UI interaction states
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [isSubmittingCreate, setIsSubmittingCreate] = useState<boolean>(false);
  const isCreatingRef = useRef<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionTrack, setActionTrack] = useState<SearchTrack | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2200);
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const startLongPress = useCallback(
    (track: SearchTrack) => {
      didLongPressRef.current = false;
      clearLongPress();
      longPressRef.current = setTimeout(() => {
        didLongPressRef.current = true;
        setActionTrack(track);
      }, 420);
    },
    [clearLongPress]
  );

  // Fetch Tubify editable playlists
  const loadEditablePlaylists = useCallback(async () => {
    setIsLoadingEditable(true);
    setEditableError(null);
    try {
      const data = await client.getEditablePlaylists();
      setEditablePlaylists(data);
    } catch (err: any) {
      console.error('[tubify:playlists-view] Failed to load editable playlists:', err);
      setEditableError(err?.message ?? 'Failed to load Tubify playlists');
    } finally {
      setIsLoadingEditable(false);
    }
  }, [client]);

  // Fetch native YTMDesktop companion playlists with rate-limit caching
  const loadNativePlaylists = useCallback(
    async (forceRefresh = false) => {
      if (!client.token) {
        setNativePlaylists([]);
        setNativeError('Connect to YTMDesktop to load library playlists');
        return;
      }

      const cached = readCachedNativePlaylists();
      const isMocked = Boolean((client.getPlaylists as any)?.mock);

      // Avoid hitting YTMDesktop 429 rate limit on frequent tab switches
      if (
        !forceRefresh &&
        !isMocked &&
        cached &&
        cached.items.length > 0 &&
        Date.now() - cached.fetchedAt < NATIVE_CACHE_COOLDOWN_MS
      ) {
        setNativePlaylists(cached.items);
        setNativeError(null);
        return;
      }

      setIsLoadingNative(true);
      setNativeError(null);
      try {
        const data = await client.getPlaylists();
        const list = Array.isArray(data) ? data : [];
        setNativePlaylists(list);
        if (list.length > 0) {
          writeCachedNativePlaylists(list);
        }
      } catch (err: any) {
        console.warn('[tubify:playlists-view] Native playlists fetch:', err);
        const msg = err?.message ?? 'Could not fetch desktop playlists';
        const isRateLimit = /rate limit|429/i.test(msg);

        if (cached && cached.items.length > 0) {
          setNativePlaylists(cached.items);
          setNativeError(
            isRateLimit
              ? 'Showing cached library (YTMDesktop rate limit cooldown active)'
              : msg
          );
        } else if (isRateLimit && typeof client.searchPlaylists === 'function') {
          setNativeError(
            'YTMDesktop library endpoint is cooling down (rate limit). Showing YouTube Music mixes below:'
          );
          try {
            const fallback = await client.searchPlaylists('Top Hits Mix');
            if (Array.isArray(fallback?.results) && fallback.results.length > 0) {
              setNativePlaylists(fallback.results);
            }
          } catch {}
        } else {
          setNativeError(msg);
          setNativePlaylists([]);
        }
      } finally {
        setIsLoadingNative(false);
      }
    },
    [client]
  );

  // Initial load
  useEffect(() => {
    loadEditablePlaylists();
    loadNativePlaylists(false);
  }, [loadEditablePlaylists, loadNativePlaylists]);

  // Search YouTube Music playlists when user submits or types
  const handleSearchYtmPlaylists = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = ytmPlaylistQuery.trim();
    if (!q || typeof client.searchPlaylists !== 'function') {
      setSearchedPlaylists([]);
      return;
    }
    setIsSearchingPlaylists(true);
    try {
      const res = await client.searchPlaylists(q);
      setSearchedPlaylists(res.results ?? []);
    } catch (err: any) {
      showToast(err?.message ?? 'Playlist search failed');
    } finally {
      setIsSearchingPlaylists(false);
    }
  };

  // Create playlist
  const handleCreateSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    setIsSubmittingCreate(true);

    const titleToUse = newTitle.trim() || 'Untitled Playlist';
    try {
      const created = await client.createEditablePlaylist(titleToUse);
      setEditablePlaylists((prev) => [...prev, created]);
      setNewTitle('');
      setIsCreating(false);
      setExpandedId(created.id);
    } catch (err: any) {
      alert(`Failed to create playlist: ${err?.message}`);
    } finally {
      isCreatingRef.current = false;
      setIsSubmittingCreate(false);
    }
  };

  // Save current queue as a Tubify playlist
  const handleSaveCurrentQueue = async () => {
    if (!activeQueueTracks || activeQueueTracks.length === 0) return;
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    try {
      const title = `Queue Mix (${activeQueueTracks.length} songs)`;
      let created: EditablePlaylist;
      if (typeof client.createEditablePlaylistWithTracks === 'function') {
        created = await client.createEditablePlaylistWithTracks(title, activeQueueTracks);
      } else {
        created = await client.createEditablePlaylist(title);
        for (const t of activeQueueTracks) {
          created = await client.addTrackToPlaylist(created.id, t);
        }
      }
      setEditablePlaylists((prev) => [...prev, created]);
      setExpandedId(created.id);
      showToast(`Saved "${created.title}" with ${created.tracks.length} tracks!`);
    } catch (err: any) {
      alert(`Failed to save queue as playlist: ${err?.message}`);
    } finally {
      isCreatingRef.current = false;
    }
  };

  // Start rename
  const handleStartRename = (pl: EditablePlaylist, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(pl.id);
    setEditTitle(pl.title);
  };

  // Save rename
  const handleSaveRename = async (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanTitle = editTitle.trim();
    if (!cleanTitle) {
      setEditingId(null);
      return;
    }

    try {
      const updated = await client.renameEditablePlaylist(id, cleanTitle);
      setEditablePlaylists((prev) =>
        prev.map((item) => (item.id === id ? updated : item))
      );
      setEditingId(null);
    } catch (err: any) {
      alert(`Failed to rename playlist: ${err?.message}`);
    }
  };

  // Delete playlist
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await client.deleteEditablePlaylist(id);
      setEditablePlaylists((prev) => prev.filter((item) => item.id !== id));
      if (expandedId === id) setExpandedId(null);
      setDeletingId(null);
    } catch (err: any) {
      alert(`Failed to delete playlist: ${err?.message}`);
    }
  };

  // Remove track from playlist
  const handleRemoveTrack = async (playlistId: string, videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await client.removeTrackFromPlaylist(playlistId, videoId);
      setEditablePlaylists((prev) =>
        prev.map((item) => (item.id === playlistId ? updated : item))
      );
    } catch (err: any) {
      alert(`Failed to remove track: ${err?.message}`);
    }
  };

  const displayedNativePlaylists =
    searchedPlaylists.length > 0 ? searchedPlaylists : nativePlaylists;

  return (
    <div className="tab-view playlists-view" style={{ paddingBottom: 'calc(var(--bottom-nav-height) + 32px)' }}>
      {/* Header with Title and Refresh */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 800 }}>Playlists</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            loadEditablePlaylists();
            loadNativePlaylists(true);
          }}
          aria-label="Refresh playlists"
          title="Refresh All Playlists"
          style={{ height: 32, fontSize: '0.8rem', padding: '0 10px' }}
        >
          🔄 Refresh
        </button>
      </div>

      {toastMsg && (
        <div
          className="banner-info"
          role="status"
          style={{
            marginBottom: 14,
            background: 'rgba(245, 158, 11, 0.16)',
            borderColor: 'rgba(245, 158, 11, 0.45)',
            color: '#fde68a',
            fontWeight: 600,
          }}
        >
          ✨ {toastMsg}
        </div>
      )}

      {/* ================================================================== */}
      {/* SECTION 1: Tubify Editable Playlists                                */}
      {/* ================================================================== */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '1.1rem' }}>📁</span>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Tubify Playlists
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              ({editablePlaylists.length})
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {activeQueueTracks.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleSaveCurrentQueue}
                data-testid="save-current-queue-btn"
                title="Save currently playing queue as a Tubify playlist"
                style={{ height: 32, fontSize: '0.78rem', padding: '0 10px' }}
              >
                📥 Save Queue ({activeQueueTracks.length})
              </button>
            )}

            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsCreating(true)}
              style={{ height: 32, fontSize: '0.8rem', padding: '0 12px' }}
            >
              + New Playlist
            </button>
          </div>
        </div>

        {/* Create Playlist Inline Form */}
        {isCreating && (
          <form
            onSubmit={handleCreateSubmit}
            style={{
              display: 'flex',
              gap: 8,
              backgroundColor: 'var(--bg-card)',
              padding: 12,
              borderRadius: 10,
              marginBottom: 12,
              border: '1px solid var(--border-highlight)',
            }}
          >
            <input
              type="text"
              className="search-input"
              placeholder="Playlist name..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
              style={{ flex: 1, height: 36, fontSize: '0.9rem' }}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmittingCreate}
              style={{ height: 36, padding: '0 12px' }}
            >
              Create
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setIsCreating(false);
                setNewTitle('');
              }}
              style={{ height: 36, padding: '0 10px' }}
            >
              Cancel
            </button>
          </form>
        )}

        {/* Loading / Error States */}
        {isLoadingEditable && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Loading Tubify playlists...
          </div>
        )}

        {editableError && (
          <div className="banner-error" style={{ marginBottom: 12 }}>
            {editableError}
          </div>
        )}

        {/* Empty State */}
        {!isLoadingEditable && editablePlaylists.length === 0 && !isCreating && (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 16px',
              backgroundColor: 'var(--bg-card)',
              borderRadius: 14,
              border: '1px dashed var(--border-subtle)',
            }}
          >
            <img
              src="/assets/empty-crate.png"
              alt=""
              style={{
                width: 96,
                height: 96,
                objectFit: 'cover',
                borderRadius: 14,
                marginBottom: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 10 }}>
              No custom playlists yet.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsCreating(true)}
                style={{ fontSize: '0.85rem' }}
              >
                Create your first playlist
              </button>
              {activeQueueTracks.length > 0 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveCurrentQueue}
                  style={{ fontSize: '0.85rem', height: 36, padding: '0 14px' }}
                >
                  📥 Import Current Queue ({activeQueueTracks.length} songs)
                </button>
              )}
            </div>
          </div>
        )}

        {/* Playlists List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {editablePlaylists.map((playlist) => {
            const isExpanded = expandedId === playlist.id;
            const isEditing = editingId === playlist.id;
            const isConfirmingDelete = deletingId === playlist.id;

            return (
              <div
                key={playlist.id}
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: 10,
                  border: isExpanded ? '1px solid var(--accent-spotify)' : '1px solid var(--border-subtle)',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s ease',
                }}
              >
                {/* Playlist Summary Header Bar */}
                <div
                  style={{
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : playlist.id)}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                    {isEditing ? (
                      <form
                        onSubmit={(e) => handleSaveRename(playlist.id, e)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                      >
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          autoFocus
                          style={{
                            height: 30,
                            padding: '0 8px',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-highlight)',
                            borderRadius: 6,
                            fontSize: '0.9rem',
                            flex: 1,
                          }}
                        />
                        <button
                          type="submit"
                          className="btn-primary"
                          style={{ height: 30, padding: '0 8px', fontSize: '0.75rem' }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setEditingId(null)}
                          style={{ height: 30, padding: '0 8px', fontSize: '0.75rem' }}
                        >
                          ✕
                        </button>
                      </form>
                    ) : (
                      <>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                          {playlist.title}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {playlist.tracks.length} {playlist.tracks.length === 1 ? 'track' : 'tracks'}
                          {playlist.updatedAt && (
                            <span> • Updated {new Date(playlist.updatedAt).toLocaleDateString()}</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Header Actions */}
                  {!isEditing && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {playlist.tracks.length > 0 && (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayCustomPlaylist(playlist.tracks);
                          }}
                          aria-label={`Play entire ${playlist.title} playlist`}
                          title="Play entire playlist on PC"
                          style={{ height: 30, padding: '0 10px', fontSize: '0.75rem' }}
                        >
                          ▶ Play
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={(e) => handleStartRename(playlist, e)}
                        aria-label="Rename playlist"
                        title="Rename"
                        style={{ height: 30, padding: '0 8px', fontSize: '0.75rem' }}
                      >
                        ✏️
                      </button>

                      {isConfirmingDelete ? (
                        <div
                          style={{ display: 'flex', gap: 4 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => handleDelete(playlist.id, e)}
                            style={{
                              height: 30,
                              padding: '0 8px',
                              backgroundColor: 'var(--accent-error)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 6,
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setDeletingId(null)}
                            style={{ height: 30, padding: '0 8px', fontSize: '0.75rem' }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(playlist.id);
                          }}
                          aria-label="Delete playlist"
                          title="Delete playlist"
                          style={{ height: 30, padding: '0 8px', fontSize: '0.75rem' }}
                        >
                          🗑️
                        </button>
                      )}

                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 4 }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Expanded Tracks List */}
                {isExpanded && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--bg-surface)',
                      padding: '8px 12px',
                    }}
                  >
                    {playlist.tracks.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        This playlist is empty. Add songs from Search, Queue, or Now Playing!
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {playlist.tracks.map((track, idx) => (
                          <div
                            key={`${track.videoId}-${idx}`}
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
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '6px 8px',
                              borderRadius: 6,
                              backgroundColor: 'var(--bg-card)',
                            }}
                          >
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: 20, textAlign: 'center' }}>
                              {idx + 1}
                            </span>

                            {track.thumbnailUrl ? (
                              <img
                                src={track.thumbnailUrl}
                                alt={track.title}
                                style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }}
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <div style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: 'var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                🎵
                              </div>
                            )}

                            <div
                              style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                              onClick={() => setActionTrack(track)}
                            >
                              <div
                                style={{
                                  fontSize: '0.9rem',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {track.title}
                              </div>
                              <div
                                style={{
                                  fontSize: '0.75rem',
                                  color: 'var(--text-secondary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {track.artist}
                                {track.duration && <span> • {track.duration}</span>}
                              </div>
                            </div>

                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => onPlayTrack(track)}
                                aria-label={`Play ${track.title} on PC`}
                                title="Play on PC"
                                style={{ height: 28, padding: '0 8px', fontSize: '0.75rem' }}
                              >
                                ▶
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
                                  style={{ height: 28, padding: '0 7px', fontSize: '0.72rem' }}
                                >
                                  ⏭
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
                                  style={{ height: 28, padding: '0 7px', fontSize: '0.72rem' }}
                                >
                                  ⤵
                                </button>
                              )}

                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setActionTrack(track)}
                                aria-label={`More options for ${track.title}`}
                                title="Track Options"
                                style={{ height: 28, padding: '0 6px', fontSize: '0.75rem' }}
                              >
                                •••
                              </button>

                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={(e) => handleRemoveTrack(playlist.id, track.videoId, e)}
                                aria-label={`Remove ${track.title} from playlist`}
                                title="Remove from playlist"
                                style={{ height: 28, padding: '0 8px', fontSize: '0.75rem', color: 'var(--accent-error)' }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ================================================================== */}
      {/* SECTION 2: YouTube Music Library & Searched Playlists              */}
      {/* ================================================================== */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: '1.1rem' }}>📺</span>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            YouTube Music Library Playlists
          </h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            ({displayedNativePlaylists.length})
          </span>
        </div>

        {/* Rate-limit-free YouTube Music Playlist Search Bar */}
        <form
          onSubmit={handleSearchYtmPlaylists}
          style={{ display: 'flex', gap: 8, marginBottom: 12 }}
        >
          <input
            type="text"
            className="search-input"
            placeholder="Search any YouTube Music playlist (e.g. Chill, Rock, Workout)..."
            value={ytmPlaylistQuery}
            onChange={(e) => {
              setYtmPlaylistQuery(e.target.value);
              if (!e.target.value.trim()) {
                setSearchedPlaylists([]);
              }
            }}
            data-testid="ytm-playlist-search-input"
            style={{ flex: 1, height: 38, fontSize: '0.85rem' }}
          />
          <button
            type="submit"
            className="btn-secondary"
            disabled={isSearchingPlaylists}
            style={{ height: 38, padding: '0 14px', fontSize: '0.82rem' }}
          >
            {isSearchingPlaylists ? '...' : '🔍 Find'}
          </button>
        </form>

        {isLoadingNative && (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Loading library playlists from desktop...
          </div>
        )}

        {nativeError && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: 'var(--bg-card)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginBottom: 12,
            }}
          >
            {nativeError}
          </div>
        )}

        {!isLoadingNative && displayedNativePlaylists.length === 0 && !nativeError && (
          <div
            style={{
              textAlign: 'center',
              padding: '20px 16px',
              backgroundColor: 'var(--bg-card)',
              borderRadius: 10,
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
            }}
          >
            No native playlists returned by desktop companion. Use the search bar above to find any YouTube Music playlist!
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayedNativePlaylists.map((pl) => (
            <div
              key={pl.id}
              className="track-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                {pl.thumbnailUrl ? (
                  <img
                    src={pl.thumbnailUrl}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ fontSize: '1.2rem' }}>💿</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="track-details-title" title={pl.title}>
                    {pl.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {pl.subtitle || 'YTMDesktop Library Playlist'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={() => onPlayDesktopPlaylist(pl.id)}
                aria-label={`Play ${pl.title} on desktop`}
                title="Play Playlist on PC"
                style={{ height: 32, padding: '0 12px', fontSize: '0.8rem', flexShrink: 0 }}
              >
                ▶ Play on Desktop
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Track Action Sheet */}
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
      />
    </div>
  );
};
