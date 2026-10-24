<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles:
  - I. Direct-to-Companion Simplicity (YAGNI) -> Updated to allow a minimal local Vite/Node API middleware for CORS-free YouTube Music search (`WEB_REMIX`) and local JSON playlist editing (`data/playlists.json`).
  - II. Single-App Architecture -> Clarified that the lightweight local API middleware lives inside the same single project (`src/server/`).
- Added sections: None
- Removed sections: None
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
- Follow-up TODOs: None
-->
# Tubify Constitution

## Core Principles

### I. Direct-to-Companion Simplicity (YAGNI)
Tubify MUST communicate directly over the local network (LAN) with the built-in YTMDesktop v2
Companion Server (`http://<PC_LAN_IP>:9863/api/v1` and Socket.IO `/api/v1/realtime`) for playback,
volume, queue, and pairing. For features not exposed by YTMDesktop's Companion API—specifically
song search and editable playlists—a minimal local API middleware on the Windows host (`WEB_REMIX`
search proxy and flat `data/playlists.json` storage) MUST be used instead of external databases,
cloud relays, or fragile Google account cookie scraping. Time-synced karaoke lyrics MUST use the
public zero-key LRCLIB API (`https://lrclib.net/api/get`).

### II. Single-App Architecture
The codebase MUST live in a single flat application at the repository root (`src/` for the
TypeScript/React UI and local Vite/Node middleware, `android/` for the Capacitor Android shell).
Workspace monorepos (`apps/*`, `packages/*`) and speculative shared libraries are prohibited.

### III. Authoritative Real-Time State
YTMDesktop's Socket.IO `state-update` stream and `GET /api/v1/state` endpoint MUST serve as the
single source of truth for playback, volume, queue, and track metadata. The client MAY locally
interpolate playback progress (`videoProgress`) at 100ms–250ms intervals while `trackState === 1`
to drive both the progress bar and real-time karaoke lyric highlighting, reconciling immediately
upon receiving upstream state updates.

### IV. Native Pairing & Local-Only Credentials
Client authentication MUST use YTMDesktop v2's native pairing endpoints (`POST /auth/requestcode`
followed by `POST /auth/request` with desktop user approval). Resulting auth tokens and LAN host
settings MUST be persisted only in client local storage and MUST NEVER be hardcoded or committed.

### V. Incremental Vertical Slices & Runnable Checks
Work MUST be decomposed into independently testable user stories ordered by user value. Non-trivial
logic (Companion REST/Socket client, LRC karaoke parser, YouTube Music search/URL parser, playlist
CRUD store) MUST include focused unit/integration checks (`vitest`) without heavyweight scaffolding.

## Architectural Constraints

- **Target Upstream**: YTMDesktop v2 Companion Server API v1 (`0.0.0.0:9863`), verified live on the
  host Windows machine.
- **Network Scope**: Local Area Network (Wi-Fi/Ethernet) or existing user VPN (e.g., Tailscale)
  targeting the Windows PC IP. No public Internet exposure.
- **Client Runtime**: Mobile-first React + TypeScript + Vite web app packaged for Android via
  Capacitor with `usesCleartextTraffic="true"` enabled so direct LAN `http://` and `ws://` calls
  succeed on Android.

## Development Workflow & Quality Gates

- Follow the GitHub Spec Kit lifecycle (`constitution` -> `specify` -> `plan` -> `tasks` ->
  `implement`).
- Each user story phase in `tasks.md` MUST be independently verifiable against the live YTMDesktop
  Companion Server or a deterministic test before advancing to the next story.
- Keep dependencies minimal: native `fetch`, `socket.io-client`, React, Vite, and Capacitor.

## Governance

This Constitution supersedes speculative design documents, including the initial cloud-relay
proposal in `ytmusic-connect-technical-design.md`. Any proposal to introduce a cloud relay,
external database, or multi-package monorepo requires an explicit Constitution amendment.

**Version**: 1.1.0 | **Ratified**: 2026-10-24 | **Last Amended**: 2026-10-24
