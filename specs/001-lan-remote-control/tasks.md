# Tasks: LAN Remote Control for Desktop YouTube Music (Tubify)

**Input**: Design documents from `/specs/001-lan-remote-control/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/ytmdesktop-companion-v1.md](./contracts/ytmdesktop-companion-v1.md)

**Tests**: Lightweight Vitest unit tests are included for the Companion API client and URL parser per Constitution Principle V.

**Organization**: Tasks are grouped by user story (`[US1]`–`[US4]`) with `[P]` markers for parallelizable tasks so they can be executed cleanly with `/teamwork-preview`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependencies on incomplete tasks in the same phase)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`, `[US4]`)
- Exact file paths are included in every task description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the single-root Vite + React + TypeScript + Capacitor project

- [ ] T001 Create `package.json`, `tsconfig.json`, and `vite.config.ts` with React 19, TypeScript, Vite, Vitest, `socket.io-client`, and Capacitor scripts at `package.json`
- [ ] T002 [P] Create mobile-first HTML shell and dark Spotify/YouTube Music stylesheet in `index.html` and `src/styles.css`
- [ ] T003 [P] Configure `.gitignore` to exclude `node_modules/`, `dist/`, `.agents/`, and local build artifacts in `.gitignore`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core upstream types, local storage persistence, and Companion Server REST + Socket.IO client required by all user stories

**⚠️ CRITICAL**: Complete Phase 2 before starting User Story phases

- [ ] T004 [P] Define YTMDesktop v2 Companion API v1 TypeScript interfaces (`CompanionState`, `QueueItem`, `VideoMetadata`, `PlaylistSummary`, `ConnectionProfile`, command payloads) in `src/types/companion.ts`
- [ ] T005 [P] Implement `ConnectionProfile` load/save/clear helpers backed by `localStorage` (`tubify.connection.v1`) with smart LAN host default in `src/lib/storage.ts`
- [ ] T006 Implement `CompanionClient` (`checkMetadata`, `requestCode`, `requestToken`, `getState`, `getPlaylists`, `sendCommand`, and Socket.IO `/api/v1/realtime` `connectRealtime` subscription) in `src/lib/companion-client.ts`
- [ ] T007 [P] Add unit tests for `CompanionClient` REST endpoints, `Authorization` header formatting, and command payloads in `tests/companion-client.test.ts`

**Checkpoint**: Foundation ready — User Story phases can now execute

---

## Phase 3: User Story 1 - Pair & Control Active Desktop Playback (Priority: P1) 🎯 MVP

**Goal**: Pair the phone with YTMDesktop on Windows over LAN, receive live Socket.IO `state-update` events, interpolate progress smoothly, and control Play/Pause, Next/Previous, Seek, Volume/Mute, Shuffle, Repeat, and Like/Dislike.

**Independent Test**: Run `npm run dev -- --host`, open `http://<PC_IP>:5173` on phone, pair with YTMDesktop on port `9863`, click Allow on Windows, and verify live track display + play/pause/skip/seek/volume controls work end-to-end.

### Implementation for User Story 1

- [ ] T008 [US1] Implement `useCompanion` React hook managing connection lifecycle (`unpaired`, `requesting_code`, `awaiting_approval`, `connected`, `reconnecting`), Socket.IO subscription, 1s progress interpolation while `trackState === 1`, and command dispatch in `src/hooks/useCompanion.ts`
- [ ] T009 [P] [US1] Build `PairingView` component with host/port inputs, metadata reachability check, pairing code display, 30s approval waiting state, and error/retry banner in `src/components/PairingView.tsx`
- [ ] T010 [P] [US1] Build `NowPlayingView` component with album artwork, title/artist/album, ad-playing badge, interpolated seek slider, transport buttons (`playPause`, `previous`, `next`, `shuffle`, `repeatMode`, `toggleLike`, `toggleDislike`), and volume/mute controls in `src/components/NowPlayingView.tsx`
- [ ] T011 [US1] Wire `App.tsx` and `src/main.tsx` with connection status header, disconnect/switch-host action, and `PairingView` / `NowPlayingView` switching in `src/App.tsx` and `src/main.tsx`

**Checkpoint**: User Story 1 (MVP) is complete and independently playable over LAN

---

## Phase 4: User Story 2 - View & Jump Playback Queue (Priority: P2)

**Goal**: Display the active desktop queue (`items` + `automixItems`) with the current track highlighted and jump directly to any track on tap via `playQueueIndex`.

**Independent Test**: Open the Queue tab while music is playing, verify the track list and active track match YTMDesktop, tap another song in the queue, and verify Windows switches to that track immediately.

### Implementation for User Story 2

- [ ] T012 [P] [US2] Build `QueueView` component rendering `queue.items` and `queue.automixItems`, highlighting `selectedItemIndex`, auto-scrolling to active track, and dispatching `playQueueIndex` on tap in `src/components/QueueView.tsx`
- [ ] T013 [US2] Add bottom/tab navigation (`Now Playing` | `Queue`) to `src/App.tsx` and connect `QueueView` to `useCompanion` state and `playQueueIndex` action in `src/App.tsx`

