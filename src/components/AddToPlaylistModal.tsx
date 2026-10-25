/**
 * Tubify AddToPlaylistModal Component
 * 
 * Global modal allowing users to quickly add any track (from Now Playing,
 * Queue, or Search) into an existing editable playlist or create a new playlist
 * on the fly.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { EditablePlaylist, SearchTrack } from '../types/companion';
import { CompanionClient } from '../lib/companion-client';

export interface AddToPlaylistModalProps {
  track: SearchTrack;
  client: CompanionClient;
  onClose: () => void;
  onSuccess: (playlistTitle: string) => void;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  track,
  client,
  onClose,
  onSuccess,
}) => {
  const [playlists, setPlaylists] = useState<EditablePlaylist[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);

  // Load playlists
  const loadPlaylists = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await client.getEditablePlaylists();
      setPlaylists(data);
    } catch (err: any) {
      console.error('[tubify:add-modal] Failed to load playlists:', err);
      setError(err?.message ?? 'Failed to load playlists');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  // Handle select existing playlist
  const handleSelectPlaylist = async (playlist: EditablePlaylist) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      await client.addTrackToPlaylist(playlist.id, track);
      onSuccess(playlist.title);
    } catch (err: any) {
      alert(`Failed to add track: ${err?.message}`);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Handle create new playlist and add track
  const handleCreateAndAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const titleToUse = newTitle.trim() || 'Untitled Playlist';
    setIsSubmitting(true);
    try {
      const created = await client.createEditablePlaylist(titleToUse);
      await client.addTrackToPlaylist(created.id, track);
      onSuccess(created.title);
    } catch (err: any) {
      alert(`Failed to create playlist: ${err?.message}`);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add to Playlist"
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>➕</span>
            <h3 className="modal-title">Add to Playlist</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {/* Target Track Preview */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              backgroundColor: 'var(--bg-card)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
            }}
          >
            {track.thumbnailUrl ? (
              <img
                src={track.thumbnailUrl}
                alt={track.title}
                style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 6,
                  backgroundColor: 'var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.2rem',
                }}
              >
                🎵
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '0.95rem',
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
                  fontSize: '0.8rem',
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
          </div>

          {/* Quick Create New Playlist Form */}
          <form onSubmit={handleCreateAndAdd} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="search-input"
              placeholder="New playlist name..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              disabled={isSubmitting}
              style={{ flex: 1, height: 38, fontSize: '0.85rem' }}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
              style={{ height: 38, padding: '0 14px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
            >
              + Create & Add
            </button>
          </form>

          {/* Existing Playlists Section */}
          <div style={{ marginTop: 4 }}>
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                marginBottom: 8,
              }}
            >
              Choose Existing Playlist
            </div>

            {isLoading && (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Loading playlists...
              </div>
            )}

            {error && (
              <div className="banner-error" style={{ fontSize: '0.8rem' }}>
                {error}
              </div>
            )}

            {!isLoading && playlists.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '20px 12px',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: 8,
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}
              >
                No playlists found. Create one above to add this song!
              </div>
            )}

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {playlists.map((pl) => {
                const trackAlreadyIn = pl.tracks.some((t) => t.videoId === track.videoId);

                return (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => handleSelectPlaylist(pl)}
                    disabled={isSubmitting}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{pl.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {pl.tracks.length} {pl.tracks.length === 1 ? 'track' : 'tracks'}
                        {trackAlreadyIn && (
                          <span style={{ color: 'var(--accent-warning)', marginLeft: 6 }}>
                            (Already added)
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize: '1rem', color: 'var(--accent-spotify)' }}>+</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ fontSize: '0.85rem', padding: '0 16px' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
