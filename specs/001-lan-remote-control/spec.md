# Feature Specification: LAN Remote Control for Desktop YouTube Music

**Feature Branch**: `001-lan-remote-control`

**Created**: 2026-10-24

**Status**: Approved

**Input**: User description: "Create a simple Spotify Connect-like Android and web remote controller for YouTube Music running on Windows desktop (YTMDesktop Companion) over the local network, without over-engineering or external cloud relays."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pair & Control Active Desktop Playback (Priority: P1)

As a listener playing YouTube Music on my Windows PC, I want to pair my Android phone over my home network and control playback (play/pause, skip, seek, volume, shuffle, repeat, like/dislike) while seeing live track information and progress so that I can control my PC's music from the couch or bed just like Spotify Connect.

**Why this priority**: Core value proposition. Without pairing, live Now Playing state, and transport/volume controls, the remote controller cannot function.

**Independent Test**: Open the app on a phone (or mobile browser), enter the Windows PC's LAN IP, approve the pairing prompt on the Windows desktop player, verify the current song title/artist/artwork/progress appear live, and trigger play/pause, next/previous, seek, and volume changes while hearing/observing the Windows desktop player respond immediately.

**Acceptance Scenarios**:

1. **Given** the desktop player is running with its companion server enabled on the local network, **When** the user enters the PC IP address and taps "Connect & Pair", **Then** the app displays a pairing code, prompts the desktop player for approval, and saves the resulting session token upon approval.
2. **Given** a paired phone and an active song on the desktop player, **When** the song plays or changes on the desktop, **Then** the phone updates song title, artist, album art, like status, volume, and progress bar automatically in real time without manual refresh.
3. **Given** a paired phone showing the Now Playing screen, **When** the user taps Play/Pause, Next, Previous, Shuffle, Repeat, Like/Dislike, drags the seek bar, or adjusts the volume slider, **Then** the desktop player executes the action and the phone reflects the updated authoritative state.
4. **Given** a previously paired phone, **When** the user reopens the app or recovers from a temporary Wi-Fi drop, **Then** the app automatically reconnects to the saved desktop host and refreshes current playback state without requiring re-pairing.

---

### User Story 2 - View & Jump Playback Queue (Priority: P2)

As a listener, I want to see the current playback queue (including upcoming tracks and autoplay/automix suggestions) on my phone and tap any track in the queue to jump directly to it on my Windows PC.

**Why this priority**: Viewing what is playing next and picking a track from the current queue is the second most frequent remote interaction after basic transport controls.

**Independent Test**: Open the Queue view while a playlist or radio mix is playing on the desktop, verify the list of tracks matches the desktop queue with the active track highlighted, tap another track in the list, and verify the desktop player switches to that track.

**Acceptance Scenarios**:

1. **Given** an active queue on the desktop player, **When** the user opens the Queue view on the phone, **Then** all queue items and automix items are listed with thumbnail, title, artist, duration, and visual indication of the currently selected item.
2. **Given** the Queue view is open, **When** the user taps a specific track in the queue, **Then** the desktop player starts playing that queue index and the active track indicator updates.

---

### User Story 3 - Browse & Start Saved Playlists (Priority: P3)

As a listener, I want to browse my saved YouTube Music playlists from my phone and start playing any playlist on my Windows desktop player.

**Why this priority**: Allows starting a new listening session or switching moods remotely without walking back to the PC.

**Independent Test**: Open the Playlists tab on the phone, verify the user's playlists load, tap a playlist, and confirm the desktop player begins playing that playlist.

**Acceptance Scenarios**:

1. **Given** a paired phone, **When** the user navigates to the Playlists view, **Then** the app displays the user's playlists retrieved from the desktop player (showing a loading state while the desktop fetches them).
2. **Given** the Playlists view is populated, **When** the user taps a playlist, **Then** the desktop player switches playback to that playlist and the phone transitions to the updated Now Playing state.

---

### User Story 4 - Play Song or Playlist via Link / Share (Priority: P4)

As a listener browsing YouTube Music or YouTube on my phone, I want to paste or share a song/playlist link (or ID) into the remote app to start playing it immediately on my Windows desktop.

**Why this priority**: Bridges the gap when the user finds a specific song on their phone and wants it playing on the PC speakers right away, without needing a separate search backend.

**Independent Test**: Copy a `music.youtube.com/watch?v=...` link, paste or share it into the app's "Play Link" input, submit, and verify the Windows desktop player starts playing that track.

**Acceptance Scenarios**:

