/**
 * Tubify Core Companion Types & Contracts
 * 
 * Encompasses YTMDesktop v2 Companion Server protocols, local search & playlist entities,
 * LRCLIB karaoke lyrics, and client persistence interfaces.
 */

// ============================================================================
// 1. Connection & Persistence
// ============================================================================

export interface ConnectionProfile {
  /** Target Windows PC LAN IP address or Tailscale IP (defaults to 192.168.0.144) */
  host: string;
  /** YTMDesktop Companion Server port (defaults to 9863) */
  port: number;
  /** Tubify local search/playlists API port on the same PC (defaults to 5173) */
  apiPort: number;
  /** Alphanumeric client identifier registered with YTMDesktop (default: "tubify") */
  appId: string;
  /** 512-hex token granted upon desktop approval; null when unpaired */
  token: string | null;
  /** ISO-8601 UTC timestamp of the last successful connection */
  lastConnected?: string;
}

/** Profile guaranteed to have an authenticated token */
export interface PairedConnectionProfile extends ConnectionProfile {
  token: string;
}

/** Type guard to assert whether a profile is authenticated */
export function isPairedProfile(profile: ConnectionProfile): profile is PairedConnectionProfile {
  return typeof profile.token === 'string' && profile.token.trim().length > 0;
}

export type ConnectionStatus =
  | 'unpaired'
  | 'checking'
  | 'requesting_code'
  | 'awaiting_approval'
  | 'connected'
  | 'reconnecting'
  | 'error';

// ============================================================================
// 2. Upstream YTMDesktop Enums & Primitive Types
// ============================================================================

/**
 * YouTube Music Player Track State:
 * -1 = Unknown, 0 = Paused, 1 = Playing, 2 = Buffering
 */
export type TrackState = -1 | 0 | 1 | 2;

/**
 * Repeat Mode:
 * -1 = Unknown, 0 = None, 1 = All, 2 = One
 */
export type RepeatMode = -1 | 0 | 1 | 2;

/**
 * Like Status (Numeric):
 * -1 = Unknown, 0 = Dislike, 1 = Indifferent, 2 = Like
 */
export type LikeStatus = -1 | 0 | 1 | 2;

/** Like Status (String representation used by certain UI controls) */
export type LikeStatusString = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';

/**
 * Video Category Type:
 * -1 = Unknown, 0 = ATV (Audio Track Video), 1 = OMV/UGC (Music Video), 2 = Privately Owned, 3 = Podcast
 */
export type VideoType = -1 | 0 | 1 | 2 | 3;

export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

// ============================================================================
// 3. Playback Metadata & Queue Entities
// ============================================================================

export interface VideoMetadata {
  /** YouTube 11-character video ID */
  id: string;
  /** Song title */
  title: string;
  /** Primary artist or channel name */
  author: string;
  /** Album title (null if single or unassigned) */
  album: string | null;
  /** Total track duration in seconds */
  durationSeconds: number;
  /** Primary cover image URL (convenience helper extracted from highest thumbnail) */
  coverUrl?: string;
  /** Raw artwork array supplied by YTMDesktop */
  thumbnails?: Thumbnail[];
  /** YouTube Channel ID */
  channelId?: string;
  /** YouTube Album browse ID */
  albumId?: string | null;
  /** Current like status */
  likeStatus?: LikeStatus | LikeStatusString | null;
  /** Whether the stream is a live broadcast */
  isLive?: boolean;
  /** Media type classification */
  videoType?: VideoType;
  /** Whether upstream has finished populating track metadata */
  metadataFilled?: boolean;
}

export interface QueueItem {
  /** 0-based sequential display index assigned by Tubify */
  index?: number;
  /** Unique client-side identifier for unified queue tracking & reordering */
  queueId?: string;
  /** Origin of this queue entry ('desktop' | 'play-next' | 'play-last' | 'custom') */
  source?: 'desktop' | 'play-next' | 'play-last' | 'custom';
  /** Original index in YTMDesktop's native queue if applicable */
  nativeIndex?: number;
  /** Track title */
  title: string;
  /** Artist / author name */
  author: string;
  /** Human-readable duration string (e.g. "3:42") */
  duration: string;
  /** True if this track is the currently playing item */
  selected: boolean;
  /** YouTube 11-character video ID if available */
  videoId?: string;
  /** Artwork thumbnails */
  thumbnails?: Thumbnail[] | any[];
  /** Alternate counterparts for the song (e.g. video vs audio) */
  counterparts?: QueueItem[] | null;
}

export interface QueueState {
  /** Active user-queued or playlist tracks */
  items: QueueItem[];
  /** YouTube Music algorithmic recommendations appended after items */
  automixItems: QueueItem[];
  /** Index of the active item in items (or -1 if playing from automix) */
  selectedItemIndex: number;
  /** Autoplay status */
  autoplay?: boolean;
  /** Whether recommendations are currently generating */
  isGenerating?: boolean;
  /** Infinite queue indicator */
  isInfinite?: boolean;
  /** Queue repeat mode */
  repeatMode?: RepeatMode;
}

/** Alias for QueueState */
export type PlayerQueue = QueueState;

