# Tasks: LAN Remote Control for Desktop YouTube Music (Tubify)

**Input**: Design documents from `/specs/001-lan-remote-control/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/ytmdesktop-companion-v1.md](./contracts/ytmdesktop-companion-v1.md)

**Tests**: Lightweight Vitest unit tests are included for non-trivial modules (`companion-client`, `url-parser`, `playlists-store`, `lyrics`) per Constitution Principle V.

**Organization**: Tasks are grouped by user story (`[US1]`–`[US4]`) with `[P]` markers for parallelizable tasks so they can be executed cleanly with `/teamwork-preview`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependencies on incomplete tasks in the same phase)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Exact file paths are included in every task description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the single-root Vite + React + TypeScript + Capacitor project

- [x] T001 Create `package.json`, `tsconfig.json`, and `vite.config.ts` with React 19, TypeScript, Vite, Vitest, `socket.io-client`, and Capacitor scripts at `package.json`
- [x] T002 [P] Create mobile-first HTML shell and dark Spotify/YouTube Music stylesheet (including volume controls and karaoke lyric highlight classes) in `index.html` and `src/styles.css`
- [x] T003 [P] Configure `.gitignore` to exclude `node_modules/`, `dist/`, `.agents/`, `data/playlists.json`, and local build artifacts in `.gitignore`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, local storage persistence, URL parser, and Companion Server REST + Socket.IO client required by all user stories

**⚠️ CRITICAL**: Complete Phase 2 before starting User Story phases

- [x] T004 [P] Define TypeScript interfaces (`CompanionState`, `QueueItem`, `VideoMetadata`, `PlaylistSummary`, `SearchTrack`, `EditablePlaylist`, `LyricLine`, `TrackLyrics`, `ConnectionProfile`) in `src/types/companion.ts`
- [x] T005 [P] Implement `ConnectionProfile` load/save/clear helpers backed by `localStorage` (`tubify.connection.v1`) with smart LAN host default (`192.168.0.144`) in `src/lib/storage.ts`
- [x] T006 [P] Implement `parseYouTubeInput(input: string)` extracting `videoId` and `playlistId` from YouTube/YTM links and IDs in `src/lib/url-parser.ts` with unit tests in `tests/url-parser.test.ts`
- [x] T007 Implement `CompanionClient` (`checkMetadata`, `requestCode`, `requestToken`, `getState`, `getPlaylists`, `sendCommand` including `setVolume`/`volumeUp`/`volumeDown`/`mute`/`unmute`,Socket.IO `connectRealtime`, plus local API calls `searchSongs` and playlist CRUD) in `src/lib/companion-client.ts`
- [x] T008 [P] Add unit tests for `CompanionClient` REST endpoints, `Authorization` header formatting, and transport/volume command payloads in `tests/companion-client.test.ts`

**Checkpoint**: Foundation ready — User Story phases can now execute in parallel

---

## Phase 3: User Story 1 - Pair, Control Playback & Adjust Remote Volume (Priority: P1) 🎯 MVP

**Goal**: Pair the phone with YTMDesktop on Windows over LAN, receive live Socket.IO `state-update` events, interpolate progress smoothly (200ms ticks), control transport (`playPause`, `next`, `previous`, `seekTo`, `shuffle`, `repeatMode`, `toggleLike`, `toggleDislike`), and adjust **Remote Volume** (`0–100%` slider, `-5%`/`+5%` step buttons, `mute`/`unmute`).

**Independent Test**: Run `npm run dev -- --host`, open `http://<PC_IP>:5173` on phone, pair with YTMDesktop on port `9863`, click Allow on Windows, and verify live track display, play/pause/skip/seek, and remote volume slider/step/mute controls work end-to-end.

### Implementation for User Story 1

