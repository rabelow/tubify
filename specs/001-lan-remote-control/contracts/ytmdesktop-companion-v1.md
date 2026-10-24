# Interface Contracts: YTMDesktop Companion, Local Search/Playlists & Karaoke Lyrics

---

## Part A: YTMDesktop v2 Companion Server (`http://<host>:9863`)

**CORS**: `Access-Control-Allow-Origin: *` (verified live)  
**Auth Header**: `Authorization: <companion_auth_token>` (raw token, no `Bearer ` prefix)

### 1. Discovery & Pairing
- `GET http://<host>:9863/metadata` -> `{ "apiVersions": ["v1"] }`
- `POST http://<host>:9863/api/v1/auth/requestcode` with `{ "appId": "tubify", "appName": "Tubify Remote", "appVersion": "1.0.0" }` -> `{ "code": "ABCD" }`
- `POST http://<host>:9863/api/v1/auth/request` with `{ "appId": "tubify", "code": "ABCD" }` -> `{ "token": "<token>" }` (waits up to 30s for Windows desktop approval)

### 2. State, Native Playlists & Commands
- `GET http://<host>:9863/api/v1/state` -> `CompanionState`
- `GET http://<host>:9863/api/v1/playlists` -> `PlaylistSummary[]`
- `POST http://<host>:9863/api/v1/command`:

| User Action | Request Body |
|---|---|
| Toggle Play/Pause | `{ "command": "playPause" }` |
| Play / Pause | `{ "command": "play" }` / `{ "command": "pause" }` |
| Next / Previous | `{ "command": "next" }` / `{ "command": "previous" }` |
| Seek to Seconds | `{ "command": "seekTo", "data": 95 }` |
| **Set Remote Volume (0–100)** | `{ "command": "setVolume", "data": 50 }` |
| **Volume Step Up / Down** | `{ "command": "volumeUp" }` / `{ "command": "volumeDown" }` |
| **Mute / Unmute** | `{ "command": "mute" }` / `{ "command": "unmute" }` |
| Set Repeat Mode | `{ "command": "repeatMode", "data": 0 }` (`0` None, `1` All, `2` One) |
| Shuffle Queue | `{ "command": "shuffle" }` |
| Play Queue Index | `{ "command": "playQueueIndex", "data": 3 }` |
| Toggle Like / Dislike | `{ "command": "toggleLike" }` / `{ "command": "toggleDislike" }` |
| Play Video / Playlist | `{ "command": "changeVideo", "data": { "videoId": "dQw4w9WgXcQ", "playlistId": null } }` |

### 3. Real-Time Socket.IO (`/api/v1/realtime`)
- `io('http://<host>:9863/api/v1/realtime', { transports: ['websocket'], auth: { token } })`
- Events: `state-update` (`CompanionState`), `playlist-created`, `playlist-deleted`

---

## Part B: Tubify Local Host Middleware (`http://<host>:5173/api`)

Served by `src/server/local-api.ts` on the Windows PC with `Access-Control-Allow-Origin: *`.

### 1. Search YouTube Music Songs
- `GET /api/search?q=<query>`
- Proxies to `POST https://music.youtube.com/youtubei/v1/search?prettyPrint=false` (`clientName: "WEB_REMIX"`, songs filter `EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D`).
- **Response `200 OK`**:
  ```json
  {
    "results": [
      {
        "videoId": "5NV6Rdv1a3I",
        "title": "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
        "artist": "Daft Punk",
        "album": "Random Access Memories",
        "duration": "6:09",
        "thumbnailUrl": "https://lh3.googleusercontent.com/..."
      }
    ]
  }
  ```

### 2. Editable Playlists CRUD (`data/playlists.json`)
- `GET /api/playlists` -> `{ "playlists": EditablePlaylist[] }`
- `POST /api/playlists` with `{ "title": "Chill Vibes" }` -> creates and returns `EditablePlaylist`
- `PATCH /api/playlists/:id` with `{ "title"?: string }` -> renames playlist
- `DELETE /api/playlists/:id` -> `{ "ok": true }`
- `POST /api/playlists/:id/tracks` with `SearchTrack` -> appends track (if `videoId` not already present) and returns updated `EditablePlaylist`
- `DELETE /api/playlists/:id/tracks/:videoId` -> removes track from playlist and returns updated `EditablePlaylist`

---

## Part C: Karaoke Synced Lyrics (`https://lrclib.net/api`)

Called directly from client (`src/lib/lyrics.ts`):
- Primary: `GET https://lrclib.net/api/get?track_name=<title>&artist_name=<artist>&duration=<seconds>`
- Fallback: `GET https://lrclib.net/api/search?q=<title>+<artist>` (takes first match)
- **Response fields used**:
  - `syncedLyrics`: LRC string (`"[00:14.20] Line 1\n[00:17.55] Line 2"`)
  - `plainLyrics`: Plain string fallback
  - `instrumental`: Boolean
