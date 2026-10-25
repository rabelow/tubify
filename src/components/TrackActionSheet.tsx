/**
 * Tubify TrackActionSheet & Long-Press Gesture Helper
 *
 * Provides a tactile, mobile-first bottom action sheet triggered by:
 * - Long-pressing (~420ms) any track row in Search, Queue, or Playlists
 * - Right-clicking (context menu) a track row on desktop/tablet
 * - Tapping the '•••' more-actions button on any track row
 *
 * Actions:
 * 1. Play Now on Desktop
 * 2. Play Next (insert into active queue at selectedItemIndex + 1)
 * 3. Play Last (append to the end of the active queue)
 * 4. Add to Tubify Playlist...
 * 5. Remove from Queue (optional, when invoked from QueueView)
 */

import React from 'react';
import type { SearchTrack } from '../types/companion';

export interface TrackActionSheetProps {
  track: SearchTrack | null;
  onClose: () => void;
  onPlayNow?: (track: SearchTrack) => void;
  onPlayNext?: (track: SearchTrack) => void;
  onPlayLast?: (track: SearchTrack) => void;
  onAddToPlaylist?: (track: SearchTrack) => void;
  onRemoveFromQueue?: () => void;
}

export const TrackActionSheet: React.FC<TrackActionSheetProps> = ({
  track,
  onClose,
  onPlayNow,
  onPlayNext,
  onPlayLast,
  onAddToPlaylist,
  onRemoveFromQueue,
}) => {
  const touchStartedInsideRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    touchStartedInsideRef.current = false;
  }, [track]);

  React.useEffect(() => {
    if (!track) return;
    const win = window as unknown as { __tubifyCloseTopOverlay?: (() => void) | null };
    win.__tubifyCloseTopOverlay = onClose;
    return () => {
      if (win.__tubifyCloseTopOverlay === onClose) {
        win.__tubifyCloseTopOverlay = null;
      }
    };
  }, [track, onClose]);

  if (!track) return null;

  const handleAction = (fn?: (t: SearchTrack) => void) => {
    if (fn) fn(track);
    onClose();
  };

  return (
    <div
      className="modal-overlay action-sheet-overlay"
      onTouchStart={() => {
        touchStartedInsideRef.current = true;
      }}
      onTouchEnd={(e) => {
        if (!touchStartedInsideRef.current) {
          // Finger was already down before the sheet mounted (long-press release);
          // prevent synthetic click-through onto sheet buttons or backdrop.
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Track actions for ${track.title}`}
      data-testid="track-action-sheet"
    >
      <div
        className="modal-content action-sheet-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="action-sheet-handle" aria-hidden="true" />

        <div className="action-sheet-header">
          {track.thumbnailUrl ? (
            <img
              src={track.thumbnailUrl}
              alt={track.title}
              className="action-sheet-thumb"
            />
          ) : (
            <div className="action-sheet-thumb action-sheet-thumb-fallback">🎵</div>
          )}
          <div className="action-sheet-meta">
            <div className="action-sheet-title">{track.title}</div>
            <div className="action-sheet-artist">
              {track.artist}
              {track.duration ? ` • ${track.duration}` : ''}
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Close track menu"
          >
            ✕
          </button>
        </div>

        <div className="action-sheet-list">
          {onPlayNow && (
            <button
              type="button"
              className="action-sheet-btn"
              onClick={() => handleAction(onPlayNow)}
              data-testid="action-play-now"
            >
              <span className="action-sheet-icon">▶</span>
              <span className="action-sheet-label">
                <strong>Play Now</strong>
                <small>Start playing immediately on desktop</small>
              </span>
            </button>
          )}

          {onPlayNext && (
            <button
              type="button"
              className="action-sheet-btn action-sheet-btn-highlight"
              onClick={() => handleAction(onPlayNext)}
              data-testid="action-play-next"
            >
              <span className="action-sheet-icon">⏭</span>
              <span className="action-sheet-label">
                <strong>Play Next</strong>
                <small>Insert right after the currently playing song</small>
              </span>
            </button>
          )}

          {onPlayLast && (
            <button
              type="button"
              className="action-sheet-btn"
              onClick={() => handleAction(onPlayLast)}
              data-testid="action-play-last"
            >
              <span className="action-sheet-icon">⤵</span>
              <span className="action-sheet-label">
                <strong>Play Last</strong>
                <small>Add to the end of the current queue</small>
              </span>
            </button>
          )}

          {onAddToPlaylist && (
            <button
              type="button"
              className="action-sheet-btn"
              onClick={() => handleAction(onAddToPlaylist)}
              data-testid="action-add-playlist"
            >
              <span className="action-sheet-icon">➕</span>
              <span className="action-sheet-label">
                <strong>Add to Playlist...</strong>
                <small>Save to a Tubify playlist</small>
              </span>
            </button>
          )}

          {onRemoveFromQueue && (
            <button
              type="button"
              className="action-sheet-btn action-sheet-btn-danger"
              onClick={() => {
                onRemoveFromQueue();
                onClose();
              }}
              data-testid="action-remove-queue"
            >
              <span className="action-sheet-icon">🗑</span>
              <span className="action-sheet-label">
                <strong>Remove from Queue</strong>
                <small>Remove this entry from the active queue</small>
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
