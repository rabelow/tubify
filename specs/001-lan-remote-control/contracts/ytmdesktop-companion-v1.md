# Interface Contract: YTMDesktop v2 Companion Server API v1

**Upstream Base URL**: `http://<host>:9863`  
**API Prefix**: `http://<host>:9863/api/v1`  
**Realtime Socket.IO Path**: `/api/v1/realtime`  
**CORS**: `Access-Control-Allow-Origin: *` (verified live)

---

## 1. Discovery & Metadata (Unauthenticated)

### `GET /metadata`
- **URL**: `http://<host>:9863/metadata`
- **Response `200 OK`**:
  ```json
  {
    "apiVersions": ["v1"]
  }
  ```

---

## 2. Authentication & Pairing (Unauthenticated)

### `POST /api/v1/auth/requestcode`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "appId": "tubify",
    "appName": "Tubify Remote",
    "appVersion": "1.0.0"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "code": "ABCD"
  }
  ```

### `POST /api/v1/auth/request`
- **Behavior**: Blocks up to 30 seconds waiting for the user to click **Allow** in the YTMDesktop prompt on Windows.
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "appId": "tubify",
    "code": "ABCD"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "token": "<companion_auth_token>"
  }
  ```

---

## 3. State, Playlists & Commands (Authenticated)

All authenticated REST calls require header:
```http
Authorization: <companion_auth_token>
```

### `GET /api/v1/state`
- **Response `200 OK`**: `CompanionState` JSON object (see `data-model.md`).

### `GET /api/v1/playlists`
- **Note**: May take up to 30 seconds while YTMDesktop queries YouTube Music playlists.
- **Response `200 OK`**:
  ```json
  [
    { "id": "PL...", "title": "My Playlist" }
  ]
  ```

### `POST /api/v1/command`
- **Headers**: `Authorization: <companion_auth_token>`, `Content-Type: application/json`
- **Supported Command Payloads**:

| User Action | Request Body |
|---|---|
| Toggle Play/Pause | `{ "command": "playPause" }` |
| Play | `{ "command": "play" }` |
| Pause | `{ "command": "pause" }` |
| Next Track | `{ "command": "next" }` |
| Previous Track | `{ "command": "previous" }` |
| Seek to Seconds | `{ "command": "seekTo", "data": 95 }` |
| Set Volume (0–100) | `{ "command": "setVolume", "data": 50 }` |
| Volume Up / Down | `{ "command": "volumeUp" }` / `{ "command": "volumeDown" }` |
| Mute / Unmute | `{ "command": "mute" }` / `{ "command": "unmute" }` |
| Set Repeat Mode | `{ "command": "repeatMode", "data": 0 }` (`0` None, `1` All, `2` One) |
| Shuffle Queue | `{ "command": "shuffle" }` |
| Play Queue Index | `{ "command": "playQueueIndex", "data": 3 }` |
| Toggle Like / Dislike | `{ "command": "toggleLike" }` / `{ "command": "toggleDislike" }` |
| Play Video / Playlist | `{ "command": "changeVideo", "data": { "videoId": "dQw4w9WgXcQ", "playlistId": null } }` |

---

## 4. Real-Time Socket.IO Contract

- **Server URL**: `http://<host>:9863/api/v1/realtime` (must use IPv4 address or LAN IP, not IPv6 `::1`)
- **Client Options**:
  ```ts
  io(`http://${host}:${port}/api/v1/realtime`, {
    transports: ['websocket'],
    auth: { token }
  })
  ```
- **Inbound Events**:
  - `state-update`: `(state: CompanionState) => void`
  - `playlist-created`: `(playlist: PlaylistSummary) => void`
  - `playlist-deleted`: `(playlistId: string) => void`