- [x] T009 [US1] Implement `useCompanion` React hook managing connection lifecycle (`unpaired`, `requesting_code`, `awaiting_approval`, `connected`, `reconnecting`), Socket.IO subscription, 200ms progress interpolation while `trackState === 1`, remote volume state/mute tracking, and custom playlist queue auto-advance in `src/hooks/useCompanion.ts`
- [x] T010 [P] [US1] Build `PairingView` component with host/port inputs, metadata reachability check, pairing code display, 30s approval waiting state, and error/retry banner in `src/components/PairingView.tsx`
- [x] T011 [P] [US1] Build `NowPlayingView` component with album artwork, title/artist/album, ad-playing badge, interpolated seek slider, transport buttons, "+ Add to Playlist" quick action, and dedicated **Remote Volume bar** (`0–100%` range slider, `-5%`/`+5%` step buttons, Mute/Unmute toggle) in `src/components/NowPlayingView.tsx`
- [x] T012 [US1] Wire `App.tsx` and `src/main.tsx` with connection status header, bottom navigation bar (`Now Playing`, `Queue`, `Search`, `Playlists`, `Lyrics`), and `PairingView` / `NowPlayingView` rendering in `src/App.tsx` and `src/main.tsx`

**Checkpoint**: User Story 1 (MVP with Remote Volume Control) is complete and playable over LAN

---

## Phase 4: User Story 2 - View & Jump Playback Queue (Priority: P2)

**Goal**: Display the active desktop queue (`items` + `automixItems`) with the current track highlighted and jump directly to any track on tap via `playQueueIndex`.

**Independent Test**: Open the Queue tab while music is playing, verify the track list and active track match YTMDesktop, tap another song in the queue, and verify Windows switches to that track immediately.

### Implementation for User Story 2

- [x] T013 [P] [US2] Build `QueueView` component rendering `queue.items` and `queue.automixItems`, highlighting `selectedItemIndex`, "+ Add to Playlist" button per item, and dispatching `playQueueIndex` on tap in `src/components/QueueView.tsx`
- [x] T014 [US2] Connect `QueueView` tab in `src/App.tsx` to `useCompanion` queue state and `playQueueIndex` action in `src/App.tsx`

**Checkpoint**: User Stories 1 and 2 work independently

---

## Phase 5: User Story 3 - Search Music & Edit Playlists (Add / Remove Songs) (Priority: P3)

**Goal**: Search YouTube Music songs directly from the phone (and paste/share links), play any result on the PC, and create/edit playlists by adding songs (from Search, Queue, or Now Playing) and removing songs, persisted in `data/playlists.json` on the Windows host alongside native YTMDesktop playlists.

**Independent Test**: Open Search, search for a song, play it on the PC or add it to a playlist; open Playlists, create/rename a playlist, view its tracks, remove a track, and tap Play Playlist to play it on the Windows PC.

### Tests for User Story 3

- [x] T015 [P] [US3] Write unit tests for `PlaylistsStore` (create playlist, rename, delete, add track deduplication, remove track) in `tests/playlists-store.test.ts`

### Implementation for User Story 3

- [x] T016 [P] [US3] Implement `PlaylistsStore` reading and writing `data/playlists.json` (create, rename, delete playlist, add track, remove track) in `src/server/playlists-store.ts`
- [x] T017 [P] [US3] Implement `searchYouTubeMusic(query: string)` querying `https://music.youtube.com/youtubei/v1/search` (`WEB_REMIX` songs filter) and parsing `SearchTrack[]` results in `src/server/ytmusic-search.ts`
- [x] T018 [US3] Implement Vite/Node middleware `localApiPlugin()` serving `GET /api/search` and `/api/playlists` CRUD routes with CORS headers, and register it in `src/server/local-api.ts` and `vite.config.ts`
- [x] T019 [P] [US3] Build `SearchView` component with debounced search bar, direct URL/ID paste support, results list, one-tap "Play on PC" (`changeVideo`), and "+ Add to Playlist" picker in `src/components/SearchView.tsx`
- [x] T020 [P] [US3] Build `PlaylistsView` component showing editable Tubify playlists (create, rename, delete, expand tracks, remove track, play track/playlist) and native YTMDesktop playlists (`GET /api/v1/playlists`) in `src/components/PlaylistsView.tsx`
- [x] T021 [US3] Connect `SearchView`, `PlaylistsView`, and the global "Add to Playlist" action in `src/App.tsx` and `src/hooks/useCompanion.ts`

**Checkpoint**: User Stories 1, 2, and 3 work independently

---

## Phase 6: User Story 4 - Live Karaoke Lyrics with Time-Synced Following (Priority: P4)

