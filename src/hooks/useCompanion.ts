/**
 * Tubify useCompanion Hook
 * 
 * Orchestrates:
 * 1. Connection lifecycle: unpaired, checking, requesting_code, awaiting_approval, connected, reconnecting, error
 * 2. 2-Step LAN pairing with YTMDesktop companion server
 * 3. Socket.IO /api/v1/realtime state-update subscription
 * 4. 200ms playback progress interpolation loop (while trackState === 1)
 * 5. Remote volume tracking, step buttons (-5%/+5%), and mute toggle
 * 6. Transport control actions and custom playlist queue auto-advance runner
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { CompanionClient } from '../lib/companion-client';
import {
  loadConnectionProfile,
  saveConnectionProfile,
  clearConnectionProfile,
  getDefaultHost,
} from '../lib/storage';
import type {
  CompanionState,
  ConnectionProfile,
  ConnectionStatus,
  PlayerState,
  QueueItem,
  SearchTrack,
  TrackState,
  VideoMetadata,
} from '../types/companion';

export interface UseCompanionOptions {
  autoConnect?: boolean;
}

export interface UseCompanionReturn {
  // Connection state
  status: ConnectionStatus;
  profile: ConnectionProfile;
  pairingCode: string | null;
  error: string | null;

  // Playback state
  state: CompanionState | null;
  video: VideoMetadata | null;
  player: PlayerState | null;
  trackState: TrackState;
  interpolatedProgress: number; // in seconds
  durationSeconds: number; // in seconds
  isShuffleActive: boolean;
  repeatModeValue: 0 | 1 | 2;

  // Dedicated Remote Volume state
  volume: number; // 0..100
  isMuted: boolean;

  // Client instance for custom requests
  client: CompanionClient;

  // Connection actions
  startPairing: (host?: string, port?: number) => Promise<void>;
  cancelPairing: () => void;
  disconnect: () => void;
  reconnect: () => Promise<void>;

  // Transport actions
  playPause: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  shuffle: () => Promise<void>;
  repeatMode: (mode?: 0 | 1 | 2) => Promise<void>;
  toggleLike: () => Promise<void>;
  toggleDislike: () => Promise<void>;

  // Remote Volume actions
  setVolume: (volume: number) => Promise<void>;
  stepVolume: (delta: number) => Promise<void>;
  toggleMute: () => Promise<void>;

  // Queue & Navigation
  playQueueIndex: (index: number) => Promise<void>;
  changeVideo: (videoId?: string | null, playlistId?: string | null) => Promise<void>;
  playNext: (track: SearchTrack | QueueItem) => Promise<void>;
  playLast: (track: SearchTrack | QueueItem) => Promise<void>;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueueOverride: () => void;
  hasQueueOverride: boolean;

  // Custom Playlist Queue Auto-Advance Runner
  customQueue: SearchTrack[] | null;
  customQueueIndex: number;
  playCustomPlaylist: (tracks: SearchTrack[], startIndex?: number) => Promise<void>;
  stopCustomPlaylist: () => void;
}

export function useCompanion(options: UseCompanionOptions = {}): UseCompanionReturn {
  const { autoConnect = true } = options;

  // Persisted connection profile
  const [profile, setProfile] = useState<ConnectionProfile>(() => loadConnectionProfile());

  // Connection lifecycle status
  const [status, setStatus] = useState<ConnectionStatus>(() => {
    return profile.token ? 'checking' : 'unpaired';
  });

  // Pairing 4-digit numeric code
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  // Error message banner
  const [error, setError] = useState<string | null>(null);

  // Authoritative state from YTMDesktop
  const [state, setState] = useState<CompanionState | null>(null);

  // Progress interpolation state (updated every 200ms during playback)
  const [interpolatedProgress, setInterpolatedProgress] = useState<number>(0);

  // Dedicated Remote Volume state (0..100)
  const [volume, setVolumeState] = useState<number>(50);
  const [isMuted, setIsMutedState] = useState<boolean>(false);

  // Shuffle & Repeat active state
  const [isShuffleActive, setIsShuffleActive] = useState<boolean>(false);
  const [repeatModeValue, setRepeatModeValue] = useState<0 | 1 | 2>(0);

  // Unified Smart Queue override state
  const [hasQueueOverride, setHasQueueOverride] = useState<boolean>(false);

  // Custom playlist runner state
  const [customQueue, setCustomQueue] = useState<SearchTrack[] | null>(null);
  const [customQueueIndex, setCustomQueueIndex] = useState<number>(0);

  // Refs for persistent client and socket across re-renders
  const clientRef = useRef<CompanionClient>(
    new CompanionClient({
      host: profile.host,
      port: profile.port,
      apiPort: profile.apiPort,
      token: profile.token,
    })
  );
  const socketRef = useRef<Socket | null>(null);
  const isCancelledRef = useRef<boolean>(false);
  const customQueueRef = useRef<{ tracks: SearchTrack[]; index: number } | null>(null);
  const queueOverrideRef = useRef<QueueItem[] | null>(null);
  const originPlaylistIdRef = useRef<string | null>(null);
  const isDesktopNativeQueueIntactRef = useRef<boolean>(true);
  const pendingTransitionRef = useRef<{
    videoId: string;
    queueIndex: number;
    expiresAt: number;
  } | null>(null);
  const stateRef = useRef<CompanionState | null>(null);
  const repeatModeRef = useRef<0 | 1 | 2>(0);
  const isAdvancingRef = useRef<boolean>(false);
  const lastAdvancedIdRef = useRef<string | null>(null);
  const volumeRef = useRef<number>(50);

  // Helper to convert any SearchTrack or QueueItem into a normalized QueueItem
  const buildQueueItem = useCallback(
    (
      track: SearchTrack | QueueItem,
      source: 'desktop' | 'play-next' | 'play-last' | 'custom'
    ): QueueItem => {
      let thumbUrl: string | undefined;
      if ('thumbnailUrl' in track && track.thumbnailUrl) {
        thumbUrl = track.thumbnailUrl;
      } else if ('thumbnails' in track && Array.isArray(track.thumbnails) && track.thumbnails.length > 0) {
        const last = track.thumbnails[track.thumbnails.length - 1];
        thumbUrl = typeof last === 'string' ? last : last?.url;
      }
      const author = ('artist' in track ? track.artist : track.author) || 'Unknown Artist';
      return {
        videoId: track.videoId,
        title: track.title || 'Unknown Track',
        author,
        duration: track.duration || '',
        selected: false,
        source,
        queueId: `${source}-${track.videoId || 'item'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        thumbnails: thumbUrl ? [{ url: thumbUrl, width: 300, height: 300 }] : [],
      };
    },
    []
  );

  // Helper to snapshot current effective queue items for Smart Queue mutations
  const getSnapshotQueueItems = useCallback((): QueueItem[] => {
    if (queueOverrideRef.current && queueOverrideRef.current.length > 0) {
      return queueOverrideRef.current.map((item) => ({ ...item }));
    }

    // If a Tubify Custom Playlist is currently active, snapshot its full tracklist
    if (customQueueRef.current && customQueueRef.current.tracks.length > 0) {
      const curIdx = customQueueRef.current.index;
      isDesktopNativeQueueIntactRef.current = false;
      return customQueueRef.current.tracks.map((t, idx) => ({
        ...buildQueueItem(t, 'desktop'),
        selected: idx === curIdx,
        nativeIndex: idx,
        queueId: `custom-${t.videoId || idx}-${idx}`,
      }));
    }

    const rawQueue = stateRef.current?.player?.queue ?? stateRef.current?.queue;
    const rawItems = Array.isArray(rawQueue?.items) ? rawQueue!.items.filter(Boolean) : [];
    const rawAutomix = Array.isArray(rawQueue?.automixItems) ? rawQueue!.automixItems.filter(Boolean) : [];
    const selectedIdx = typeof rawQueue?.selectedItemIndex === 'number' ? rawQueue.selectedItemIndex : -1;
    const combined = [...rawItems, ...rawAutomix];

    if (stateRef.current?.playlistId) {
      originPlaylistIdRef.current = stateRef.current.playlistId;
    }

    if (combined.length > 0) {
      isDesktopNativeQueueIntactRef.current = true;
      const currentVid = stateRef.current?.video?.id;
      let resolvedSelectedIdx = combined.findIndex((item, idx) => Boolean(item?.selected || idx === selectedIdx));
      if (resolvedSelectedIdx < 0 && currentVid) {
        resolvedSelectedIdx = combined.findIndex((item) => item?.videoId === currentVid);
      }
      if (resolvedSelectedIdx < 0) resolvedSelectedIdx = 0;

      return combined.map((item, idx) => ({
        ...item,
        selected: idx === resolvedSelectedIdx,
        source: item.source ?? 'desktop',
        nativeIndex: typeof item.nativeIndex === 'number' ? item.nativeIndex : idx,
        queueId: item.queueId ?? `desktop-${item.videoId || idx}-${idx}`,
      }));
    }

    // Fallback: if desktop has an active video playing but queue.items hasn't populated yet,
    // preserve the currently playing video as item 0 so Play Next / Play Last never interrupts it!
    const currentVideo = stateRef.current?.video;
    if (currentVideo?.id) {
      isDesktopNativeQueueIntactRef.current = true;
      const mins = currentVideo.durationSeconds ? Math.floor(currentVideo.durationSeconds / 60) : 0;
      const secs = currentVideo.durationSeconds ? Math.floor(currentVideo.durationSeconds % 60) : 0;
      const durStr = currentVideo.durationSeconds ? `${mins}:${String(secs).padStart(2, '0')}` : '';
      return [
        {
          videoId: currentVideo.id,
          title: currentVideo.title || 'Unknown Track',
          author: currentVideo.author || 'Unknown Artist',
          duration: durStr,
          selected: true,
          source: 'desktop',
          nativeIndex: 0,
          queueId: `desktop-${currentVideo.id}-0`,
          thumbnails: currentVideo.thumbnails ?? [],
        },
      ];
    }

    return [];
  }, [buildQueueItem]);

  // Helper to apply an updated Smart Queue into state
  const commitQueueOverride = useCallback((updatedItems: QueueItem[]) => {
    queueOverrideRef.current = updatedItems;
    setHasQueueOverride(true);
    const activeIdx = updatedItems.findIndex((i) => i.selected);
    setState((prev) => {
      if (!prev) return prev;
      const nextQueue = {
        ...(prev.player?.queue ?? {}),
        items: updatedItems,
        automixItems: [],
        selectedItemIndex: activeIdx >= 0 ? activeIdx : 0,
      };
      const nextState: CompanionState = {
        ...prev,
        player: {
          ...prev.player,
          queue: nextQueue,
        },
        queue: nextQueue,
      };
      stateRef.current = nextState;
      return nextState;
    });
  }, []);

  // Sync client credentials when profile changes
  useEffect(() => {
    clientRef.current.host = profile.host;
    clientRef.current.port = profile.port;
    clientRef.current.apiPort = profile.apiPort;
    clientRef.current.token = profile.token;
  }, [profile]);

  // Teardown existing socket
  const cleanupSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.off('state-update');
      socketRef.current.off('disconnect');
      socketRef.current.off('connect');
      socketRef.current.off('connect_error');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  // Helper to dispatch playback for a target item in the Smart Queue without breaking the native playlist
  const dispatchSmartQueueItemPlayback = useCallback(
    async (
      targetItem: QueueItem,
      targetIdx: number,
      prevItem: QueueItem | undefined,
      mode: 'next' | 'previous' | 'index' | 'auto'
    ): Promise<void> => {
      if (!targetItem.videoId) return;

      pendingTransitionRef.current = {
        videoId: targetItem.videoId,
        queueIndex: targetIdx,
        expiresAt: Date.now() + 8000,
      };

      if (customQueueRef.current) {
        const matchedIdx = customQueueRef.current.tracks.findIndex(
          (t) => t.videoId === targetItem.videoId
        );
        if (matchedIdx >= 0) {
          customQueueRef.current.index = matchedIdx;
          setCustomQueueIndex(matchedIdx);
        }
      }

      // If the desktop's native playlist/queue is still intact and targetItem is a native desktop item:
      if (
        isDesktopNativeQueueIntactRef.current &&
        targetItem.source === 'desktop' &&
        typeof targetItem.nativeIndex === 'number'
      ) {
        if (
          mode === 'next' &&
          prevItem?.source === 'desktop' &&
          typeof prevItem.nativeIndex === 'number' &&
          targetItem.nativeIndex === prevItem.nativeIndex + 1
        ) {
          return clientRef.current.next();
        }
        if (
          mode === 'previous' &&
          prevItem?.source === 'desktop' &&
          typeof prevItem.nativeIndex === 'number' &&
          targetItem.nativeIndex === prevItem.nativeIndex - 1
        ) {
          return clientRef.current.previous();
        }
        if (mode === 'index') {
          return clientRef.current.playQueueIndex(targetItem.nativeIndex);
        }
      }

      // Playing an inserted track (Play Next / Play Last), custom playlist track, or returning to playlist
      isDesktopNativeQueueIntactRef.current = false;

      if (targetItem.source === 'desktop' && originPlaylistIdRef.current) {
        // Restore original playlist context on YTMDesktop when returning from an inserted track
        return clientRef.current.changeVideo(targetItem.videoId, originPlaylistIdRef.current);
      }

      return clientRef.current.changeVideo(targetItem.videoId);
    },
    []
  );

  // Sync state received from Socket.IO or REST
  const handleStateUpdate = useCallback((newState: CompanionState) => {
    if (!newState) return;

    if (newState.playlistId && isDesktopNativeQueueIntactRef.current) {
      originPlaylistIdRef.current = newState.playlistId;
    }

    // Resolve repeatMode from either player.repeatType or player.queue.repeatMode
    const rawRepeat =
      newState.player?.repeatType !== undefined && newState.player.repeatType >= 0
        ? (newState.player.repeatType as 0 | 1 | 2)
        : newState.player?.queue?.repeatMode !== undefined && newState.player.queue.repeatMode >= 0
          ? (newState.player.queue.repeatMode as 0 | 1 | 2)
          : repeatModeRef.current;

    repeatModeRef.current = rawRepeat;
    setRepeatModeValue(rawRepeat);

    // If Smart Queue override is active, keep unified queue intact and synchronize active pointer
    let effectiveState: CompanionState = {
      ...newState,
      player: {
        ...newState.player,
        repeatType: rawRepeat,
      },
    };

    if (queueOverrideRef.current && queueOverrideRef.current.length > 0) {
      const currentVid = newState.video?.id;
      let activeIdx = queueOverrideRef.current.findIndex((i) => i.selected);
      if (activeIdx < 0) activeIdx = 0;
      const expectedItem = queueOverrideRef.current[activeIdx];

      const pending = pendingTransitionRef.current;
      if (pending && Date.now() < pending.expiresAt) {
        if (currentVid && currentVid === pending.videoId) {
          // Desktop finished loading the track we requested
          activeIdx = pending.queueIndex;
          pendingTransitionRef.current = null;
          isAdvancingRef.current = false;
          queueOverrideRef.current = queueOverrideRef.current.map((item, idx) => ({
            ...item,
            selected: idx === activeIdx,
          }));
        } else {
          // Still transitioning; ignore stale videoId from previous track so we never revert selection
          activeIdx = pending.queueIndex;
        }
      } else {
        pendingTransitionRef.current = null;

        if (currentVid && expectedItem?.videoId && currentVid !== expectedItem.videoId) {
          const nextIdx = activeIdx + 1;
          const nextItem = queueOverrideRef.current[nextIdx];

          if (nextItem && nextItem.videoId === currentVid) {
            // Desktop naturally advanced to the exact next item in our Smart Queue
            activeIdx = nextIdx;
            queueOverrideRef.current = queueOverrideRef.current.map((item, idx) => ({
              ...item,
              selected: idx === activeIdx,
            }));
          } else if (
            nextItem &&
            nextItem.videoId &&
            (nextItem.source === 'play-next' ||
              nextItem.source === 'play-last' ||
              !isDesktopNativeQueueIntactRef.current) &&
            !isAdvancingRef.current &&
            lastAdvancedIdRef.current !== expectedItem.videoId
          ) {
            // Desktop finished expectedItem and jumped to its own track or random autoplay instead of nextItem!
            // Intercept immediately so Play Next / Play Last and playlist continuation work seamlessly.
            isAdvancingRef.current = true;
            lastAdvancedIdRef.current = expectedItem.videoId;
            activeIdx = nextIdx;
            queueOverrideRef.current = queueOverrideRef.current.map((item, idx) => ({
              ...item,
              selected: idx === activeIdx,
            }));
            dispatchSmartQueueItemPlayback(nextItem, nextIdx, expectedItem, 'auto').catch((err) => {
              console.error('[tubify:companion] Smart queue transition intercept failed:', err);
              isAdvancingRef.current = false;
            });
          } else {
            const matchedIdx = queueOverrideRef.current.findIndex((i) => i.videoId === currentVid);
            if (matchedIdx >= 0) {
              activeIdx = matchedIdx;
              queueOverrideRef.current = queueOverrideRef.current.map((item, idx) => ({
                ...item,
                selected: idx === activeIdx,
              }));
            }
          }
        }
      }

      const nextQueue = {
        ...(newState.player?.queue ?? {}),
        items: queueOverrideRef.current,
        automixItems: [],
        selectedItemIndex: activeIdx,
        repeatMode: rawRepeat,
      };
      effectiveState = {
        ...effectiveState,
        player: {
          ...effectiveState.player,
          queue: nextQueue,
        },
        queue: nextQueue,
      };
    }

    stateRef.current = effectiveState;
    setState(effectiveState);

    // Synchronize volume
    if (newState.player?.volume !== undefined) {
      setVolumeState(newState.player.volume);
      volumeRef.current = newState.player.volume;
    } else if (newState.player?.volumePercent !== undefined) {
      setVolumeState(newState.player.volumePercent);
      volumeRef.current = newState.player.volumePercent;
    }

    // Synchronize mute status
    if (newState.player?.muted !== undefined) {
      setIsMutedState(Boolean(newState.player.muted));
    }

    // Synchronize progress
    const authProgress = newState.player?.videoProgress ?? newState.player?.seekbarCurrentPosition;
    if (typeof authProgress === 'number' && Number.isFinite(authProgress)) {
      setInterpolatedProgress((prev) => {
        // Re-align if drift is noticeable (> 0.8s) or on new track
        const diff = Math.abs(prev - authProgress);
        return diff > 0.8 ? authProgress : prev;
      });
    }

    // Unlock auto-advance when a new track starts playing
    if (newState.video?.id && lastAdvancedIdRef.current && newState.video.id !== lastAdvancedIdRef.current) {
      isAdvancingRef.current = false;
    }

    // Check custom playlist OR Smart Queue auto-advance on track end
    if (newState.video && newState.player && !pendingTransitionRef.current) {
      const duration = newState.video.durationSeconds || 0;
      const progress = newState.player.videoProgress || 0;
      const isEnded =
        (duration > 0 && progress >= duration - 1.5) ||
        (newState.player.trackState === 0 && progress >= duration - 2 && duration > 0);

      if (isEnded && !isAdvancingRef.current && newState.video.id !== lastAdvancedIdRef.current) {
        if (queueOverrideRef.current && queueOverrideRef.current.length > 0) {
          const curIdx = queueOverrideRef.current.findIndex((i) => i.selected);
          const nextIdx = curIdx + 1;
          if (curIdx >= 0 && nextIdx < queueOverrideRef.current.length) {
            const curItem = queueOverrideRef.current[curIdx];
            const nextItem = queueOverrideRef.current[nextIdx];
            const isSequentialNativeTransition =
              isDesktopNativeQueueIntactRef.current &&
              curItem?.source === 'desktop' &&
              nextItem?.source === 'desktop' &&
              typeof curItem.nativeIndex === 'number' &&
              typeof nextItem.nativeIndex === 'number' &&
              nextItem.nativeIndex === curItem.nativeIndex + 1;

            if (nextItem?.videoId && !isSequentialNativeTransition) {
              isAdvancingRef.current = true;
              lastAdvancedIdRef.current = newState.video.id || null;
              const updated = queueOverrideRef.current.map((item, idx) => ({
                ...item,
                selected: idx === nextIdx,
              }));
              commitQueueOverride(updated);
              dispatchSmartQueueItemPlayback(nextItem, nextIdx, curItem, 'auto').catch((err) => {
                console.error('[tubify:companion] Smart queue auto-advance failed:', err);
                isAdvancingRef.current = false;
              });
            }
          }
        } else if (customQueueRef.current) {
          const nextIdx = customQueueRef.current.index + 1;
          if (nextIdx < customQueueRef.current.tracks.length) {
            isAdvancingRef.current = true;
            lastAdvancedIdRef.current = newState.video.id || null;
            customQueueRef.current.index = nextIdx;
            setCustomQueueIndex(nextIdx);
            const nextTrack = customQueueRef.current.tracks[nextIdx];
            clientRef.current.changeVideo(nextTrack.videoId).catch((err) => {
              console.error('[tubify:companion] Auto-advance failed:', err);
              isAdvancingRef.current = false;
            });
          }
        }
      }
    }
  }, [commitQueueOverride, dispatchSmartQueueItemPlayback]);

  // Connect Socket.IO realtime
  const establishRealtime = useCallback(
    (host: string, port: number, token: string) => {
      cleanupSocket();

      try {
        const socket = clientRef.current.connectRealtime(
          host,
          port,
          token,
          (updatedState) => {
            setStatus('connected');
            setError(null);
            handleStateUpdate(updatedState);
          },
          (reason) => {
            console.warn('[tubify:companion] Socket disconnected:', reason);
            if (reason === 'io server disconnect') {
              // Server disconnected client, token might be invalid
              setStatus('reconnecting');
            } else {
              setStatus('reconnecting');
            }
          }
        );

        socket.on('connect', () => {
          setStatus('connected');
          setError(null);
        });

        socket.on('connect_error', (err: any) => {
          console.warn('[tubify:companion] Socket connect error:', err?.message || err);
          setStatus('reconnecting');
        });

        socketRef.current = socket;
      } catch (err: any) {
        console.error('[tubify:companion] Failed to establish Socket.IO:', err);
        setStatus('error');
        setError(err?.message || 'Failed to connect to real-time socket');
      }
    },
    [cleanupSocket, handleStateUpdate]
  );

  // Attempt connection with saved profile
  const connectWithProfile = useCallback(
    async (prof: ConnectionProfile) => {
      if (!prof.token) {
        setStatus('unpaired');
        return;
      }

      setStatus('checking');
      setError(null);

      try {
        // Step 1: Verify server metadata reachability
        await clientRef.current.checkMetadata(prof.host, prof.port);
        if (isCancelledRef.current || !clientRef.current.token) return;

        // Step 2: Fetch initial state snapshot
        const initial = await clientRef.current.getState(prof.token, prof.host, prof.port);
        if (isCancelledRef.current || !clientRef.current.token) return;

        handleStateUpdate(initial);

        // Step 3: Establish Socket.IO real-time stream
        establishRealtime(prof.host, prof.port, prof.token);
        setStatus('connected');

        // Persist working authorization to the shared server vault so other devices (browser/APK) share it
        clientRef.current
          .saveSharedSession?.({
            host: prof.host,
            port: prof.port,
            token: prof.token,
          })
          ?.catch?.(() => {});
      } catch (err: any) {
        if (isCancelledRef.current || !clientRef.current.token) return;
        console.warn('[tubify:companion] Auto-connect failed:', err?.message || err);
        // If 401 Unauthorized, check if another device saved a newer token in the shared session vault first
        if (err?.message?.includes('401') || err?.message?.includes('UNAUTHORIZED')) {
          try {
            const shared = await clientRef.current.getSharedSession?.();
            if (!isCancelledRef.current && shared?.token && shared.token !== prof.token) {
              const recovered = saveConnectionProfile({
                host: shared.host || prof.host,
                port: shared.port || prof.port,
                token: shared.token,
              });
              clientRef.current.host = recovered.host;
              clientRef.current.port = recovered.port;
              clientRef.current.token = recovered.token;
              setProfile(recovered);
              const initial = await clientRef.current.getState(
                shared.token,
                recovered.host,
                recovered.port
              );
              if (isCancelledRef.current) return;
              handleStateUpdate(initial);
              establishRealtime(recovered.host, recovered.port, shared.token);
              setStatus('connected');
              setError(null);
              return;
            }
          } catch {
            // Shared token also failed; proceed to clear
          }
          clearConnectionProfile();
          setProfile(loadConnectionProfile());
          setStatus('unpaired');
          setError('Authorization revoked or expired on desktop. Please pair again.');
        } else {
          setStatus('error');
          setError(
            err?.message ||
              `Could not reach YTMDesktop at http://${prof.host}:${prof.port}. Verify YTMDesktop is open and Companion Server is enabled.`
          );
        }
      }
    },
    [establishRealtime, handleStateUpdate]
  );

  // Mount effect: auto-connect if configured, or recover from shared server session vault
  useEffect(() => {
    isCancelledRef.current = false;
    if (autoConnect && profile.token) {
      connectWithProfile(profile);
    } else if (!profile.token) {
      setStatus('unpaired');
      if (autoConnect && typeof clientRef.current.getSharedSession === 'function') {
        clientRef.current
          .getSharedSession()
          .then((shared) => {
            if (isCancelledRef.current || !shared?.token) return;
            const recovered = saveConnectionProfile({
              host: shared.host || profile.host,
              port: shared.port || profile.port,
              token: shared.token,
            });
            clientRef.current.host = recovered.host;
            clientRef.current.port = recovered.port;
            clientRef.current.token = recovered.token;
            setProfile(recovered);
            connectWithProfile(recovered);
          })
          .catch(() => {});
      }
    }

    return () => {
      isCancelledRef.current = true;
      cleanupSocket();
    };
  }, []);

  // 200ms Progress Interpolation Loop (active only when trackState === 1 and not paused/ad)
  useEffect(() => {
    const isPlaying = state?.player?.trackState === 1;
    const isPaused = state?.player?.isPaused || state?.player?.trackState === 0;
    const isAd = Boolean(state?.player?.adPlaying);

    if (!isPlaying || isPaused || isAd) {
      return;
    }

    const interval = setInterval(() => {
      if (isCancelledRef.current) return;
      setInterpolatedProgress((prev) => {
        const maxDuration = state?.video?.durationSeconds ?? Infinity;
        if (prev >= maxDuration) return maxDuration;
        return Number((prev + 0.2).toFixed(2));
      });
    }, 200);

    return () => clearInterval(interval);
  }, [state?.player?.trackState, state?.player?.isPaused, state?.player?.adPlaying, state?.video?.durationSeconds]);

  // --------------------------------------------------------------------------
  // Pairing Flow: 2-Step Protocol
  // --------------------------------------------------------------------------

  const startPairing = useCallback(
    async (inputHost?: string, inputPort?: number) => {
      const targetHost = (inputHost && inputHost.trim()) || profile.host || getDefaultHost();
      const targetPort = inputPort || profile.port || 9863;

      cleanupSocket();
      isCancelledRef.current = false;
      setError(null);
      setStatus('checking');

      try {
        // 1. Probe metadata reachability
        await clientRef.current.checkMetadata(targetHost, targetPort);
      } catch (err: any) {
        if (isCancelledRef.current) return;
        setStatus('error');
        setError(
          `Unable to reach YTMDesktop at http://${targetHost}:${targetPort}. ` +
          `Make sure YTMDesktop is running with Companion Server enabled and your firewall allows port ${targetPort}.`
        );
        return;
      }

      if (isCancelledRef.current) return;

      setStatus('requesting_code');

      let code = '';
      try {
        const codeRes = await clientRef.current.requestCode(targetHost, targetPort, {
          appId: 'tubify',
          appName: 'Tubify Remote',
          appVersion: '1.0.0',
        });
        code = codeRes.code;
      } catch (err: any) {
        if (isCancelledRef.current) return;
        setStatus('error');
        if (err?.message?.includes('Pairing disabled') || err?.message?.includes('AUTHORIZATION_DISABLED')) {
          setError(
            'Pairing disabled: In YTMDesktop on your PC, open Settings -> Integrations -> Companion Server, and click "Request authorization" (or toggle pairing window).'
          );
        } else {
          setError(err?.message || 'Failed to request pairing code from desktop.');
        }
        return;
      }

      if (isCancelledRef.current) return;

      setPairingCode(code);
      setStatus('awaiting_approval');

      try {
        // Await desktop user clicking "Allow" on the Windows dialog (up to 30s)
        const tokenRes = await clientRef.current.requestToken(targetHost, targetPort, {
          appId: 'tubify',
          code,
        });

        if (isCancelledRef.current) return;

        // Persist profile locally & in shared server vault
        const newProfile = saveConnectionProfile({
          host: targetHost,
          port: targetPort,
          token: tokenRes.token,
        });
        clientRef.current
          .saveSharedSession?.({
            host: targetHost,
            port: targetPort,
            token: tokenRes.token,
          })
          ?.catch?.(() => {});
        setProfile(newProfile);
        setPairingCode(null);
        setError(null);

        // Fetch state and connect realtime
        const initial = await clientRef.current.getState(tokenRes.token, targetHost, targetPort);
        handleStateUpdate(initial);
        establishRealtime(targetHost, targetPort, tokenRes.token);
        setStatus('connected');
      } catch (err: any) {
        if (isCancelledRef.current) return;
        setStatus('error');
        setPairingCode(null);
        setError(err?.message || 'Pairing was denied or timed out on desktop.');
      }
    },
    [profile.host, profile.port, cleanupSocket, establishRealtime, handleStateUpdate]
  );

  const cancelPairing = useCallback(() => {
    isCancelledRef.current = true;
    setPairingCode(null);
    setError(null);
    setStatus(profile.token ? 'connected' : 'unpaired');
  }, [profile.token]);

  const disconnect = useCallback(() => {
    isCancelledRef.current = true;
    cleanupSocket();
    clearConnectionProfile();
    clientRef.current.clearSharedSession?.()?.catch?.(() => {});
    const clean = loadConnectionProfile();
    setProfile(clean);
    clientRef.current.token = null;
    stateRef.current = null;
    queueOverrideRef.current = null;
    pendingTransitionRef.current = null;
    isDesktopNativeQueueIntactRef.current = true;
    originPlaylistIdRef.current = null;
    setHasQueueOverride(false);
    setIsShuffleActive(false);
    setRepeatModeValue(0);
    repeatModeRef.current = 0;
    setState(null);
    setVolumeState(50);
    volumeRef.current = 50;
    setIsMutedState(false);
    setInterpolatedProgress(0);
    setPairingCode(null);
    setError(null);
    setStatus('unpaired');
  }, [cleanupSocket]);

  const reconnect = useCallback(async () => {
    isCancelledRef.current = false;
    await connectWithProfile(profile);
  }, [connectWithProfile, profile]);

  // --------------------------------------------------------------------------
  // Transport Actions
  // --------------------------------------------------------------------------

  const playPause = useCallback(async () => {
    return clientRef.current.playPause();
  }, []);

  const play = useCallback(async () => {
    return clientRef.current.play();
  }, []);

  const pause = useCallback(async () => {
    return clientRef.current.pause();
  }, []);

  const next = useCallback(async () => {
    if (queueOverrideRef.current && queueOverrideRef.current.length > 0) {
      const curIdx = queueOverrideRef.current.findIndex((i) => i.selected);
      const nextIdx = curIdx >= 0 ? curIdx + 1 : 0;
      if (nextIdx < queueOverrideRef.current.length) {
        const prevItem = curIdx >= 0 ? queueOverrideRef.current[curIdx] : undefined;
        const nextItem = queueOverrideRef.current[nextIdx];
        const updated = queueOverrideRef.current.map((item, idx) => ({
          ...item,
          selected: idx === nextIdx,
        }));
        commitQueueOverride(updated);
        return dispatchSmartQueueItemPlayback(nextItem, nextIdx, prevItem, 'next');
      }
    }
    return clientRef.current.next();
  }, [commitQueueOverride, dispatchSmartQueueItemPlayback]);

  const previous = useCallback(async () => {
    if (queueOverrideRef.current && queueOverrideRef.current.length > 0) {
      const curIdx = queueOverrideRef.current.findIndex((i) => i.selected);
      if (curIdx > 0) {
        const prevIdx = curIdx - 1;
        const curItem = queueOverrideRef.current[curIdx];
        const prevItem = queueOverrideRef.current[prevIdx];
        const updated = queueOverrideRef.current.map((item, idx) => ({
          ...item,
          selected: idx === prevIdx,
        }));
        commitQueueOverride(updated);
        return dispatchSmartQueueItemPlayback(prevItem, prevIdx, curItem, 'previous');
      }
    }
    return clientRef.current.previous();
  }, [commitQueueOverride, dispatchSmartQueueItemPlayback]);

  const seekTo = useCallback(async (seconds: number) => {
    const clamped = Math.max(0, Math.floor(seconds));
    setInterpolatedProgress(clamped);
    return clientRef.current.seekTo(clamped);
  }, []);

  const shuffle = useCallback(async () => {
    setIsShuffleActive((prev) => !prev);
    return clientRef.current.shuffle();
  }, []);

  const repeatMode = useCallback(
    async (mode?: 0 | 1 | 2) => {
      let targetMode: 0 | 1 | 2;
      if (mode !== undefined) {
        targetMode = mode;
      } else {
        const current =
          state?.player?.repeatType !== undefined && state.player.repeatType >= 0
            ? state.player.repeatType
            : state?.player?.queue?.repeatMode !== undefined && state.player.queue.repeatMode >= 0
              ? state.player.queue.repeatMode
              : repeatModeRef.current;
        targetMode = (((Number(current) + 1) % 3) as 0 | 1 | 2);
      }

      repeatModeRef.current = targetMode;
      setRepeatModeValue(targetMode);
      setState((prev) => {
        if (!prev) return prev;
        const nextState: CompanionState = {
          ...prev,
          player: {
            ...prev.player,
            repeatType: targetMode,
            queue: prev.player?.queue
              ? { ...prev.player.queue, repeatMode: targetMode }
              : prev.player?.queue,
          },
        };
        stateRef.current = nextState;
        return nextState;
      });
      return clientRef.current.repeatMode(targetMode);
    },
    [state?.player?.repeatType, state?.player?.queue?.repeatMode]
  );

  const toggleLike = useCallback(async () => {
    return clientRef.current.toggleLike();
  }, []);

  const toggleDislike = useCallback(async () => {
    return clientRef.current.toggleDislike();
  }, []);

  // --------------------------------------------------------------------------
  // Remote Volume Actions
  // --------------------------------------------------------------------------

  const setVolume = useCallback(async (vol: number) => {
    const clamped = Number.isFinite(vol)
      ? Math.max(0, Math.min(100, Math.round(vol)))
      : (vol === Infinity ? 100 : vol === -Infinity ? 0 : 50);
    volumeRef.current = clamped;
    setVolumeState(clamped);
    return clientRef.current.setVolume(clamped);
  }, []);

  const stepVolume = useCallback(
    async (delta: number) => {
      const nextVol = Math.max(0, Math.min(100, volumeRef.current + delta));
      volumeRef.current = nextVol;
      setVolumeState(nextVol);
      return clientRef.current.setVolume(nextVol);
    },
    []
  );

  const toggleMute = useCallback(async () => {
    const nextMuted = !isMuted;
    setIsMutedState(nextMuted);
    if (nextMuted) {
      return clientRef.current.mute();
    }
    return clientRef.current.unmute();
  }, [isMuted]);

  // --------------------------------------------------------------------------
  // Queue & Video Navigation + Smart Queue (Play Next / Play Last / Reorder)
  // --------------------------------------------------------------------------

  const playQueueIndex = useCallback(
    async (index: number) => {
      if (queueOverrideRef.current && queueOverrideRef.current.length > 0) {
        const curIdx = queueOverrideRef.current.findIndex((i) => i.selected);
        const prevItem = curIdx >= 0 ? queueOverrideRef.current[curIdx] : undefined;
        const target = queueOverrideRef.current[index];
        if (target) {
          const updated = queueOverrideRef.current.map((item, idx) => ({
            ...item,
            selected: idx === index,
          }));
          commitQueueOverride(updated);
          return dispatchSmartQueueItemPlayback(target, index, prevItem, 'index');
        }
      }
      return clientRef.current.playQueueIndex(index);
    },
    [commitQueueOverride, dispatchSmartQueueItemPlayback]
  );

  const changeVideo = useCallback(
    async (videoId?: string | null, playlistId?: string | null) => {
      queueOverrideRef.current = null;
      setHasQueueOverride(false);
      customQueueRef.current = null;
      setCustomQueue(null);
      setCustomQueueIndex(0);
      pendingTransitionRef.current = null;
      isDesktopNativeQueueIntactRef.current = true;
      originPlaylistIdRef.current = playlistId ?? null;
      return clientRef.current.changeVideo(videoId, playlistId);
    },
    []
  );

  const playNext = useCallback(
    async (track: SearchTrack | QueueItem) => {
      const newItem = buildQueueItem(track, 'play-next');
      const items = getSnapshotQueueItems();

      if (items.length === 0) {
        const firstItem: QueueItem = { ...newItem, selected: true };
        commitQueueOverride([firstItem]);
        if (newItem.videoId) {
          await clientRef.current.changeVideo(newItem.videoId);
        }
        return;
      }

      let activeIdx = items.findIndex((i) => i.selected);
      if (activeIdx < 0) activeIdx = 0;

      const updated = [
        ...items.slice(0, activeIdx + 1),
        newItem,
        ...items.slice(activeIdx + 1),
      ];
      commitQueueOverride(updated);
    },
    [buildQueueItem, getSnapshotQueueItems, commitQueueOverride]
  );

  const playLast = useCallback(
    async (track: SearchTrack | QueueItem) => {
      const newItem = buildQueueItem(track, 'play-last');
      const items = getSnapshotQueueItems();

      if (items.length === 0) {
        const firstItem: QueueItem = { ...newItem, selected: true };
        commitQueueOverride([firstItem]);
        if (newItem.videoId) {
          await clientRef.current.changeVideo(newItem.videoId);
        }
        return;
      }

      const updated = [...items, newItem];
      commitQueueOverride(updated);
    },
    [buildQueueItem, getSnapshotQueueItems, commitQueueOverride]
  );

  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      const items = getSnapshotQueueItems();
      if (
        fromIndex < 0 ||
        fromIndex >= items.length ||
        toIndex < 0 ||
        toIndex >= items.length ||
        fromIndex === toIndex
      ) {
        return;
      }
      const updated = [...items];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      commitQueueOverride(updated);
    },
    [getSnapshotQueueItems, commitQueueOverride]
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      const items = getSnapshotQueueItems();
      if (index < 0 || index >= items.length) return;
      const removedItem = items[index];
      const wasSelected = removedItem.selected;
      const updated = items.filter((_, idx) => idx !== index);
      if (wasSelected && updated.length > 0) {
        const nextActive = Math.min(index, updated.length - 1);
        updated[nextActive] = { ...updated[nextActive], selected: true };
        commitQueueOverride(updated);
        dispatchSmartQueueItemPlayback(updated[nextActive], nextActive, removedItem, 'index').catch(
          () => {}
        );
      } else {
        commitQueueOverride(updated);
      }
    },
    [getSnapshotQueueItems, commitQueueOverride, dispatchSmartQueueItemPlayback]
  );

  const clearQueueOverride = useCallback(() => {
    queueOverrideRef.current = null;
    pendingTransitionRef.current = null;
    setHasQueueOverride(false);
  }, []);

  // --------------------------------------------------------------------------
  // Custom Playlist Runner
  // --------------------------------------------------------------------------

  const playCustomPlaylist = useCallback(
    async (tracks: SearchTrack[], startIndex = 0) => {
      if (!tracks || tracks.length === 0) return;
      const validIndex = Math.max(0, Math.min(tracks.length - 1, startIndex));
      isAdvancingRef.current = false;
      lastAdvancedIdRef.current = null;
      isDesktopNativeQueueIntactRef.current = false;
      originPlaylistIdRef.current = null;
      customQueueRef.current = { tracks, index: validIndex };
      setCustomQueue(tracks);
      setCustomQueueIndex(validIndex);

      const queueItems: QueueItem[] = tracks.map((t, idx) => ({
        ...buildQueueItem(t, 'custom'),
        selected: idx === validIndex,
        queueId: `custom-${t.videoId}-${idx}`,
      }));
      commitQueueOverride(queueItems);

      const target = tracks[validIndex];
      pendingTransitionRef.current = {
        videoId: target.videoId,
        queueIndex: validIndex,
        expiresAt: Date.now() + 8000,
      };
      await clientRef.current.changeVideo(target.videoId);
    },
    [buildQueueItem, commitQueueOverride]
  );

  const stopCustomPlaylist = useCallback(() => {
    isAdvancingRef.current = false;
    lastAdvancedIdRef.current = null;
    customQueueRef.current = null;
    setCustomQueue(null);
    setCustomQueueIndex(0);
    queueOverrideRef.current = null;
    pendingTransitionRef.current = null;
    setHasQueueOverride(false);
  }, []);

  // Derived properties
  const video = state?.video ?? null;
  const player = state?.player ?? null;
  const trackState = (player?.trackState ?? -1) as TrackState;
  const durationSeconds = video?.durationSeconds ?? 0;

  return {
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

    client: clientRef.current,

    startPairing,
    cancelPairing,
    disconnect,
    reconnect,

    playPause,
    play,
    pause,
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

    customQueue,
    customQueueIndex,
    playCustomPlaylist,
    stopCustomPlaylist,
  };
}
