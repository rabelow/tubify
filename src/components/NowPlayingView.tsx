/**
 * Tubify NowPlayingView Component
 * 
 * Implements:
 * 1. Artwork display with fallback
 * 2. Title, artist, album metadata & ad-playing badge
 * 3. 200ms interpolated seek slider with scrubbing support
 * 4. Full transport control bar (Shuffle, Prev, Play/Pause, Next, Repeat, Thumbs Up/Down)
 * 5. Dedicated Remote Volume Bar (0-100% range slider, -5%/+5% step buttons, mute toggle, % label)
 * 6. Quick "+ Add to Playlist" action
 */

import React, { useState, useEffect } from 'react';
import type { VideoMetadata, PlayerState, TrackState, LikeStatus } from '../types/companion';

export interface NowPlayingViewProps {
  video: VideoMetadata | null;
  player: PlayerState | null;
  trackState: TrackState;
  interpolatedProgress: number;
  durationSeconds: number;
  volume: number;
  isMuted: boolean;

  onPlayPause: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
  onPrevious: () => void | Promise<void>;
  onSeek: (seconds: number) => void | Promise<void>;
  onShuffle: () => void | Promise<void>;
  onRepeatMode: () => void | Promise<void>;
  onToggleLike: () => void | Promise<void>;
  onToggleDislike: () => void | Promise<void>;

  onSetVolume: (volume: number) => void | Promise<void>;
  onStepVolume: (delta: number) => void | Promise<void>;
  onToggleMute: () => void | Promise<void>;

  onAddToPlaylist?: () => void;
  isShuffleActive?: boolean;
  repeatModeValue?: 0 | 1 | 2;
  onPlayNextCurrent?: () => void;
  onPlayLastCurrent?: () => void;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const NowPlayingView: React.FC<NowPlayingViewProps> = ({
  video,
  player,
  trackState,
  interpolatedProgress,
  durationSeconds,
  volume,
  isMuted,

  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onShuffle,
  onRepeatMode,
  onToggleLike,
  onToggleDislike,

  onSetVolume,
  onStepVolume,
  onToggleMute,

  onAddToPlaylist,
  isShuffleActive = false,
  repeatModeValue,
  onPlayNextCurrent,
  onPlayLastCurrent,
}) => {
  const [imgError, setImgError] = useState<boolean>(false);
  const [scrubbingProgress, setScrubbingProgress] = useState<number | null>(null);

  // Clear scrubbing and image error state on track transition
  useEffect(() => {
    setScrubbingProgress(null);
    setImgError(false);
  }, [video?.id]);

  const isPlaying = trackState === 1 && !player?.isPaused;
  const isAd = Boolean(player?.adPlaying);

  // Artwork resolution
  const artworkUrl = !imgError
    ? video?.coverUrl || (video?.thumbnails && video.thumbnails.length > 0 ? video.thumbnails[video.thumbnails.length - 1]?.url : undefined)
    : undefined;

  // Like status resolution
  const isLiked = video?.likeStatus === 2 || video?.likeStatus === 'LIKE';
  const isDisliked = video?.likeStatus === 0 || video?.likeStatus === 'DISLIKE';

  // Repeat mode resolution (handles both player.repeatType and player.queue.repeatMode)
  const rawPlayerRepeat =
    player?.repeatType !== undefined && player.repeatType >= 0
      ? player.repeatType
      : player?.queue?.repeatMode !== undefined && player.queue.repeatMode >= 0
        ? player.queue.repeatMode
        : 0;
  const repeatMode = repeatModeValue !== undefined ? repeatModeValue : rawPlayerRepeat;

  const currentDisplayProgress = scrubbingProgress !== null ? scrubbingProgress : interpolatedProgress;
  const safeDuration = durationSeconds > 0 ? durationSeconds : 1;

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setScrubbingProgress(Number(e.target.value));
  };

  const handleSeekCommit = () => {
    if (scrubbingProgress !== null) {
      onSeek(scrubbingProgress);
      setScrubbingProgress(null);
    }
  };

