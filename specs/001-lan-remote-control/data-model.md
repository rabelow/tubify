# Phase 1 Data Model: Tubify Client, Search, Playlists & Karaoke Lyrics

## 1. Client Persistence Model (`localStorage`)

### `ConnectionProfile`
Stored under key `tubify.connection.v1`.

| Field | Type | Validation / Rules | Description |
|---|---|---|---|
| `host` | `string` | Non-empty IPv4 or hostname (defaults to `window.location.hostname` if not `localhost`, else `192.168.0.144`) | Target Windows PC LAN IP or Tailscale IP |
| `port` | `number` | Integer `1..65535`, default `9863` | YTMDesktop Companion Server port |
| `apiPort` | `number` | Integer `1..65535`, default `5173` | Port for Tubify local search/playlists API on the same Windows host |
| `appId` | `string` | Lowercase alphanumeric `2..32` chars, default `"tubify"` | Identifier bound to the YTMDesktop token |
| `token` | `string \| null` | Non-empty token string once paired | Token returned by `POST /api/v1/auth/request` |

---

## 2. Upstream YTMDesktop v2 State Entities (`src/types/companion.ts`)

```ts
export type TrackState = -1 | 0 | 1 | 2; // -1 Unknown, 0 Paused, 1 Playing, 2 Buffering
export type RepeatMode = -1 | 0 | 1 | 2; // -1 Unknown, 0 None, 1 All, 2 One
export type LikeStatus = -1 | 0 | 1 | 2; // -1 Unknown, 0 Dislike, 1 Indifferent, 2 Like

export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

export interface QueueItem {
  thumbnails: Thumbnail[];
  title: string;
  author: string;
  duration: string;
  selected: boolean;
  videoId: string;
  counterparts?: QueueItem[] | null;
}

export interface PlayerQueue {
  autoplay: boolean;
  items: QueueItem[];
  automixItems: QueueItem[];
  isGenerating: boolean;
  isInfinite: boolean;
  repeatMode: RepeatMode;
  selectedItemIndex: number;
}

export interface VideoMetadata {
  author: string;
  channelId: string;
  title: string;
  album: string | null;
  albumId: string | null;
  likeStatus: LikeStatus | null;
  thumbnails: Thumbnail[];
  durationSeconds: number;
  id: string;
  isLive?: boolean;
  videoType?: -1 | 0 | 1 | 2 | 3;
  metadataFilled?: boolean;
}

export interface CompanionState {
  player: {
    trackState: TrackState;
    videoProgress: number; // Seconds
    volume: number;        // 0..100
    adPlaying: boolean;
    queue: PlayerQueue | null;
  };
  video: VideoMetadata | null;
  playlistId: string | null;
}

export interface PlaylistSummary {
  id: string;
  title: string;
}
```

---

## 3. Search & Editable Playlist Entities (`src/types/companion.ts` & `data/playlists.json`)

```ts
export interface SearchTrack {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  duration?: string;
  thumbnailUrl?: string;
}

export interface EditablePlaylist {
  id: string;              // UUID or slug
  title: string;           // User-defined name (e.g. "Late Night Coding")
  updatedAt: string;       // ISO-8601 UTC timestamp
  tracks: SearchTrack[];   // Ordered list of tracks in the playlist
}
```

---

## 4. Karaoke Lyrics Entities (`src/lib/lyrics.ts`)

```ts
export interface LyricLine {
  timeSeconds: number;     // Parsed from [mm:ss.xx]
  text: string;            // Lyric text for that timestamp
}

export interface TrackLyrics {
  videoId: string;
  synced: boolean;         // True when syncedLyrics [mm:ss.xx] lines are available
  instrumental: boolean;
  lines: LyricLine[];      // Sorted ascending by timeSeconds
  plainText: string | null;
}
```
