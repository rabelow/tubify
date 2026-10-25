/**
 * Tubify QueueView Component
 * 
 * Features:
 * 1. Renders active playback queue items (`queue.items`) and autoplay recommendations (`queue.automixItems`)
 * 2. Highlights currently playing track based on `selectedItemIndex` or `item.selected`
 * 3. Auto-scrolls the currently playing song into view on mount and track change + "Jump to Playing" pill
 * 4. Continuous indexing for track jumping: tapping regular or automix items dispatches `onPlayIndex(continuousIndex)`
 * 5. Reorganizable queue: Move Up (↑), Move Down (↓), drag-and-drop reorder, and Remove from Queue
 * 6. Long-press (~420ms) / right-click / '•••' action sheet on every queue item for Play Next, Play Last, Add to Playlist, Remove
 * 7. One-tap "Save Queue as Playlist" action
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { QueueItem, QueueState, SearchTrack } from '../types/companion';
import { TrackActionSheet } from './TrackActionSheet';

export interface QueueViewProps {
  queue?: QueueState | null;
  onPlayIndex: (index: number) => Promise<void> | void;
  onAddToPlaylist?: (track: SearchTrack) => void;
  onPlayNext?: (track: SearchTrack) => Promise<void> | void;
  onPlayLast?: (track: SearchTrack) => Promise<void> | void;
  onReorderQueue?: (fromIndex: number, toIndex: number) => void;
  onRemoveFromQueue?: (index: number) => void;
  onSaveQueueAsPlaylist?: (tracks: SearchTrack[]) => void;
  hasQueueOverride?: boolean;
  onClearQueueOverride?: () => void;
}

/**
 * Extracts best available thumbnail URL from a QueueItem
 */
export function getQueueItemThumbnail(item: QueueItem): string | undefined {
  if (!item.thumbnails || !Array.isArray(item.thumbnails) || item.thumbnails.length === 0) {
    return undefined;
  }
  const last = item.thumbnails[item.thumbnails.length - 1];
  if (typeof last === 'string') return last;
  return last?.url;
}

export function queueItemToSearchTrack(item: QueueItem): SearchTrack {
  return {
    videoId: item.videoId || '',
    title: item.title || 'Unknown Track',
    artist: item.author || 'Unknown Artist',
    duration: item.duration || '',
    thumbnailUrl: getQueueItemThumbnail(item),
  };
}

interface QueueTrackRowProps {
  item: QueueItem;
  continuousIndex: number;
  totalCount: number;
  isActive: boolean;
  activeRowRef?: React.RefObject<HTMLDivElement | null>;
  onPlay: (index: number) => Promise<void> | void;
  onAdd?: (track: SearchTrack) => void;
  onOpenActions: (item: QueueItem, index: number) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
  onDragStartRow?: (index: number) => void;
  onDropOnRow?: (index: number) => void;
}