1. **Given** a valid YouTube or YouTube Music URL (containing `v=<videoId>`, `youtu.be/<videoId>`, or `list=<playlistId>`) or raw ID, **When** the user submits it in the Play Link dialog or shares it to the Android app, **Then** the desktop player switches to that video and/or playlist.
2. **Given** an invalid URL or text that does not contain a recognizable video or playlist identifier, **When** the user attempts to submit it, **Then** the app shows a clear validation message and does not send a malformed command.

---

### Edge Cases

- **Desktop player closed or unreachable**: App displays a clear "Offline / Unreachable" connection banner with a Retry button and option to change the host IP, rather than crashing or hanging indefinitely.
- **Pairing timeout or denial**: If the user denies the prompt on Windows or does not click Allow within 30 seconds, the app shows a clear message and lets the user request a new code in one tap.
- **Advertisement playing (`adPlaying: true`)**: App indicates that an ad is currently interrupting playback and disables unsupported seek actions until the track resumes.
- **Slow playlist loading**: Retrieving playlists from the desktop companion can take up to 30 seconds; the UI keeps playback controls responsive while showing a non-blocking loading indicator on the Playlists tab.
- **Incomplete initial track metadata (`metadataFilled: false`)**: App renders available fields gracefully and updates automatically when the subsequent `state-update` arrives with complete metadata.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to configure and persist the target desktop host IP/address and port (defaulting to port `9863`).
- **FR-002**: System MUST verify desktop reachability via the companion metadata check before initiating pairing.
- **FR-003**: System MUST execute the 2-step pairing workflow (request pairing code, display code to user, await desktop approval token) and persist the token locally on the client device.
- **FR-004**: System MUST subscribe to real-time desktop state updates and fall back to fetching a state snapshot on initial load or reconnect.
- **FR-005**: System MUST display current track metadata (title, artist, album, thumbnail artwork, duration, like/dislike status) and smoothly interpolated playback progress when playing.
- **FR-006**: System MUST provide transport controls for Play/Pause, Next, Previous, Seek to position, Shuffle, Repeat mode cycling (None, All, One), and Like/Dislike toggling.
- **FR-007**: System MUST provide volume controls including a 0–100% slider, step up/down buttons, and mute/unmute actions.
- **FR-008**: System MUST display the current queue (`items` and `automixItems`) with the active track highlighted and allow jumping to any track by index.
- **FR-009**: System MUST list the user's playlists from the desktop companion and allow starting playback of any selected playlist.
- **FR-010**: System MUST parse YouTube and YouTube Music URLs (or raw IDs) to extract `videoId` and/or `playlistId` and trigger playback on the desktop player.
- **FR-011**: System MUST package cleanly as an installable Android application as well as run in a standard mobile web browser over the local network.
- **FR-012**: System MUST allow the user to unpair/disconnect or switch the target desktop IP at any time.

### Key Entities

- **ConnectionProfile**: Saved target desktop configuration (`host`, `port`, `appId`, `token`, `lastConnectedAt`).
- **PlaybackState**: Normalized view of the desktop player's state (`trackState`, `videoProgress`, `volume`, `adPlaying`, `repeatMode`, `video` metadata, `queue`, `playlistId`).
- **QueueItem**: Track entry inside the active queue or automix list (`index`, `videoId`, `title`, `author`, `duration`, `thumbnailUrl`, `selected`).
- **PlaylistSummary**: User playlist entry (`id`, `title`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user on the same Wi-Fi network can pair their phone with the Windows desktop player in under 30 seconds.
- **SC-002**: Playback control actions (play/pause, skip, volume, seek, queue jump) reflect on the Windows desktop player and update the phone UI within 500 milliseconds on a standard home LAN.
- **SC-003**: Real-time state changes initiated on the Windows PC (e.g., skipping a track on the PC keyboard) appear on the phone UI within 1 second without manual refresh.
- **SC-004**: Reopening the mobile app reconnects and displays current Now Playing state in under 2 seconds when the desktop player is running.
- **SC-005**: Entire solution operates with zero external servers, zero cloud accounts, and zero intermediary daemons beyond the already-installed desktop player.

## Assumptions

- The Windows PC is running YouTube Music Desktop App v2 (`ytmdesktop`) with Companion Server enabled (default port `9863`) and Companion Authorization enabled.
- The Android phone and Windows PC are connected to the same local network (or a shared local VPN such as Tailscale) and Windows Firewall permits local inbound traffic on TCP port `9863`.
- Audio always plays on the Windows PC; the phone acts purely as a remote controller.
