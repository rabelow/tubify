# Phase 0 Research: GPT Plan Review & Live Environment Findings

## 1. Critique of `ytmusic-connect-technical-design.md` (GPT Initial Plan)

| Area | GPT Proposal | Reality on Host Machine | Decision |
|---|---|---|---|
| **Target Desktop App** | Targeted `YTMDesktop2` (`127.0.0.1:13091`) as primary and relegated `YTMDesktop v2` (`:9863`) to a "future fallback". | User installed **YTMDesktop v2** (`ytmdesktop/ytmdesktop`). Port `9863` is actively listening (`GET /metadata` returns `{"apiVersions":["v1"]}`); port `13091` is not installed. | **Target YTMDesktop v2 (`:9863`) directly.** Drop `PlayerAdapter` multi-player abstraction. |
| **Network Binding & CORS** | Assumed desktop API is loopback-only (`127.0.0.1`) without CORS. | `Get-NetTCPConnection -LocalPort 9863` shows YTMDesktop v2 listens on **`0.0.0.0:9863`** (`192.168.0.144:9863`) with `Access-Control-Allow-Origin: *`. | **Connect directly to `<PC_IP>:9863` from the phone for playback, volume, queue, and pairing.** |
| **Remote Relay** | Proposed `apps/relay` (Fastify + SQLite + Cloudflare Tunnel on a Mac mini) for Internet access. | User only needs local control at home. | **Delete `apps/relay`, SQLite, and Cloudflare Tunnel.** |
| **Remote Volume Control** | Basic `setVolume` only. | YTMDesktop v2 Companion API supports `setVolume` (`0..100`), `volumeUp`, `volumeDown`, `mute`, and `unmute`, and reports live `player.volume` in every `state-update`. | **Provide a full remote volume bar on Now Playing (`0-100%` slider + `-5%`/`+5%` step buttons + Mute/Unmute toggle).** |
| **Song Search** | Deferred to "M4 / not MVP" with separate Python service or YouTube Data API keys. | Live test of `POST https://music.youtube.com/youtubei/v1/search` with `clientName: 'WEB_REMIX'` and songs filter `params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D'` works from Node `fetch` with **zero API keys and zero authentication**. | **Expose `/api/search?q=...` in a tiny Vite middleware (`src/server/ytmusic-search.ts`) on the Windows host.** |
| **Playlist Editing (Add / Remove Songs)** | Excluded from scope ("distinguish queued track control from library management"). | YTMDesktop v2's `GET /api/v1/playlists` is read-only (`[{id, title}]`). By storing editable playlists in `data/playlists.json` on the Windows host (`/api/playlists`), the user can create playlists, search & add songs, remove songs, and play those playlists on YTMDesktop via `changeVideo` + auto-advance. | **Support full Playlist CRUD (create, rename, delete, add song from Search/Now Playing, remove song, play playlist) backed by `data/playlists.json` alongside viewing native YTMDesktop playlists.** |
| **Karaoke Lyrics** | Not included in GPT plan. | Live test of `GET https://lrclib.net/api/get?artist_name=...&track_name=...` confirmed free, zero-key, CORS-enabled time-synced LRC lyrics (`[mm:ss.xx]`). | **Include `LyricsView` with LRCLIB time-synced karaoke highlighting, auto-scroll, and tap-line-to-seek (`seekTo`).** |

## 2. Key Technical Decisions

### Decision 1: Direct Socket.IO + REST Client to `:9863` for Playback & Volume
- **Decision**: Connect directly from the mobile app to `http://<host>:9863/api/v1` and `http://<host>:9863/api/v1/realtime` (`transports: ['websocket']`).
- **Rationale**: Zero latency overhead for play/pause, remote volume slider (`setVolume`), mute/unmute, seek, and queue jumping (`playQueueIndex`).

### Decision 2: Built-in Vite Local Middleware (`src/server/local-api.ts`) for Search & Editable Playlists
- **Decision**: Mount a ~100-line Node HTTP middleware directly inside `vite.config.ts` (`configureServer` / `configurePreviewServer`) serving `/api/search` and `/api/playlists` with `Access-Control-Allow-Origin: *` (so both the mobile browser and the Capacitor Android APK can call `http://<host>:5173/api/...`).
- **Rationale**: Avoids running a separate backend process or database while solving browser CORS for YouTube Music `WEB_REMIX` search and keeping edited playlists (`data/playlists.json`) shared between the Windows PC and Android phone.

### Decision 3: LRCLIB + 200ms Progress Interpolation for Karaoke Lyrics
- **Decision**: Query `https://lrclib.net/api/get` (with fallback to `https://lrclib.net/api/search`) whenever `state.video.id` changes, parse `[mm:ss.xx]` LRC lines into sorted `{ timeSeconds, text }[]`, and run a 200ms client timer while `trackState === 1` to highlight and center-scroll the active lyric line.
- **Rationale**: YTMDesktop emits `state-update` roughly once per second during playback; 200ms local interpolation makes karaoke line transitions feel instantaneous and allows tapping any line to call `seekTo(line.timeSeconds)`.