**Checkpoint**: User Stories 1 and 2 work independently

---

## Phase 5: User Story 3 - Browse & Start Saved Playlists (Priority: P3)

**Goal**: Browse the user's YouTube Music playlists from `GET /api/v1/playlists` (handling the up-to-30s fetch window gracefully) and start playing any playlist on Windows via `changeVideo`.

**Independent Test**: Open the Playlists tab, verify playlists load without blocking playback controls, tap a playlist, and confirm Windows starts playing it.

### Implementation for User Story 3

- [ ] T014 [P] [US3] Extend `useCompanion` with `playlists` state, loading/refresh handlers for `GET /api/v1/playlists`, and Socket.IO `playlist-created` / `playlist-deleted` listeners in `src/hooks/useCompanion.ts`
- [ ] T015 [P] [US3] Build `PlaylistsView` component with non-blocking loading spinner, refresh button, playlist cards, and tap-to-play (`changeVideo({ playlistId, videoId: null })`) in `src/components/PlaylistsView.tsx`
- [ ] T016 [US3] Register the `Playlists` tab in `src/App.tsx` and auto-switch to `Now Playing` when a playlist is started in `src/App.tsx`

**Checkpoint**: User Stories 1, 2, and 3 work independently

---

## Phase 6: User Story 4 - Play Song or Playlist via Link / Share (Priority: P4)

**Goal**: Allow pasting or sharing any YouTube / YouTube Music URL or raw ID (`watch?v=`, `youtu.be/`, `playlist?list=`, or raw `videoId`) to immediately start playing on the Windows PC via `changeVideo`.

**Independent Test**: Open the "Play Link" modal, paste a `https://music.youtube.com/watch?v=...` URL, tap Play on PC, and verify YTMDesktop begins playing that song.

### Tests for User Story 4

- [ ] T017 [P] [US4] Write unit tests for parsing `music.youtube.com`, `youtube.com`, `youtu.be`, `playlist?list=`, shared text snippets, and raw video IDs in `tests/url-parser.test.ts`

### Implementation for User Story 4

- [ ] T018 [P] [US4] Implement `parseYouTubeInput(input: string)` returning `{ videoId: string | null, playlistId: string | null } | null` in `src/lib/url-parser.ts`
- [ ] T019 [P] [US4] Build `PlayLinkModal` component with paste input, validation feedback, and submit handler calling `changeVideo` in `src/components/PlayLinkModal.tsx`
- [ ] T020 [US4] Add "Play Link" trigger button in the header and URL query param (`?share=...`) handling in `src/App.tsx`

**Checkpoint**: All 4 user stories are complete and independently testable

---

## Phase 7: Polish & Android Packaging

**Purpose**: Package the web app as an Android APK via Capacitor with LAN cleartext HTTP/WS enabled and document one-command setup

- [ ] T021 [P] Create `capacitor.config.ts` with `appId: "com.rabelow.tubify"`, `appName: "Tubify"`, `webDir: "dist"`, and `server: { cleartext: true }` in `capacitor.config.ts`
- [ ] T022 Initialize Capacitor Android platform (`npx cap add android`) and enable `android:usesCleartextTraffic="true"` in `android/app/src/main/AndroidManifest.xml`
- [ ] T023 [P] Write concise `README.md` with LAN setup, Windows Firewall one-liner, development server command, and Android APK build instructions in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — blocks all User Stories
- **Phase 3 (US1 - Pair & Now Playing)**: Depends on Phase 2 — delivers playable MVP
- **Phase 4 (US2 - Queue)**: Depends on Phase 2 (and integrates into `App.tsx` from US1)
- **Phase 5 (US3 - Playlists)**: Depends on Phase 2 (and integrates into `App.tsx` from US1)
- **Phase 6 (US4 - Play Link)**: `url-parser.ts` (`T017`–`T019`) depends only on Phase 1; `T020` integrates into `App.tsx`
- **Phase 7 (Android & Polish)**: Depends on Phases 3–6

### Parallel Teamwork Strategy (`/teamwork-preview`)

Once **Phase 1 + Phase 2** (`T001`–`T007`) are complete:
- **Agent A (Core & US1)**: `T008`, `T009`, `T010`, `T011` (Hook + PairingView + NowPlayingView + App shell)
- **Agent B (US2 & US3 Views)**: `T012`, `T015` (`QueueView.tsx` and `PlaylistsView.tsx` only depend on `src/types/companion.ts` from Phase 2!)
- **Agent C (US4 Link Parser & Modal + Capacitor Config)**: `T017`, `T018`, `T019`, `T021`, `T023` (`url-parser.ts`, `url-parser.test.ts`, `PlayLinkModal.tsx`, `capacitor.config.ts`, `README.md`)
- **Final Integration**: `T013`, `T014`, `T016`, `T020`, `T022` wire the views into `App.tsx` and sync the Android project.
