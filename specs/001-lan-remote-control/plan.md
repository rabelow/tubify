# Implementation Plan: LAN Remote Control for Desktop YouTube Music (Tubify)

**Branch**: `001-lan-remote-control` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-lan-remote-control/spec.md`

## Summary

Build **Tubify**, a minimal Spotify Connect-like remote controller for YouTube Music on Windows.
Tubify is a **single TypeScript + React + Vite + Capacitor application** that:
1. Connects **directly over LAN** to the installed **YTMDesktop v2 Companion Server** (`0.0.0.0:9863/api/v1` and Socket.IO `/api/v1/realtime`) for pairing, live Now Playing state, remote volume control (`setVolume`, `volumeUp`, `volumeDown`, `mute`, `unmute`), and queue management.
2. Includes a **lightweight local Vite/Node middleware (`src/server/local-api.ts`)** running on the Windows PC (`:5173/api/*`) that provides zero-key YouTube Music song search (`music.youtube.com/youtubei/v1/search` via `WEB_REMIX`) and persistent playlist editing (`data/playlists.json` for creating playlists and adding/removing tracks).
3. Integrates **Karaoke Time-Synced Lyrics** via the free public **LRCLIB API** (`https://lrclib.net/api/get`), parsing `[mm:ss.xx]` timestamps to highlight, auto-scroll, and tap-to-seek lyrics in real time.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22 LTS (verified `v22.22.2` installed on host)

**Primary Dependencies**: React 19, Vite 6, `socket.io-client` 4.x (for YTMDesktop `/api/v1/realtime`), `@capacitor/core` + `@capacitor/android` (for native Android APK build)

**Storage**:
- Client: `localStorage` (`tubify.connection.v1` storing `{ host, port, appId, token }`)
- Windows Host: `data/playlists.json` (flat JSON file storing user-created/edited playlists and tracks)

**Testing**: Vitest (unit tests for Companion API client, LRC karaoke parser, YouTube Music search/URL parser, and playlist CRUD store)

**Target Platform**: Android (via Capacitor APK with `usesCleartextTraffic="true"` for LAN HTTP/WS) and Mobile Web Browser (served over LAN via Vite on port `5173`)

**Project Type**: Single mobile-first web + Capacitor Android application with built-in Vite local API middleware

**Performance Goals**: <500ms command/volume round-trip on LAN; 200ms progress interpolation ticks for smooth karaoke lyric tracking; <1.5s YouTube Music search response

**Constraints**: Local network only (`192.168.0.144` / Tailscale `100.72.29.107`); zero external cloud servers, zero SQL databases, zero API keys required

**Scale/Scope**: Single user, home LAN, 5 main views (`Pairing`, `Now Playing + Remote Volume`, `Queue`, `Search + Playlists Editor`, `Karaoke Lyrics`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Direct-to-Companion Simplicity (YAGNI)**: ✅ PASS — Uses `:9863` directly for playback/volume/queue, a ~100-line Vite middleware for `WEB_REMIX` search + `data/playlists.json`, and `lrclib.net` for synced karaoke lyrics.
- **II. Single-App Architecture**: ✅ PASS — Single root `package.json` with `src/` and `android/`.
- **III. Authoritative Real-Time State**: ✅ PASS — Uses Socket.IO `state-update` events as single source of truth; interpolates `videoProgress` locally at 200ms ticks while `trackState === 1` to drive the progress bar and karaoke lyrics.
- **IV. Native Pairing & Local-Only Credentials**: ✅ PASS — Uses `POST /api/v1/auth/requestcode` + `POST /api/v1/auth/request` and stores token in client `localStorage`.
- **V. Incremental Vertical Slices & Runnable Checks**: ✅ PASS — Organized into P1 (Pair, Playback & Remote Volume), P2 (Queue), P3 (Search & Playlist Editing), P4 (Karaoke Lyrics), with `vitest` checks for non-trivial modules.

## Project Structure

### Documentation (this feature)

```text
specs/001-lan-remote-control/
├── plan.md                              # This file
├── research.md                          # Phase 0: GPT plan critique & live API verification
├── data-model.md                        # Phase 1: Client, playlist, search & karaoke lyric models
├── quickstart.md                        # Phase 1: End-to-end LAN & Android verification guide
├── contracts/
│   └── ytmdesktop-companion-v1.md       # Phase 1: Companion API + Local Search/Playlists + LRCLIB contracts
└── tasks.md                             # Phase 2: Actionable task breakdown (/speckit-tasks)
```

### Source Code (repository root)

```text
tubify/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts                       # Mounts localApiPlugin() for /api/search & /api/playlists
├── capacitor.config.ts
├── data/
│   └── playlists.json                   # Auto-created JSON store for editable playlists
├── src/
│   ├── main.tsx                         # React entry point
│   ├── App.tsx                          # Top-level shell, bottom tabs (Now, Queue, Search, Playlists, Lyrics)
│   ├── styles.css                       # Mobile-first Spotify/YTM dark theme + karaoke glow styles
│   ├── types/
│   │   └── companion.ts                 # CompanionState, SearchTrack, EditablePlaylist, LyricLine types
│   ├── server/
│   │   ├── ytmusic-search.ts            # Zero-key YouTube Music WEB_REMIX search parser
│   │   ├── playlists-store.ts           # JSON file CRUD for editable playlists (create, add/remove track)
│   │   └── local-api.ts                 # Vite/Node HTTP middleware (/api/search, /api/playlists)
│   ├── lib/
│   │   ├── companion-client.ts          # REST (:9863) + Socket.IO + local (:5173/api) client
│   │   ├── lyrics.ts                    # LRCLIB fetcher + [mm:ss.xx] LRC parser & active-line finder
│   │   ├── storage.ts                   # ConnectionProfile localStorage persistence
│   │   └── url-parser.ts                # Extract videoId / playlistId from YTM/YouTube links
│   ├── hooks/
│   │   └── useCompanion.ts              # Connection lifecycle, 200ms progress interpolation, playlist queue runner
│   └── components/
│       ├── PairingView.tsx              # Host IP input, code display, 30s approval wait
│       ├── NowPlayingView.tsx           # Artwork, transport, remote volume slider/step/mute, quick add-to-playlist
│       ├── QueueView.tsx                # Active queue + automix list, tap-to-jump (playQueueIndex)
│       ├── SearchView.tsx               # Song search input, results list, Play on PC & Add to Playlist actions
│       ├── PlaylistsView.tsx            # Create/delete playlist, view tracks, remove track, play playlist, YTM playlists
│       └── LyricsView.tsx               # Time-synced karaoke lyrics with auto-scroll & tap-line-to-seek
├── tests/
│   ├── companion-client.test.ts         # Unit tests for REST calls, volume/transport command payloads
│   ├── lyrics.test.ts                   # Unit tests for LRC timestamp parsing & active karaoke line index
│   ├── playlists-store.test.ts          # Unit tests for playlist creation, adding/removing tracks
│   └── url-parser.test.ts               # Unit tests for YouTube/YTM URL & ID parsing
└── android/                             # Capacitor Android project (cleartext LAN enabled)
```

**Structure Decision**: Single root Vite + React + TypeScript project (`src/`), embedding the lightweight local search & playlist JSON middleware directly into Vite (`src/server/local-api.ts`) so `npm run dev -- --host` runs everything in a single process.

## Complexity Tracking

No Constitution violations. All features use native Companion endpoints, a flat local JSON file, and zero-key public APIs (`WEB_REMIX` + `lrclib.net`).