const QueueTrackRow: React.FC<QueueTrackRowProps> = ({
  item,
  continuousIndex,
  totalCount,
  isActive,
  activeRowRef,
  onPlay,
  onAdd,
  onOpenActions,
  onMoveUp,
  onMoveDown,
  onDragStartRow,
  onDropOnRow,
}) => {
  const [imgError, setImgError] = useState<boolean>(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef<boolean>(false);
  const thumbUrl = getQueueItemThumbnail(item);

  const title = item.title || 'Unknown Track';
  const author = item.author || 'Unknown Artist';
  const duration = item.duration || '';

  const clearPressTimer = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handlePointerDown = () => {
    didLongPressRef.current = false;
    clearPressTimer();
    longPressRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      onOpenActions(item, continuousIndex);
    }, 420);
  };

  const handleClick = () => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false;
      return;
    }
    try {
      const res = onPlay(continuousIndex);
      if (res && typeof (res as Promise<void>).catch === 'function') {
        (res as Promise<void>).catch(() => {});
      }
    } catch {}
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const handleAddClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (onAdd) {
      onAdd(queueItemToSearchTrack(item));
    }
  };

  const handleMoreClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onOpenActions(item, continuousIndex);
  };

  return (
    <div
      ref={isActive ? activeRowRef : undefined}
      className={`track-row queue-item ${isActive ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      draggable={Boolean(onDragStartRow)}
      onDragStart={() => onDragStartRow?.(continuousIndex)}
      onDragOver={(e) => {
        if (onDropOnRow) e.preventDefault();
      }}
      onDrop={() => onDropOnRow?.(continuousIndex)}
      onPointerDown={handlePointerDown}
      onPointerUp={clearPressTimer}
      onPointerLeave={clearPressTimer}
      onPointerCancel={clearPressTimer}
      onTouchEnd={(e) => {
        clearPressTimer();
        if (didLongPressRef.current) {
          e.preventDefault();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        clearPressTimer();
        didLongPressRef.current = true;
        onOpenActions(item, continuousIndex);
      }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`Play ${title} by ${author}`}
      aria-current={isActive ? 'true' : undefined}
      data-testid={`queue-item-${continuousIndex}`}
      data-index={continuousIndex}
    >
      {/* Playing indicator */}
      {isActive && (
        <span
          className="playing-indicator"
          aria-label="Now playing"
          title="Now Playing"
        >
          ▶
        </span>
      )}

      {/* Thumbnail artwork or music note fallback */}
      {thumbUrl && !imgError ? (
        <img
          src={thumbUrl}
          alt=""
          className="track-thumb"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="track-thumb-fallback" aria-hidden="true">
          <span>🎵</span>
        </div>
      )}

      {/* Track details: title, artist, duration + source badge */}
      <div className="track-details">
        <div className="track-details-title" title={title} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          {item.source === 'play-next' && (
            <span className="queue-source-badge badge-next">NEXT</span>
          )}
          {item.source === 'play-last' && (
            <span className="queue-source-badge badge-last">QUEUED</span>
          )}
        </div>
        <div className="track-details-sub" title={`${author}${duration ? ` • ${duration}` : ''}`}>
          {author}{duration ? ` • ${duration}` : ''}
        </div>
      </div>

      {/* Track duration */}
      {duration && (
        <span className="track-duration" aria-label={`Duration: ${duration}`}>
          {duration}
        </span>
      )}

      {/* Reorder Up / Down controls when reorganization is enabled */}
      {onMoveUp && onMoveDown && (
        <div
          className="queue-reorder-controls"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}
        >
          <button
            type="button"
            className="btn-icon queue-move-btn"
            disabled={continuousIndex === 0}
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp(continuousIndex);
            }}
            aria-label={`Move ${title} up`}
            title="Move Up"
            data-testid={`queue-move-up-${continuousIndex}`}
            style={{ width: 26, height: 26, fontSize: '0.75rem', opacity: continuousIndex === 0 ? 0.3 : 0.85 }}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn-icon queue-move-btn"
            disabled={continuousIndex >= totalCount - 1}
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown(continuousIndex);
            }}
            aria-label={`Move ${title} down`}
            title="Move Down"
            data-testid={`queue-move-down-${continuousIndex}`}
            style={{
              width: 26,
              height: 26,
              fontSize: '0.75rem',
              opacity: continuousIndex >= totalCount - 1 ? 0.3 : 0.85,
            }}
          >
            ↓
          </button>
        </div>
      )}

      {/* Add to Playlist button */}
      <button
        type="button"
        className="btn-secondary queue-add-btn"
        onClick={handleAddClick}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Add ${title} to playlist`}
        title="Add to Playlist"
        data-testid={`queue-add-${continuousIndex}`}
      >
        + Add
      </button>

      {/* More Options (Play Next / Play Last / Remove) button */}
      <button
        type="button"
        className="btn-secondary queue-more-btn"
        onClick={handleMoreClick}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`More queue options for ${title}`}
        title="Queue Options (Play Next, Play Last, Remove)"
        data-testid={`queue-more-${continuousIndex}`}
        style={{ height: 30, padding: '0 7px', fontSize: '0.8rem' }}
      >
        •••
      </button>
    </div>
  );
};