**Goal**: Automatically fetch time-synced LRC lyrics from LRCLIB (`https://lrclib.net/api/get`) for the active song, highlight and center-scroll the active line in real time as the song plays on Windows, and seek the desktop player when the user taps any lyric line.

**Independent Test**: Play a song on Windows, open the Lyrics tab on the phone, verify synced lyrics highlight and scroll in real time with the music, and tap a lyric line to jump playback to that timestamp.

### Tests for User Story 4

- [x] T022 [P] [US4] Write unit tests for `parseLrc(lrcText)` and `getActiveLyricIndex(lines, currentSeconds)` in `tests/lyrics.test.ts`

### Implementation for User Story 4

- [x] T023 [P] [US4] Implement `fetchTrackLyrics(video)` (`lrclib.net/api/get` with `/api/search` fallback), `parseLrc(lrcText)`, and `getActiveLyricIndex(lines, currentSeconds)` in `src/lib/lyrics.ts`
- [x] T024 [P] [US4] Build `LyricsView` component with karaoke active-line glow, smooth auto-scroll to active line (`scrollIntoView({ behavior: 'smooth', block: 'center' })`), tap-line-to-seek (`seekTo`), and plain-text / instrumental fallbacks in `src/components/LyricsView.tsx`
- [x] T025 [US4] Connect `LyricsView` tab in `src/App.tsx` to `useCompanion`'s active `video`, interpolated `progress`, and `seekTo` command in `src/App.tsx`

**Checkpoint**: All 4 user stories are complete and independently testable

---

## Phase 7: Polish & Android Packaging

**Purpose**: Package the web app as an Android APK via Capacitor with LAN cleartext HTTP/WS enabled and document setup

- [x] T026 [P] Create `capacitor.config.ts` with `appId: "com.rabelow.tubify"`, `appName: "Tubify"`, `webDir: "dist"`, and `server: { cleartext: true }` in `capacitor.config.ts`
- [x] T027 Initialize Capacitor Android platform (`npx cap add android`) and enable `android:usesCleartextTraffic="true"` in `android/app/src/main/AndroidManifest.xml`
- [x] T028 [P] Write concise `README.md` covering LAN setup, Windows Firewall command, Search/Playlists/Karaoke usage, and Android APK build instructions in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately (`T001`–`T003`)
- **Phase 2 (Foundational)**: Depends on Phase 1 — blocks all User Stories (`T004`–`T008`)
- **Phase 3 (US1 - Pair, Playback & Remote Volume)**: Depends on Phase 2 (`T009`–`T012`)
- **Phase 4 (US2 - Queue)**: `T013` depends only on Phase 2; `T014` wires into `App.tsx`
- **Phase 5 (US3 - Search & Playlist Editing)**: `T015`–`T020` depend only on Phase 2; `T021` wires into `App.tsx`
- **Phase 6 (US4 - Karaoke Lyrics)**: `T022`–`T024` depend only on Phase 2; `T025` wires into `App.tsx`
- **Phase 7 (Android & Polish)**: `T026`, `T028` can run in parallel anytime after Phase 1; `T027` runs after build

### Parallel Teamwork Strategy (`/teamwork-preview`)

Once **Phase 1 + Phase 2** (`T001`–`T008`) are complete, work splits cleanly across 4 parallel tracks with zero file collisions:
- **Worker 1 (US1 Core & Remote Volume)**: `T009`, `T010`, `T011` (`useCompanion.ts`, `PairingView.tsx`, `NowPlayingView.tsx`)
- **Worker 2 (US3 Local Search & Playlist Store)**: `T015`, `T016`, `T017`, `T018` (`playlists-store.ts`, `playlists-store.test.ts`, `ytmusic-search.ts`, `local-api.ts`)
- **Worker 3 (US2 Queue & US3 Search/Playlists UI)**: `T013`, `T019`, `T020` (`QueueView.tsx`, `SearchView.tsx`, `PlaylistsView.tsx`)
- **Worker 4 (US4 Karaoke Lyrics & Capacitor Config)**: `T022`, `T023`, `T024`, `T026`, `T028` (`lyrics.ts`, `lyrics.test.ts`, `LyricsView.tsx`, `capacitor.config.ts`, `README.md`)
- **Lead / Integration**: `T012`, `T014`, `T021`, `T025`, `T027` (`App.tsx` integration + Capacitor Android sync).
