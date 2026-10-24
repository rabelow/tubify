<!--
Sync Impact Report
- Version change: [CONSTITUTION_VERSION] -> 1.0.0
- Modified principles:
  - [PRINCIPLE_1_NAME] -> I. Direct-to-Companion Simplicity (YAGNI)
  - [PRINCIPLE_2_NAME] -> II. Single-App Architecture
  - [PRINCIPLE_3_NAME] -> III. Authoritative Real-Time State
  - [PRINCIPLE_4_NAME] -> IV. Native Pairing & Local-Only Credentials
  - [PRINCIPLE_5_NAME] -> V. Incremental Vertical Slices & Runnable Checks
- Added sections:
  - Architectural Constraints
  - Development Workflow & Quality Gates
- Removed sections: None
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md (Constitution Check aligns with 5 principles)
  - ✅ .specify/templates/spec-template.md (User stories P1-P3 align with vertical slice principle)
  - ✅ .specify/templates/tasks-template.md (Task phases align with story-driven organization)
- Follow-up TODOs: None
-->
# Tubify Constitution

## Core Principles

### I. Direct-to-Companion Simplicity (YAGNI)
Tubify MUST communicate directly over the local network (LAN) with the built-in YTMDesktop v2
Companion Server (`http://<PC_LAN_IP>:9863/api/v1` and Socket.IO `/api/v1/realtime`). Cloud relays,
custom intermediary Windows background agents, databases, and multi-player adapter abstractions
MUST NOT be added unless a concrete requirement cannot be met by the native Companion API.

### II. Single-App Architecture
The codebase MUST live in a single flat application at the repository root (`src/` for the
TypeScript/React mobile web UI and `android/` for the Capacitor Android shell). Workspace
monorepos (`apps/*`, `packages/*`) and speculative shared libraries are prohibited.

### III. Authoritative Real-Time State
YTMDesktop's Socket.IO `state-update` stream and `GET /api/v1/state` endpoint MUST serve as the
single source of truth for playback, volume, queue, and track metadata. The client MAY locally
interpolate playback progress (`videoProgress`) at 60fps/1s intervals while `trackState === 1`,
but MUST reconcile immediately upon receiving upstream state updates.

### IV. Native Pairing & Local-Only Credentials
Client authentication MUST use YTMDesktop v2's native pairing endpoints (`POST /auth/requestcode`
followed by `POST /auth/request` with desktop user approval). Resulting auth tokens and LAN host
settings MUST be persisted only in client local storage and MUST NEVER be hardcoded or committed.

### V. Incremental Vertical Slices & Runnable Checks
Work MUST be decomposed into independently testable user stories ordered by user value. Non-trivial
logic (Companion REST/Socket client, state normalization, YouTube Music link/ID parsing) MUST
include focused unit/integration checks (`vitest`) without heavyweight test scaffolding.

## Architectural Constraints

- **Target Upstream**: YTMDesktop v2 Companion Server API v1 (`0.0.0.0:9863`), verified live on the
  host Windows machine.
- **Network Scope**: Local Area Network (Wi-Fi/Ethernet) or existing user VPN (e.g., Tailscale)
  directly targeting the Windows PC IP on port `9863`. No public Internet exposure.
- **Client Runtime**: Mobile-first React + TypeScript + Vite web app packaged for Android via
  Capacitor with `usesCleartextTraffic="true"` enabled so direct LAN `http://` and `ws://` calls
  to port `9863` succeed on Android.

## Development Workflow & Quality Gates

- Follow the GitHub Spec Kit lifecycle (`constitution` -> `specify` -> `plan` -> `tasks` ->
  `implement`).
- Each user story phase in `tasks.md` MUST be independently verifiable against the live YTMDesktop
  Companion Server or a deterministic mock before advancing to the next story.
- Keep dependencies minimal: native `fetch` for REST calls, `socket.io-client` (required by
  YTMDesktop v2 `/api/v1/realtime`), React for UI, and Capacitor for Android packaging.

## Governance

This Constitution supersedes speculative design documents, including the initial cloud-relay
proposal in `ytmusic-connect-technical-design.md`. Any proposal to introduce a backend relay,
custom Windows service, or multi-package monorepo requires an explicit Constitution amendment with
documented proof that direct LAN communication with YTMDesktop v2 is insufficient.

**Version**: 1.0.0 | **Ratified**: 2026-10-24 | **Last Amended**: 2026-10-24