export const QueueView: React.FC<QueueViewProps> = ({
  queue,
  onPlayIndex,
  onAddToPlaylist,
  onPlayNext,
  onPlayLast,
  onReorderQueue,
  onRemoveFromQueue,
  onSaveQueueAsPlaylist,
  hasQueueOverride,
  onClearQueueOverride,
}) => {
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const dragFromIndexRef = useRef<number | null>(null);
  const [actionTarget, setActionTarget] = useState<{ track: SearchTrack; index: number } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2200);
  }, []);

  const hasItems = Array.isArray(queue?.items) && queue.items.length > 0;
  const hasAutomix = Array.isArray(queue?.automixItems) && queue.automixItems.length > 0;
  const itemsCount = queue?.items?.length ?? 0;
  const automixCount = queue?.automixItems?.length ?? 0;
  const totalCount = itemsCount + automixCount;

  // Determine active continuous index and videoId for auto-scrolling
  const selectedItemIndex = queue?.selectedItemIndex ?? -1;
  const activeItemFromItems = queue?.items?.find((i, idx) => idx === selectedItemIndex || i.selected);
  const activeVideoId = activeItemFromItems?.videoId ?? '';

  const scrollToActiveTrack = useCallback(() => {
    if (activeRowRef.current && typeof activeRowRef.current.scrollIntoView === 'function') {
      try {
        activeRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        activeRowRef.current.scrollIntoView();
      }
    }
  }, []);

  // Auto-scroll to playing song on mount and whenever active track changes
  useEffect(() => {
    if (hasItems || hasAutomix) {
      scrollToActiveTrack();
    }
  }, [hasItems, hasAutomix, selectedItemIndex, activeVideoId, scrollToActiveTrack]);

  // Empty state when queue is empty or not loaded
  if (!queue || (!hasItems && !hasAutomix)) {
    return (
      <div className="tab-view queue-view">
        <div className="queue-empty">
          <div className="queue-empty-icon" aria-hidden="true">
            📋
          </div>
          <p className="queue-empty-text">
            Queue is empty. Play songs on YouTube Music or search to add music.
          </p>
        </div>
      </div>
    );
  }

  const handleOpenActions = (item: QueueItem, index: number) => {
    setActionTarget({
      track: queueItemToSearchTrack(item),
      index,
    });
  };

  const handleMoveUp = onReorderQueue
    ? (index: number) => {
        if (index > 0) {
          onReorderQueue(index, index - 1);
        }
      }
    : undefined;

  const handleMoveDown = onReorderQueue
    ? (index: number) => {
        if (index < totalCount - 1) {
          onReorderQueue(index, index + 1);
        }
      }
    : undefined;

  const handleSaveAllToPlaylist = () => {
    if (!onSaveQueueAsPlaylist) return;
    const allItems = [...(queue.items ?? []), ...(queue.automixItems ?? [])];
    const tracks = allItems
      .map(queueItemToSearchTrack)
      .filter((t) => Boolean(t.videoId));
    if (tracks.length > 0) {
      onSaveQueueAsPlaylist(tracks);
      showToast(`Saved ${tracks.length} tracks to Tubify Playlists`);
    }
  };

  return (
    <div className="tab-view queue-view" style={{ overflowY: 'auto' }}>
      {/* Queue Toolbar: Jump to Playing, Save Queue as Playlist, Reset Sync */}
      <div
        className="queue-toolbar"
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
          <button
            type="button"
            className="btn-secondary"
            onClick={scrollToActiveTrack}
            data-testid="jump-to-playing-btn"
            title="Scroll to currently playing track"
            style={{ height: 30, fontSize: '0.76rem', padding: '0 10px' }}
          >
            🎯 Jump to Playing
          </button>

          {hasQueueOverride && onClearQueueOverride && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onClearQueueOverride();
                showToast('Synced with raw desktop queue');
              }}
              data-testid="reset-queue-sync-btn"
              title="Reset custom queue order to match desktop"
              style={{ height: 30, fontSize: '0.75rem', padding: '0 10px' }}
            >
              🔄 Sync Desktop
            </button>
          )}
        </div>

        {onSaveQueueAsPlaylist && (
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSaveAllToPlaylist}
            data-testid="save-queue-playlist-btn"
            title="Save entire queue as a Tubify playlist"
            style={{ height: 30, fontSize: '0.76rem', padding: '0 10px' }}
          >
            💾 Save Queue as Playlist
          </button>
        )}
      </div>

      {toastMsg && (
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
          ✨ {toastMsg}
        </div>
      )}

      {/* Up Next Section */}
      {hasItems && (
        <section className="queue-section" aria-label="Up Next">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <h3 className="queue-section-title" style={{ margin: 0 }}>Up Next</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>({itemsCount})</span>
            </div>
            <span style={{ fontWeight: 500, fontSize: '0.73rem', color: 'var(--text-muted)' }}>
              Hold song or tap ••• to Play Next / Last
            </span>
          </div>
          <div className="queue-list" role="list" aria-label="Up Next Tracks">
            {queue.items.map((item, index) => {
              const continuousIndex = index;
              const isActive =
                queue.selectedItemIndex === index || Boolean(item.selected);

              return (
                <QueueTrackRow
                  key={item.queueId || `queue-item-${index}-${item.videoId || item.title || index}`}
                  item={item}
                  continuousIndex={continuousIndex}
                  totalCount={totalCount}
                  isActive={isActive}
                  activeRowRef={activeRowRef}
                  onPlay={onPlayIndex}
                  onAdd={onAddToPlaylist}
                  onOpenActions={handleOpenActions}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onDragStartRow={
                    onReorderQueue
                      ? (idx) => {
                          dragFromIndexRef.current = idx;
                        }
                      : undefined
                  }
                  onDropOnRow={
                    onReorderQueue
                      ? (toIdx) => {
                          if (
                            dragFromIndexRef.current !== null &&
                            dragFromIndexRef.current !== toIdx
                          ) {
                            onReorderQueue(dragFromIndexRef.current, toIdx);
                          }
                          dragFromIndexRef.current = null;
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Autoplay Recommendations Section */}
      {hasAutomix && (
        <section
          className="queue-section"
          aria-label="Autoplay Recommendations"
          style={{ marginTop: hasItems ? 20 : 0 }}
        >
          <h3 className="queue-section-title">Autoplay Recommendations</h3>
          <div
            className="queue-list"
            role="list"
            aria-label="Autoplay Recommendation Tracks"
          >
            {queue.automixItems.map((item, index) => {
              const continuousIndex = itemsCount + index;
              const isActive =
                queue.selectedItemIndex === continuousIndex ||
                Boolean(item.selected);

              return (
                <QueueTrackRow
                  key={item.queueId || `automix-item-${index}-${item.videoId || item.title || index}`}
                  item={item}
                  continuousIndex={continuousIndex}
                  totalCount={totalCount}
                  isActive={isActive}
                  activeRowRef={activeRowRef}
                  onPlay={onPlayIndex}
                  onAdd={onAddToPlaylist}
                  onOpenActions={handleOpenActions}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Track Action Sheet for Queue Items */}
      <TrackActionSheet
        track={actionTarget?.track ?? null}
        onClose={() => setActionTarget(null)}
        onPlayNow={() => {
          if (actionTarget) {
            onPlayIndex(actionTarget.index);
          }
        }}
        onPlayNext={
          onPlayNext
            ? (t) => {
                onPlayNext(t);
                showToast(`Queued "${t.title}" to Play Next`);
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
        onAddToPlaylist={
          onAddToPlaylist
            ? (t) => {
                onAddToPlaylist(t);
              }
            : undefined
        }
        onRemoveFromQueue={
          onRemoveFromQueue && actionTarget
            ? () => {
                onRemoveFromQueue(actionTarget.index);
                showToast(`Removed "${actionTarget.track.title}" from queue`);
              }
            : undefined
        }
      />
    </div>
  );
};
