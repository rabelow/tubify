/**
 * Tubify Main Application Shell
 * 
 * Features:
 * 1. Top connection status header with custom Sunburst studio logo, status dot & host indicator
 * 2. Persistent 5-tab bottom navigation bar:
 *    - Now Playing
 *    - Queue
 *    - Search
 *    - Playlists
 *    - Lyrics
 * 3. Floating Mini-Player bar when navigating Queue, Search, Playlists, or Lyrics
 * 4. Pairing modal overlay when unpaired or when tapping settings
 * 5. Unified Smart Queue (Play Next, Play Last, Reorder, Remove) wired across all views
 */

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useCompanion } from './hooks/useCompanion';
import { PairingView } from './components/PairingView';
import { NowPlayingView } from './components/NowPlayingView';
import { QueueView, queueItemToSearchTrack } from './components/QueueView';
import { SearchView } from './components/SearchView';
import { PlaylistsView } from './components/PlaylistsView';
import { LyricsView } from './components/LyricsView';
import { AddToPlaylistModal } from './components/AddToPlaylistModal';
import type { SearchTrack } from './types/companion';

export type ActiveTab = 'now_playing' | 'queue' | 'search' | 'playlists' | 'lyrics';

export default function App() {
  const companion = useCompanion();
  const [activeTab, setActiveTab] = useState<ActiveTab>('now_playing');
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [trackForPlaylistModal, setTrackForPlaylistModal] = useState<SearchTrack | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // Navigation history stack & 2-step exit state for Back button / Back gesture
  const tabHistoryRef = useRef<ActiveTab[]>([]);
  const activeTabRef = useRef<ActiveTab>('now_playing');
  const showSettingsModalRef = useRef<boolean>(false);
  const trackForPlaylistModalRef = useRef<SearchTrack | null>(null);
  const exitArmedUntilRef = useRef<number>(0);

  activeTabRef.current = activeTab;
  showSettingsModalRef.current = showSettingsModal;
  trackForPlaylistModalRef.current = trackForPlaylistModal;

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  }, []);

  const navigateToTab = useCallback((nextTab: ActiveTab) => {
    exitArmedUntilRef.current = 0;
    setShowSettingsModal(false);
    setActiveTab((prevTab) => {
      if (prevTab !== nextTab) {
        const stack = tabHistoryRef.current;
        if (stack[stack.length - 1] !== prevTab) {
          stack.push(prevTab);
          if (stack.length > 24) stack.shift();
        }
        try {
          window.history.pushState({ tubifyTab: nextTab }, '');
        } catch {}
      }
      return nextTab;
    });
  }, []);

  const handleBackNavigation = useCallback((): 'handled' | 'exit' => {
    const win = window as unknown as { __tubifyCloseTopOverlay?: (() => void) | null };

    // 1. Close TrackActionSheet if open
    if (typeof win.__tubifyCloseTopOverlay === 'function') {
      exitArmedUntilRef.current = 0;
      const closeFn = win.__tubifyCloseTopOverlay;
      win.__tubifyCloseTopOverlay = null;
      closeFn();
      return 'handled';
    }

    // 2. Close AddToPlaylistModal if open
    if (trackForPlaylistModalRef.current) {
      exitArmedUntilRef.current = 0;
      setTrackForPlaylistModal(null);
      return 'handled';
    }

    // 3. Close Settings / Pairing modal if open
    if (showSettingsModalRef.current) {
      exitArmedUntilRef.current = 0;
      setShowSettingsModal(false);
      return 'handled';
    }

    // 4. Return to the previous tab vision if history exists
    if (tabHistoryRef.current.length > 0) {
      exitArmedUntilRef.current = 0;
      const previousTab = tabHistoryRef.current.pop()!;
      setActiveTab(previousTab);
      return 'handled';
    }

    // 5. Fallback: if not on root Now Playing tab, return to Now Playing
    if (activeTabRef.current !== 'now_playing') {
      exitArmedUntilRef.current = 0;
      setActiveTab('now_playing');
      return 'handled';
    }

    // 6. At root view: require TWO back actions within 2.2s to exit the app
    const now = Date.now();
    if (now < exitArmedUntilRef.current) {
      exitArmedUntilRef.current = 0;
      return 'exit';
    }

    exitArmedUntilRef.current = now + 2200;
    showToast('Press back again to exit Tubify');
    return 'handled';
  }, [showToast]);

  useEffect(() => {
    const win = window as unknown as {
      __handleTubifyBack?: () => 'handled' | 'exit';
    };
    win.__handleTubifyBack = handleBackNavigation;

    try {
      window.history.pushState({ tubifyRootGuard: true }, '');
    } catch {}

    const onPopState = () => {
      const result = handleBackNavigation();
      if (result === 'handled') {
        try {
          window.history.pushState({ tubifyGuard: true }, '');
        } catch {}
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (win.__handleTubifyBack === handleBackNavigation) {
        delete win.__handleTubifyBack;
      }
    };
  }, [handleBackNavigation]);

  const {
    status,
    profile,
    pairingCode,
    error,
    state,
    video,
    player,
    trackState,
    interpolatedProgress,
    durationSeconds,
    isShuffleActive,
    repeatModeValue,
    volume,
    isMuted,
    client,
    startPairing,
    cancelPairing,
    playPause,
    next,
    previous,
    seekTo,
    shuffle,
    repeatMode,
    toggleLike,
    toggleDislike,
    setVolume,
    stepVolume,
    toggleMute,
    playQueueIndex,
    changeVideo,
    playNext,
    playLast,
    reorderQueue,
    removeFromQueue,
    clearQueueOverride,
    hasQueueOverride,
    playCustomPlaylist,
  } = companion;

  const activeQueue = state?.queue ?? player?.queue ?? undefined;

  // Normalize current queue items into SearchTrack[] for 1-tap "Save Queue as Playlist"
  const activeQueueTracks = useMemo<SearchTrack[]>(() => {
    const items = activeQueue?.items ?? [];
    const automix = activeQueue?.automixItems ?? [];
    return [...items, ...automix]
      .map(queueItemToSearchTrack)
      .filter((t) => Boolean(t.videoId));
  }, [activeQueue]);

  // Save an array of tracks directly as a Tubify playlist
  const handleSaveQueueAsPlaylist = async (tracks: SearchTrack[]) => {
    if (!tracks || tracks.length === 0) return;
    const title = `Queue Mix (${tracks.length} songs)`;
    try {
      if (typeof client.createEditablePlaylistWithTracks === 'function') {
        await client.createEditablePlaylistWithTracks(title, tracks);
      } else {
        const created = await client.createEditablePlaylist(title);
        for (const t of tracks) {
          await client.addTrackToPlaylist(created.id, t);
        }
      }
      showToast(`Saved "${title}" to Playlists!`);
    } catch (err: any) {
      showToast(err?.message ?? 'Failed to save queue as playlist');
    }
  };

  // Format status badge text
  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return 'Reconnecting';
      case 'checking':
        return 'Checking';
      case 'requesting_code':
      case 'awaiting_approval':
        return 'Pairing...';
      case 'error':
        return 'Connection Error';
      case 'unpaired':
      default:
        return 'Unpaired';
    }
  };

  const isPairingScreenVisible = status === 'unpaired' || showSettingsModal;
  const isPlaying = trackState === 1 && !player?.isPaused;
  const miniArtwork =
    video?.coverUrl ??
    (video?.thumbnails && video.thumbnails.length > 0
      ? video.thumbnails[video.thumbnails.length - 1]?.url
      : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', width: '100%', overflow: 'hidden' }}>
      {/* Top Header Bar */}
      <header className="app-header">
        <div
          className="app-brand"
          onClick={() => navigateToTab('now_playing')}
          style={{ cursor: 'pointer' }}
        >
          <img
            src="/assets/tubify-logo.png"
            alt=""
            className="app-brand-logo"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          <span>Tub</span>
          <span className="logo-accent">ify</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className={`status-badge ${status}`}
            onClick={() => setShowSettingsModal(true)}
            aria-label={`Connection status: ${getStatusText()}. Tap to configure.`}
            title={`${profile.host}:${profile.port} (${getStatusText()}) - Tap to configure`}
            style={{ cursor: 'pointer', background: 'none', border: '1px solid var(--border-subtle)' }}
          >
            <span className="status-dot" />
            <span>{getStatusText()}</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowSettingsModal(true)}
            aria-label="Settings / Connection"
            title="Configure Connection"
            style={{ height: 32, padding: '0 10px', fontSize: '0.8rem' }}
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        {isPairingScreenVisible ? (
          <div className="tab-view" style={{ justifyContent: 'center' }}>
            <PairingView
              status={status}
              pairingCode={pairingCode}
              error={error}
              initialHost={profile.host}
              initialPort={profile.port}
              onStartPairing={startPairing}
              onCancel={cancelPairing}
              onClose={status === 'connected' ? () => setShowSettingsModal(false) : undefined}
              isModal={showSettingsModal && status === 'connected'}
            />
          </div>
        ) : (
          <>
            {activeTab === 'now_playing' && (
              <NowPlayingView
                video={video}
                player={player}
                trackState={trackState}
                interpolatedProgress={interpolatedProgress}
                durationSeconds={durationSeconds}
                volume={volume}
                isMuted={isMuted}
                isShuffleActive={isShuffleActive}
                repeatModeValue={repeatModeValue}
                onPlayPause={playPause}
                onNext={next}
                onPrevious={previous}
                onSeek={seekTo}
                onShuffle={shuffle}
                onRepeatMode={repeatMode}
                onToggleLike={toggleLike}
                onToggleDislike={toggleDislike}
                onSetVolume={setVolume}
                onStepVolume={stepVolume}
                onToggleMute={toggleMute}
                onAddToPlaylist={() => {
                  if (video) {
                    setTrackForPlaylistModal({
                      videoId: video.id,
                      title: video.title,
                      artist: video.author,
                      album: video.album ?? undefined,
                      duration: video.durationSeconds
                        ? `${Math.floor(video.durationSeconds / 60)}:${String(Math.floor(video.durationSeconds % 60)).padStart(2, '0')}`
                        : undefined,
                      thumbnailUrl: video.coverUrl ?? (video.thumbnails?.[video.thumbnails.length - 1]?.url),
                    });
                  }
                }}
              />
            )}

            {activeTab === 'queue' && (
              <QueueView
                queue={activeQueue}
                onPlayIndex={playQueueIndex}
                onAddToPlaylist={(track) => setTrackForPlaylistModal(track)}
                onPlayNext={playNext}
                onPlayLast={playLast}
                onReorderQueue={reorderQueue}
                onRemoveFromQueue={removeFromQueue}
                onSaveQueueAsPlaylist={handleSaveQueueAsPlaylist}
                hasQueueOverride={hasQueueOverride}
                onClearQueueOverride={clearQueueOverride}
              />
            )}

            {activeTab === 'search' && (
              <SearchView
                client={client}
                onPlayTrack={(track) => changeVideo(track.videoId)}
                onPlayDirectVideo={(videoId, playlistId) => changeVideo(videoId, playlistId)}
                onAddToPlaylist={(track) => setTrackForPlaylistModal(track)}
                onPlayNext={playNext}
                onPlayLast={playLast}
              />
            )}

            {activeTab === 'playlists' && (
              <PlaylistsView
                client={client}
                onPlayTrack={(track) => changeVideo(track.videoId)}
                onPlayCustomPlaylist={(tracks, startIndex) => playCustomPlaylist(tracks, startIndex)}
                onPlayDesktopPlaylist={(playlistId) => changeVideo(null, playlistId)}
                onPlayNext={playNext}
                onPlayLast={playLast}
                activeQueueTracks={activeQueueTracks}
              />
            )}

            {activeTab === 'lyrics' && (
              <LyricsView
                video={video}
                currentTime={interpolatedProgress}
                isPlaying={trackState === 1}
                onSeek={seekTo}
              />
            )}
          </>
        )}
      </main>

      {/* Persistent Floating Mini-Player Bar when on non-Now-Playing tabs */}
      {!isPairingScreenVisible && activeTab !== 'now_playing' && video && (
        <div
          className="mini-player-bar"
          onClick={() => navigateToTab('now_playing')}
          role="region"
          aria-label="Mini Player"
          data-testid="mini-player-bar"
        >
          {miniArtwork ? (
            <img src={miniArtwork} alt="" className="mini-player-art" />
          ) : (
            <div className="mini-player-art mini-player-art-fallback">🎵</div>
          )}

          <div className="mini-player-info">
            <div className="mini-player-title">{video.title}</div>
            <div className="mini-player-artist">{video.author}</div>
          </div>

          <div
            className="mini-player-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="mini-player-btn"
              onClick={playPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="mini-player-btn"
              onClick={next}
              aria-label="Next Track"
              title="Next"
            >
              ⏭
            </button>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar with 5 Tabs */}
      <nav className="bottom-nav" aria-label="Main Navigation">
        <button
          type="button"
          className={`nav-item ${activeTab === 'now_playing' ? 'active' : ''}`}
          onClick={() => navigateToTab('now_playing')}
          aria-label="Now Playing"
        >
          <span className="nav-icon">🎵</span>
          <span>Now Playing</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => navigateToTab('queue')}
          aria-label="Queue"
        >
          <span className="nav-icon">📋</span>
          <span>Queue</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => navigateToTab('search')}
          aria-label="Search"
        >
          <span className="nav-icon">🔍</span>
          <span>Search</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'playlists' ? 'active' : ''}`}
          onClick={() => navigateToTab('playlists')}
          aria-label="Playlists"
        >
          <span className="nav-icon">📚</span>
          <span>Playlists</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'lyrics' ? 'active' : ''}`}
          onClick={() => navigateToTab('lyrics')}
          aria-label="Lyrics"
        >
          <span className="nav-icon">🎤</span>
          <span>Lyrics</span>
        </button>
      </nav>

      {/* Global Add to Playlist Modal */}
      {trackForPlaylistModal && (
        <AddToPlaylistModal
          track={trackForPlaylistModal}
          client={client}
          onClose={() => setTrackForPlaylistModal(null)}
          onSuccess={(playlistTitle) => {
            setTrackForPlaylistModal(null);
            showToast(`Added to "${playlistTitle}"!`);
          }}
        />
      )}

      {/* Global Toast Notification Banner */}
      {toastMessage && (
        <div className="toast-container" role="status" aria-live="polite">
          <span>✅</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
