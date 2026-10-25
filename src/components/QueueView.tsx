/**
 * Tubify QueueView Component
 * 
 * Features:
 * 1. Renders active playback queue items (`queue.items`) and autoplay recommendations (`queue.automixItems`)
 * 2. Highlights currently playing track based on `selectedItemIndex` or `item.selected`
 * 3. Continuous indexing for track jumping: tapping regular or automix items dispatches `onPlayIndex(continuousIndex)`
 * 4. Quick "+ Add" action per track calling `onAddToPlaylist(SearchTrack)`
 * 5. Full empty state handling and dark Spotify/YTM theme styling
 */

import React, { useState } from 'react';
import type { QueueItem, QueueState, SearchTrack } from '../types/companion';

export interface QueueViewProps {
  queue?: QueueState | null;
  onPlayIndex: (index: number) => Promise<void> | void;
  onAddToPlaylist?: (track: SearchTrack) => void;
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

interface QueueTrackRowProps {
  item: QueueItem;
  continuousIndex: number;
  isActive: boolean;
  onPlay: (index: number) => Promise<void> | void;
  onAdd?: (track: SearchTrack) => void;
}

const QueueTrackRow: React.FC<QueueTrackRowProps> = ({
  item,
  continuousIndex,
  isActive,
  onPlay,
  onAdd,
}) => {
  const [imgError, setImgError] = useState<boolean>(false);
  const thumbUrl = getQueueItemThumbnail(item);

  const title = item.title || 'Unknown Track';
  const author = item.author || 'Unknown Artist';
  const duration = item.duration || '';

  const handleClick = () => {
    onPlay(continuousIndex);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlay(continuousIndex);
    }
  };

  const handleAddClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (onAdd) {
      onAdd({
        videoId: item.videoId || '',
        title,
        artist: author,
        duration,
        thumbnailUrl: thumbUrl,
      });
    }
  };

  return (
    <div
      className={`track-row queue-item ${isActive ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`Play ${title} by ${author}`}
      aria-current={isActive ? 'true' : undefined}
      data-testid={`queue-item-${continuousIndex}`}
      data-index={continuousIndex}
    >
      {/* Playing indicator or fallback */}
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

      {/* Track details: title, artist, duration */}
      <div className="track-details">
        <div className="track-details-title" title={title}>
          {title}
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

      {/* Add to Playlist button */}
      <button
        type="button"
        className="btn-secondary queue-add-btn"
        onClick={handleAddClick}
        aria-label={`Add ${title} to playlist`}
        title="Add to Playlist"
        data-testid={`queue-add-${continuousIndex}`}
      >
        + Add
      </button>
    </div>
  );
};

export const QueueView: React.FC<QueueViewProps> = ({
  queue,
  onPlayIndex,
  onAddToPlaylist,
}) => {
  const hasItems = Array.isArray(queue?.items) && queue.items.length > 0;
  const hasAutomix = Array.isArray(queue?.automixItems) && queue.automixItems.length > 0;

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

  const itemsCount = queue.items?.length ?? 0;

  return (
    <div className="tab-view queue-view" style={{ overflowY: 'auto' }}>
      {/* Up Next Section */}
      {hasItems && (
        <section className="queue-section" aria-label="Up Next">
          <h3 className="queue-section-title">Up Next</h3>
          <div className="queue-list" role="list" aria-label="Up Next Tracks">
            {queue.items.map((item, index) => {
              const continuousIndex = index;
              const isActive =
                queue.selectedItemIndex === index || Boolean(item.selected);

              return (
                <QueueTrackRow
                  key={`queue-item-${index}-${item.videoId || item.title || index}`}
                  item={item}
                  continuousIndex={continuousIndex}
                  isActive={isActive}
                  onPlay={onPlayIndex}
                  onAdd={onAddToPlaylist}
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
                  key={`automix-item-${index}-${item.videoId || item.title || index}`}
                  item={item}
                  continuousIndex={continuousIndex}
                  isActive={isActive}
                  onPlay={onPlayIndex}
                  onAdd={onAddToPlaylist}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
