/**
 * Tubify Main Application Shell
 * 
 * Features:
 * 1. Top connection status header with status dot & host indicator
 * 2. Persistent 5-tab bottom navigation bar:
 *    - Now Playing
 *    - Queue
 *    - Search
 *    - Playlists
 *    - Lyrics
 * 3. Pairing modal overlay when unpaired or when tapping settings
 * 4. NowPlayingView integration with useCompanion
 * 5. Clean modular tab switching
 */

import React, { useState, useRef } from 'react';
import { useCompanion } from './hooks/useCompanion';
import { PairingView } from './components/PairingView';
import { NowPlayingView } from './components/NowPlayingView';
import { QueueView } from './components/QueueView';
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

  const showToast = (message: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

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
    playCustomPlaylist,
  } = companion;

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', width: '100%', overflow: 'hidden' }}>
      {/* Top Header Bar */}
      <header className="app-header">
        <div className="app-brand">
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
                queue={state?.queue ?? player?.queue ?? undefined}
                onPlayIndex={playQueueIndex}
                onAddToPlaylist={(track) => setTrackForPlaylistModal(track)}
              />
            )}

            {activeTab === 'search' && (
              <SearchView
                client={client}
                onPlayTrack={(track) => changeVideo(track.videoId)}
                onPlayDirectVideo={(videoId, playlistId) => changeVideo(videoId, playlistId)}
                onAddToPlaylist={(track) => setTrackForPlaylistModal(track)}
              />
            )}

            {activeTab === 'playlists' && (
              <PlaylistsView
                client={client}
                onPlayTrack={(track) => changeVideo(track.videoId)}
                onPlayCustomPlaylist={(tracks, startIndex) => playCustomPlaylist(tracks, startIndex)}
                onPlayDesktopPlaylist={(playlistId) => changeVideo(null, playlistId)}
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

      {/* Bottom Navigation Bar with 5 Tabs */}
      <nav className="bottom-nav" aria-label="Main Navigation">
        <button
          type="button"
          className={`nav-item ${activeTab === 'now_playing' ? 'active' : ''}`}
          onClick={() => {
            setShowSettingsModal(false);
            setActiveTab('now_playing');
          }}
          aria-label="Now Playing"
        >
          <span className="nav-icon">🎵</span>
          <span>Now Playing</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => {
            setShowSettingsModal(false);
            setActiveTab('queue');
          }}
          aria-label="Queue"
        >
          <span className="nav-icon">📋</span>
          <span>Queue</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => {
            setShowSettingsModal(false);
            setActiveTab('search');
          }}
          aria-label="Search"
        >
          <span className="nav-icon">🔍</span>
          <span>Search</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'playlists' ? 'active' : ''}`}
          onClick={() => {
            setShowSettingsModal(false);
            setActiveTab('playlists');
          }}
          aria-label="Playlists"
        >
          <span className="nav-icon">📚</span>
          <span>Playlists</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'lyrics' ? 'active' : ''}`}
          onClick={() => {
            setShowSettingsModal(false);
            setActiveTab('lyrics');
          }}
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