  return (
    <div className="tab-view">
      <div className="now-playing-container">
        {/* Album Artwork with Sunburst Studio Turntable Frame */}
        <div className={`artwork-wrapper ${isPlaying ? 'playing' : ''}`}>
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt={video?.title || 'Album Art'}
              className="artwork-image"
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-muted)',
              }}
            >
              <img
                src="/assets/vinyl-placeholder.png"
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: 0.55,
                }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" style={{ position: 'relative', zIndex: 1 }}>
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
              <span style={{ fontSize: '0.8rem', marginTop: 8, position: 'relative', zIndex: 1, fontWeight: 600 }}>
                {video ? 'No Artwork' : 'Ready to Play'}
              </span>
            </div>
          )}
        </div>

        {/* Track Metadata */}
        <div className="track-meta">
          <h1 className="track-title" title={video?.title || 'No Track Playing'}>
            {video?.title || 'No Track Playing'}
          </h1>
          <p className="track-artist">
            {video?.author || 'YTMDesktop Remote'}
            {video?.album ? ` • ${video.album}` : ''}
          </p>

          {isAd && <span className="ad-badge">Advertisement</span>}
        </div>

        {/* Progress & Seekbar */}
        <div className="progress-container">
          <input
            type="range"
            aria-label="Seekbar"
            className="progress-slider"
            min={0}
            max={safeDuration}
            step={0.5}
            value={Math.min(currentDisplayProgress, safeDuration)}
            onChange={handleSeekChange}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            onKeyUp={handleSeekCommit}
            disabled={!video || isAd}
          />
          <div className="progress-timestamps">
            <span>{formatTime(currentDisplayProgress)}</span>
            <span>{formatTime(durationSeconds)}</span>
          </div>
        </div>

        {/* Primary Transport Controls */}
        <div className="transport-row">
          {/* Thumbs Down */}
          <button
            type="button"
            className={`btn-transport ${isDisliked ? 'active' : ''}`}
            onClick={onToggleDislike}
            aria-label="Dislike"
            aria-pressed={isDisliked}
            title="Dislike"
            disabled={!video}
          >
            👎
          </button>

          {/* Shuffle with Active Illuminated State & Badge */}
          <button
            type="button"
            className={`btn-transport ${isShuffleActive ? 'active' : ''}`}
            onClick={onShuffle}
            aria-label="Shuffle"
            aria-pressed={isShuffleActive}
            title={isShuffleActive ? 'Shuffle On' : 'Shuffle Off'}
            data-testid="shuffle-btn"
            disabled={!video}
          >
            <span>🔀</span>
            {isShuffleActive && (
              <span className="transport-badge" data-testid="shuffle-active-badge">
                ON
              </span>
            )}
          </button>

          {/* Previous */}
          <button
            type="button"
            className="btn-transport"
            onClick={onPrevious}
            aria-label="Previous Track"
            title="Previous"
            disabled={!video}
          >
            ⏮
          </button>

          {/* Play / Pause Toggle */}
          <button
            type="button"
            className="btn-play-pause"
            onClick={onPlayPause}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          {/* Next */}
          <button
            type="button"
            className="btn-transport"
            onClick={onNext}
            aria-label="Next Track"
            title="Next"
            disabled={!video}
          >
            ⏭
          </button>

          {/* Repeat Mode with Active Illuminated State & Mode Badge */}
          <button
            type="button"
            className={`btn-transport ${repeatMode > 0 ? 'active' : ''}`}
            onClick={onRepeatMode}
            aria-label="Repeat Mode"
            aria-pressed={repeatMode > 0}
            title={repeatMode === 2 ? 'Repeat One' : repeatMode === 1 ? 'Repeat All' : 'Repeat Off'}
            data-testid="repeat-btn"
            disabled={!video}
          >
            <span>{repeatMode === 2 ? '🔂' : '🔁'}</span>
            {repeatMode > 0 && (
              <span className="transport-badge" data-testid="repeat-active-badge">
                {repeatMode === 2 ? '1' : 'ALL'}
              </span>
            )}
          </button>

          {/* Thumbs Up */}
          <button
            type="button"
            className={`btn-transport ${isLiked ? 'active' : ''}`}
            onClick={onToggleLike}
            aria-label="Like"
            aria-pressed={isLiked}
            title="Like"
            disabled={!video}
          >
            👍
          </button>
        </div>

        {/* Dedicated Remote Volume Bar (R1, T011) */}
        <div className="volume-bar-container">
          <div className="volume-header">
            <span>Remote Volume</span>
            <span className="volume-percentage">{Math.round(Math.max(0, Math.min(100, volume)))}%</span>
          </div>

          <div className="volume-slider-row">
            <span style={{ fontSize: '1rem', opacity: 0.7 }}>🔈</span>
            <input
              type="range"
              aria-label="Remote Volume Slider"
              className="volume-slider"
              min={0}
              max={100}
              step={1}
              value={volume}
              onChange={(e) => onSetVolume(Number(e.target.value))}
            />
            <span style={{ fontSize: '1rem', opacity: 0.7 }}>🔊</span>
          </div>

          <div className="volume-actions-row">
            <button
              type="button"
              className="volume-step-btn"
              onClick={() => onStepVolume(-5)}
              aria-label="Decrease Volume by 5%"
              title="Decrease Volume 5%"
            >
              -5%
            </button>

            <button
              type="button"
              className="volume-step-btn"
              onClick={() => onStepVolume(5)}
              aria-label="Increase Volume by 5%"
              title="Increase Volume 5%"
            >
              +5%
            </button>

            <button
              type="button"
              className={`volume-mute-btn ${isMuted ? 'muted' : ''}`}
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇 Unmute' : '🔊 Mute'}
            </button>
          </div>
        </div>

        {/* Quick Add to Playlist Action */}
        {onAddToPlaylist && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onAddToPlaylist}
            disabled={!video}
            style={{
              marginTop: 12,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 40,
            }}
          >
            <span>+ Add to Playlist</span>
          </button>
        )}
      </div>
    </div>
  );
};
