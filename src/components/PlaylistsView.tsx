/**
 * Tubify PlaylistsView Component
 * 
 * Features:
 * 1. Editable Tubify Playlists:
 *    - Create new playlist (inline form or prompt)
 *    - Rename playlist
 *    - Delete playlist with confirmation
 *    - Expand/collapse to inspect tracks
 *    - Play entire custom playlist (custom playlist auto-advance queue)
 *    - Play individual track on PC
 *    - Remove individual track from playlist
 * 2. Native YouTube Music Playlists:
 *    - Loaded via companion.client.getPlaylists()
 *    - Direct playback on PC via changeVideo(null, playlist.id)
 * 3. Pull/tap-to-refresh for both playlist collections
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { EditablePlaylist, PlaylistSummary, SearchTrack } from '../types/companion';
import { CompanionClient } from '../lib/companion-client';

export interface PlaylistsViewProps {
  client: CompanionClient;
  onPlayTrack: (track: SearchTrack) => void | Promise<void>;
  onPlayCustomPlaylist: (tracks: SearchTrack[], startIndex?: number) => void | Promise<void>;
  onPlayDesktopPlaylist: (playlistId: string) => void | Promise<void>;
}

export const PlaylistsView: React.FC<PlaylistsViewProps> = ({
  client,
  onPlayTrack,
  onPlayCustomPlaylist,
  onPlayDesktopPlaylist,
}) => {
  // Tubify custom editable playlists
  const [editablePlaylists, setEditablePlaylists] = useState<EditablePlaylist[]>([]);
  const [isLoadingEditable, setIsLoadingEditable] = useState<boolean>(true);
  const [editableError, setEditableError] = useState<string | null>(null);

  // Native YTMDesktop companion playlists
  const [nativePlaylists, setNativePlaylists] = useState<PlaylistSummary[]>([]);
  const [isLoadingNative, setIsLoadingNative] = useState<boolean>(false);
  const [nativeError, setNativeError] = useState<string | null>(null);

  // UI interaction states
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [isSubmittingCreate, setIsSubmittingCreate] = useState<boolean>(false);
  const isCreatingRef = useRef<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  // Fetch native YTMDesktop companion playlists
  const loadNativePlaylists = useCallback(async () => {
    if (!client.token) {
      setNativePlaylists([]);
      setNativeError('Connect to YTMDesktop to load library playlists');
      return;
    }

    setIsLoadingNative(true);
    setNativeError(null);
    try {
      const data = await client.getPlaylists();
      setNativePlaylists(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('[tubify:playlists-view] Native playlists fetch:', err);
      setNativeError(err?.message ?? 'Could not fetch desktop playlists');
      setNativePlaylists([]);
    } finally {
      setIsLoadingNative(false);
    }
  }, [client]);

  // Initial load
  useEffect(() => {
    loadEditablePlaylists();
    loadNativePlaylists();
  }, [loadEditablePlaylists, loadNativePlaylists]);

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
            loadNativePlaylists();
          }}
          aria-label="Refresh playlists"
          title="Refresh All Playlists"
          style={{ height: 32, fontSize: '0.8rem', padding: '0 10px' }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* ================================================================== */}
      {/* SECTION 1: Tubify Editable Playlists                                */}
      {/* ================================================================== */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '1.1rem' }}>📁</span>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Tubify Playlists
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              ({editablePlaylists.length})
            </span>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={() => setIsCreating(true)}
            style={{ height: 32, fontSize: '0.8rem', padding: '0 12px' }}
          >
            + New Playlist
          </button>
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
              borderRadius: 12,
              border: '1px dashed var(--border-subtle)',
            }}
          >
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 8 }}>
              No custom playlists yet.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsCreating(true)}
              style={{ fontSize: '0.85rem' }}
            >
              Create your first playlist
            </button>
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

                            <div style={{ flex: 1, minWidth: 0 }}>
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
      {/* SECTION 2: YouTube Music Library Playlists                         */}
      {/* ================================================================== */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: '1.1rem' }}>📺</span>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            YouTube Music Library Playlists
          </h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            ({nativePlaylists.length})
          </span>
        </div>

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

        {!isLoadingNative && nativePlaylists.length === 0 && !nativeError && (
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
            No native playlists returned by desktop companion.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {nativePlaylists.map((pl) => (
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
                <div style={{ fontSize: '1.2rem' }}>💿</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="track-details-title" title={pl.title}>
                    {pl.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    YTMDesktop Library Playlist
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
    </div>
  );
};