export interface PlayerState {
  /** Playback state (-1 Unknown, 0 Paused, 1 Playing, 2 Buffering) */
  trackState: TrackState;
  /** Authoritative playback progress in seconds (float) */
  videoProgress: number;
  /** Audio volume percentage (integer 0..100) */
  volume: number;
  /** Mute status */
  muted?: boolean;
  /** True when an advertisement is currently playing */
  adPlaying?: boolean;
  /** Playback queue state */
  queue?: QueueState | null;

  // Normalized convenience properties (for UI rendering & remote volume controls)
  /** Whether a song is currently loaded */
  hasSong?: boolean;
  /** Convenience boolean for trackState === 0 */
  isPaused?: boolean;
  /** Alias for volume */
  volumePercent?: number;
  /** Alias for videoProgress */
  seekbarCurrentPosition?: number;
  /** Playback progress represented as a percentage (0..100) */
  statePercent?: number;
  /** String format like status ('LIKE' | 'DISLIKE' | 'INDIFFERENT') */
  likeStatus?: LikeStatusString | LikeStatus | null;
  /** Repeat type enum (0 None, 1 All, 2 One) */
  repeatType?: 0 | 1 | 2 | RepeatMode;
}

export interface CompanionState {
  /** Authoritative player state */
  player: PlayerState;
  /** Metadata of the active song (null if stopped/empty) */
  video: VideoMetadata | null;
  /** Active native YouTube Music playlist ID if any */
  playlistId?: string | null;
  /** Convenience shortcut to player.queue */
  queue?: QueueState | null;
  /** Convenience shortcut to player.trackState */
  trackState?: TrackState | number;
}

// ============================================================================
// 4. In-App Search & Editable Playlists Entities
// ============================================================================

export interface SearchTrack {
  /** YouTube 11-character video ID */
  videoId: string;
  /** Song title */
  title: string;
  /** Artist name */
  artist: string;
  /** Album title if available */
  album?: string;
  /** Formatted duration (e.g. "4:15") */
  duration?: string;
  /** Artwork image URL */
  thumbnailUrl?: string;
}

export interface EditablePlaylist {
  /** Unique playlist identifier (UUID) */
  id: string;
  /** Playlist title */
  title: string;
  /** Playlist name (alias synchronized with title) */
  name: string;
  /** ISO-8601 creation timestamp */
  createdAt?: string;
  /** ISO-8601 last modified timestamp */
  updatedAt: string;
  /** Ordered list of tracks contained in this playlist */
  tracks: SearchTrack[];
}

export interface PlaylistSummary {
  /** Native YouTube Music playlist ID */
  id: string;
  /** Native playlist title */
  title: string;
  /** Optional subtitle (e.g. author or track count from YouTube Music search) */
  subtitle?: string;
  /** Optional cover thumbnail URL */
  thumbnailUrl?: string;
}

// ============================================================================
// 5. Karaoke Synced Lyrics Entities
// ============================================================================

export interface LyricLine {
  /** Timestamp in seconds (parsed from [mm:ss.xx]) */
  timeSeconds: number;
  /** Lyric text for this timestamp */
  text: string;
}

export interface TrackLyrics {
  /** YouTube 11-character video ID */
  videoId: string;
  /** True when synced [mm:ss.xx] lines were found and parsed */
  synced: boolean;
  /** True when track is flagged as an instrumental */
  instrumental: boolean;
  /** Ascending time-sorted array of parsed lyric lines */
  lines: LyricLine[];
  /** Plain text lyrics fallback if synced lyrics are unavailable */
  plainText?: string | null;
}

// ============================================================================
// 6. Pairing & Authentication Wire Contracts
// ============================================================================

export interface MetadataResponse {
  apiVersions: string[];
}

export interface AuthCodeRequest {
  appId: string;
  appName: string;
  appVersion: string;
}

export interface AuthCodeResponse {
  /** 4-digit numeric code e.g. "4821" */
  code: string;
}

export interface AuthTokenRequest {
  appId: string;
  /** 4-digit code generated in Step 1 */
  code: string;
}

export interface AuthTokenResponse {
  /** 512-hex auth token granted upon desktop approval */
  token: string;
}

export interface AuthErrorResponse {
  statusCode: number;
  code: string;
  error?: string;
  message: string;
}

// ============================================================================
// 7. Companion Command Catalog & Payloads
// ============================================================================

export type CompanionCommandName =
  | 'playPause'
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'seekTo'
  | 'setVolume'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'unmute'
  | 'repeatMode'
  | 'shuffle'
  | 'playQueueIndex'
  | 'changeVideo'
  | 'toggleLike'
  | 'toggleDislike';

export interface ChangeVideoPayload {
  videoId?: string | null;
  playlistId?: string | null;
}

export interface CommandPayloadMap {
  playPause: undefined;
  play: undefined;
  pause: undefined;
  next: undefined;
  previous: undefined;
  seekTo: number;
  setVolume: number;
  volumeUp: undefined;
  volumeDown: undefined;
  mute: undefined;
  unmute: undefined;
  repeatMode: RepeatMode | 0 | 1 | 2;
  shuffle: undefined;
  playQueueIndex: number;
  changeVideo: ChangeVideoPayload;
  toggleLike: undefined;
  toggleDislike: undefined;
}

export interface CommandRequest<T = any> {
  command: CompanionCommandName | string;
  data?: T;
}
