# Implementation Plan: LAN Remote Control for Desktop YouTube Music

**Branch**: `001-lan-remote-control` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-lan-remote-control/spec.md`

## Summary

Build **Tubify**, a minimal Spotify Connect-like remote controller for YouTube Music on Windows.
Instead of the 3-tier cloud relay + custom Windows daemon monorepo originally proposed in
`ytmusic-connect-technical-design.md`, Tubify is a **single TypeScript + React + Vite + Capacitor
application** that connects **directly over the local network (LAN)** to the already-installed
**YTMDesktop v2 Companion Server** (`0.0.0.0:9863/api/v1` and Socket.IO `/api/v1/realtime`).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+ LTS (build tooling)

**Primary Dependencies**: React 19, Vite 6, `socket.io-client` 4.x (required by YTMDesktop v2 `/api/v1/realtime`), `@capacitor/core` + `@capacitor/android` (for native Android APK build)

**Storage**: Browser / Capacitor `localStorage` (`tubify.connection` key storing `{ host, port, appId, token }`)

**Testing**: Vitest (unit tests for Companion API client, URL/ID parser, and state helper functions)

**Target Platform**: Android (via Capacitor APK with `usesCleartextTraffic="true"` for LAN HTTP/WS) and Mobile Web Browser (served over LAN via Vite)

**Project Type**: Single mobile-first web + Capacitor Android application

**Performance Goals**: <500ms command round-trip on LAN; smooth 1s progress bar interpolation while playing; instant (<2s) reconnect on app foreground

**Constraints**: Local network only (`http://<PC_LAN_IP>:9863`); zero external servers, zero custom Windows background daemons, zero databases; must respect YTMDesktop v2 rate limits (`x-ratelimit-*`) by relying on Socket.IO `state-update` rather than polling `GET /state`

**Scale/Scope**: Single user, home LAN (`192.168.0.144:9863` / Tailscale `100.72.29.107:9863`), 4 compact views (Pairing/Settings drawer, Now Playing, Queue, Playlists + Play Link modal)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Direct-to-Companion Simplicity (YAGNI)**: ✅ PASS — Connects directly to `http://<host>:9863/api/v1` and `ws://<host>:9863/api/v1/realtime`. Eliminates `apps/relay`, `apps/windows-agent`, Cloudflare Tunnel, and SQLite.
- **II. Single-App Architecture**: ✅ PASS — Single root `package.json` with `src/` and `android/`. Eliminates 7-package Turborepo/pnpm workspace bloat.
- **III. Authoritative Real-Time State**: ✅ PASS — Uses Socket.IO `state-update` events as single source of truth; interpolates `videoProgress` locally only when `trackState === 1`.
- **IV. Native Pairing & Local-Only Credentials**: ✅ PASS — Uses `POST /api/v1/auth/requestcode` + `POST /api/v1/auth/request` and stores token in client `localStorage`.
- **V. Incremental Vertical Slices & Runnable Checks**: ✅ PASS — Organized into P1 (Pair & Now Playing), P2 (Queue), P3 (Playlists), P4 (Link/Share to Play), with `vitest` checks for non-trivial modules.

## Project Structure

### Documentation (this feature)

```text
specs/001-lan-remote-control/
├── plan.md                              # This file
├── research.md                          # Phase 0: GPT plan critique & live API verification
├── data-model.md                        # Phase 1: Client & upstream YTMDesktop v2 models
├── quickstart.md                        # Phase 1: End-to-end LAN & Android verification guide
├── contracts/
│   └── ytmdesktop-companion-v1.md       # Phase 1: Verified YTMDesktop v2 REST & Socket.IO contract
└── tasks.md                             # Phase 2: Actionable task breakdown (/speckit-tasks)
```

### Source Code (repository root)

```text
tubify/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── capacitor.config.ts
├── src/
│   ├── main.tsx                         # React entry point
│   ├── App.tsx                          # Top-level shell, navigation tabs, connection banner
│   ├── styles.css                       # Mobile-first Spotify/YTM dark theme CSS
│   ├── types/
│   │   └── companion.ts                 # YTMDesktop v2 API & client state TypeScript types
│   ├── lib/
│   │   ├── companion-client.ts          # REST (fetch) + Socket.IO (/api/v1/realtime) client
│   │   ├── storage.ts                   # ConnectionProfile localStorage persistence
│   │   └── url-parser.ts                # Extract videoId / playlistId from YTM/YouTube links
│   ├── hooks/
│   │   └── useCompanion.ts              # Connection lifecycle, pairing, live state, commands
│   └── components/
│       ├── PairingView.tsx              # Host IP input, code display, 30s approval wait
│       ├── NowPlayingView.tsx           # Artwork, metadata, interpolated seek bar, transport, volume
│       ├── QueueView.tsx                # Active queue + automix list, tap-to-jump (playQueueIndex)
│       ├── PlaylistsView.tsx            # Saved playlists list + tap-to-play (changeVideo)
│       └── PlayLinkModal.tsx            # Paste/share YouTube Music URL or ID to play on PC
├── tests/
│   ├── url-parser.test.ts               # Unit tests for YouTube/YTM URL & ID parsing
│   └── companion-client.test.ts         # Unit tests for REST calls, auth headers, command payloads
└── android/                             # Capacitor Android project (cleartext LAN enabled)
```

**Structure Decision**: Single root Vite + React + TypeScript project (`src/`) with Capacitor Android (`android/`). Fewer than 15 source files total, zero backend code to maintain.

## Complexity Tracking

No Constitution violations. All speculative tiers from the initial GPT draft were removed.
