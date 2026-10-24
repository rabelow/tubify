# Phase 0 Research: GPT Plan Review & Live Environment Findings

## 1. Critique of `ytmusic-connect-technical-design.md` (GPT Initial Plan)

| Area | GPT Proposal | Reality on Host Machine | Decision |
|---|---|---|---|
| **Target Desktop App** | Targeted `YTMDesktop2` (`127.0.0.1:13091`) as primary and relegated `YTMDesktop v2` (`:9863`) to a "future fallback". | User installed **YTMDesktop v2** (`ytmdesktop/ytmdesktop`). Port `9863` is actively listening (`GET /metadata` returns `{"apiVersions":["v1"]}`); port `13091` is not installed. | **Target YTMDesktop v2 (`:9863`) directly.** Drop `PlayerAdapter` multi-player abstraction. |
| **Network Binding** | Assumed desktop API is loopback-only (`127.0.0.1`), requiring a custom `windows-agent` proxy. | `Get-NetTCPConnection -LocalPort 9863` shows YTMDesktop v2 listens on **`0.0.0.0:9863`** (accessible on LAN IP `192.168.0.144:9863` and Tailscale `100.72.29.107:9863`). | **Connect directly to `<PC_IP>:9863` from the phone.** Drop `apps/windows-agent`. |
| **CORS Support** | Assumed browser/WebView clients cannot call the desktop API directly. | Live probe of `OPTIONS http://127.0.0.1:9863/api/v1/command` confirmed `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET,HEAD,POST`, `Access-Control-Allow-Headers: authorization,content-type`. | **Call YTMDesktop v2 directly from React/Capacitor via `fetch` and `socket.io-client`.** |
| **Remote Relay** | Proposed `apps/relay` (Fastify + SQLite + Cloudflare Tunnel on a Mac mini) for Internet access. | User explicitly stated: *"in this plan gpt proposed access/control outside home but i dont need that, it can just be running on this machine and controlled by the android app."* | **Delete `apps/relay`, SQLite, and Cloudflare Tunnel.** |
| **Pairing & Auth** | Proposed custom 90-second QR challenge, hashed SQLite claims, and Windows DPAPI secret vault. | YTMDesktop v2 already implements a native 2-step pairing flow (`/api/v1/auth/requestcode` + `/api/v1/auth/request`) that pops up an Allow/Deny dialog on the Windows desktop app and returns an app token. | **Use YTMDesktop v2's native pairing flow.** |
| **Queue Control** | Claimed YTMDesktop v2 lacks queue operations. | YTMDesktop v2's `GET /api/v1/state` returns the full `player.queue.items` and `automixItems`, and `POST /api/v1/command` supports `playQueueIndex` to jump to any track in the queue, plus `changeVideo` (`{ videoId, playlistId }`) and `GET /api/v1/playlists`. | **Support full Queue viewing, Queue jumping (`playQueueIndex`), Playlist browsing (`GET /playlists`), and Link-to-Play (`changeVideo`).** |
| **Monorepo Layout** | Proposed 3 apps (`mobile`, `windows-agent`, `relay`) + 4 packages (`protocol`, `player-core`, `api-client`, `ui`). | Only a single client app is needed. | **Use one single Vite + React + TypeScript + Capacitor project at the repository root.** |

## 2. Key Technical Decisions

### Decision 1: Direct Socket.IO + REST Client from Mobile to Port 9863
- **Decision**: Connect directly from the mobile web / Capacitor Android app to `http://<host>:9863/api/v1` (REST) and `http://<host>:9863/api/v1/realtime` (Socket.IO v4 with `transports: ['websocket']`).
- **Rationale**: Eliminates 100% of custom backend code while providing real-time (<100ms LAN) push updates on track change, play/pause, seek, volume, and queue updates.
- **Alternatives considered**: Writing a Node.js proxy on Windows. Rejected because YTMDesktop v2 already binds to `0.0.0.0:9863` with `Access-Control-Allow-Origin: *`.

### Decision 2: Authorization Header Format in YTMDesktop v2
- **Decision**: Pass `Authorization: <token>` (raw token string returned by `/api/v1/auth/request`, **not** prefixed with `Bearer `) on REST requests, and `{ transports: ['websocket'], auth: { token } }` on Socket.IO connection.
- **Rationale**: Per YTMDesktop v2 Companion Server API v1 documentation, `Authorization` expects the raw token value directly.

### Decision 3: Android Cleartext HTTP Traffic on LAN
- **Decision**: Configure Capacitor (`capacitor.config.ts` `server.cleartext: true` and `android:usesCleartextTraffic="true"` in `AndroidManifest.xml`).
- **Rationale**: YTMDesktop v2 serves plain HTTP/WS on port `9863`. Android 9+ blocks cleartext HTTP in WebViews by default unless `usesCleartextTraffic` is enabled.

### Decision 4: Windows Firewall Helper Script
- **Decision**: Provide a one-line PowerShell helper command in `quickstart.md` (and `package.json` script `npm run firewall:allow`) to ensure inbound TCP port `9863` (and Vite dev port `5173`) is allowed on Private/LAN networks if Windows Firewall blocks external LAN devices.
- **Rationale**: Even though YTMDesktop listens on `0.0.0.0:9863`, Windows Defender Firewall may block inbound LAN packets from the phone unless allowed on the Private profile.
