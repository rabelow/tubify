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
  const isAdvancingRef = useRef<boolean>(false);
  const lastAdvancedIdRef = useRef<string | null>(null);
  const volumeRef = useRef<number>(50);

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

  // Sync state received from Socket.IO or REST
  const handleStateUpdate = useCallback((newState: CompanionState) => {
    if (!newState) return;
    setState(newState);

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

    // Check custom playlist auto-advance
    if (customQueueRef.current && newState.video && newState.player) {
      const duration = newState.video.durationSeconds || 0;
      const progress = newState.player.videoProgress || 0;
      const isEnded = (duration > 0 && progress >= duration - 1.5) ||
        (newState.player.trackState === 0 && progress >= duration - 2 && duration > 0);

      if (isEnded && !isAdvancingRef.current && newState.video.id !== lastAdvancedIdRef.current) {
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
  }, []);

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
      } catch (err: any) {
        if (isCancelledRef.current || !clientRef.current.token) return;
        console.warn('[tubify:companion] Auto-connect failed:', err?.message || err);
        // If 401 Unauthorized, token was revoked on desktop
        if (err?.message?.includes('401') || err?.message?.includes('UNAUTHORIZED')) {
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

  // Mount effect: auto-connect if configured
  useEffect(() => {
    isCancelledRef.current = false;
    if (autoConnect && profile.token) {
      connectWithProfile(profile);
    } else if (!profile.token) {
      setStatus('unpaired');
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

        // Persist profile
        const newProfile = saveConnectionProfile({
          host: targetHost,
          port: targetPort,
          token: tokenRes.token,
        });
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
    const clean = loadConnectionProfile();
    setProfile(clean);
    clientRef.current.token = null;
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
    return clientRef.current.next();
  }, []);

  const previous = useCallback(async () => {
    return clientRef.current.previous();
  }, []);

  const seekTo = useCallback(async (seconds: number) => {
    const clamped = Math.max(0, Math.floor(seconds));
    setInterpolatedProgress(clamped);
    return clientRef.current.seekTo(clamped);
  }, []);

  const shuffle = useCallback(async () => {
    return clientRef.current.shuffle();
  }, []);

  const repeatMode = useCallback(async (mode?: 0 | 1 | 2) => {
    if (mode !== undefined) {
      return clientRef.current.repeatMode(mode);
    }
    const current = (state?.player?.repeatType ?? 0) as number;
    const nextMode = (((current + 1) % 3) as 0 | 1 | 2);
    return clientRef.current.repeatMode(nextMode);
  }, [state?.player?.repeatType]);

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
  // Queue & Video Navigation
  // --------------------------------------------------------------------------

  const playQueueIndex = useCallback(async (index: number) => {
    return clientRef.current.playQueueIndex(index);
  }, []);

  const changeVideo = useCallback(
    async (videoId?: string | null, playlistId?: string | null) => {
      return clientRef.current.changeVideo(videoId, playlistId);
    },
    []
  );

  // --------------------------------------------------------------------------
  // Custom Playlist Runner
  // --------------------------------------------------------------------------

  const playCustomPlaylist = useCallback(
    async (tracks: SearchTrack[], startIndex = 0) => {
      if (!tracks || tracks.length === 0) return;
      const validIndex = Math.max(0, Math.min(tracks.length - 1, startIndex));
      isAdvancingRef.current = false;
      lastAdvancedIdRef.current = null;
      customQueueRef.current = { tracks, index: validIndex };
      setCustomQueue(tracks);
      setCustomQueueIndex(validIndex);

      const target = tracks[validIndex];
      await clientRef.current.changeVideo(target.videoId);
    },
    []
  );

  const stopCustomPlaylist = useCallback(() => {
    isAdvancingRef.current = false;
    lastAdvancedIdRef.current = null;
    customQueueRef.current = null;
    setCustomQueue(null);
    setCustomQueueIndex(0);
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

    customQueue,
    customQueueIndex,
    playCustomPlaylist,
    stopCustomPlaylist,
  };
}
