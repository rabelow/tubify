# Feature Specification: LAN Remote Control for Desktop YouTube Music (Tubify)

**Feature Branch**: `001-lan-remote-control`

**Created**: 2026-10-24

**Status**: Approved

**Input**: User description: "Create a simple Spotify Connect-like Android and web remote controller for YouTube Music running on Windows desktop (YTMDesktop Companion) over the local network, supporting playback & remote volume control, queue management, searching songs, editing playlists (adding and removing songs), and time-synced karaoke lyrics."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pair, Control Playback & Adjust Remote Volume (Priority: P1)

As a listener playing YouTube Music on my Windows PC, I want to pair my Android phone over my home network, see live Now Playing metadata, control playback (play/pause, skip, seek, shuffle, repeat, like/dislike), and remotely control the desktop player volume (0–100% slider, step +/- buttons, and mute/unmute) so that I have full Spotify Connect-style control from across the room.

**Why this priority**: Core value proposition. Pairing, live state, transport controls, and remote volume adjustment are the foundation of the remote controller.

**Independent Test**: Open the app on a phone, enter the Windows PC's LAN IP, approve the pairing prompt on Windows, verify the current song title/artist/artwork/progress appear live, and trigger play/pause, next/previous, seek, and remote volume slider/step/mute changes while hearing the Windows PC respond immediately.

**Acceptance Scenarios**:

1. **Given** the desktop player is running with its companion server enabled on the local network, **When** the user enters the PC IP address and taps "Connect & Pair", **Then** the app displays a pairing code, prompts the desktop player for approval, and saves the resulting session token upon approval.
2. **Given** a paired phone and an active song on the desktop player, **When** the song plays or changes on the desktop, **Then** the phone updates song title, artist, album art, like status, current volume percentage, and progress bar automatically in real time.
3. **Given** a paired phone showing the Now Playing screen, **When** the user drags the remote volume slider (0–100%), taps Volume Down (`-5%`) / Volume Up (`+5%`), or taps Mute/Unmute, **Then** the Windows desktop player's audio volume changes immediately and reflects on the phone.
4. **Given** a paired phone showing the Now Playing screen, **When** the user taps Play/Pause, Next, Previous, Shuffle, Repeat, Like/Dislike, or drags the seek bar, **Then** the desktop player executes the action and the phone reflects the updated authoritative state.

---

### User Story 2 - View & Jump Playback Queue (Priority: P2)

As a listener, I want to see the current playback queue (including upcoming tracks and autoplay/automix suggestions) on my phone and tap any track in the queue to jump directly to it on my Windows PC.

**Why this priority**: Viewing what is playing next and picking a track from the current queue is essential for everyday listening sessions.

**Independent Test**: Open the Queue view while music is playing on the desktop, verify the list of tracks matches the desktop queue with the active track highlighted, tap another track in the list, and verify the desktop player switches to that track.

**Acceptance Scenarios**:

1. **Given** an active queue on the desktop player, **When** the user opens the Queue view on the phone, **Then** all queue items and automix items are listed with thumbnail, title, artist, duration, and visual indication of the currently playing item.
2. **Given** the Queue view is open, **When** the user taps a specific track in the queue, **Then** the desktop player starts playing that queue index and the active track indicator updates.

---

### User Story 3 - Search Music & Edit Playlists (Add / Remove Songs) (Priority: P3)

As a listener, I want to search for songs directly inside the app, play any search result immediately on my PC, and create/edit playlists by adding searched songs (or the currently playing song) and removing unwanted songs.

**Why this priority**: Gives the user full discovery and playlist curation from the phone without walking back to the Windows desktop.

**Independent Test**: Open the Search view, search for a song by title/artist, play it on the PC with one tap, or tap "Add to Playlist" to add it to a playlist; then open Playlists, view the tracks inside that playlist, remove a song, and start playing the edited playlist on the PC.

**Acceptance Scenarios**:

1. **Given** the user enters a search query in the Search tab, **When** the search executes, **Then** the app displays matching YouTube Music songs with thumbnail, title, artist, album, and duration.
2. **Given** a list of search results, **When** the user taps "Play" on a song, **Then** the Windows desktop player starts playing that song immediately (`changeVideo`).
3. **Given** a search result or the currently playing song, **When** the user taps "Add to Playlist" and selects (or creates) a playlist, **Then** the song is saved into that playlist and persists across app restarts.
4. **Given** an existing playlist in the Playlists tab, **When** the user opens the playlist detail view, **Then** the user can see all tracks in the playlist, tap any track to play it on the PC, remove any track from the playlist, or start playing the playlist from the beginning.
5. **Given** the user's YouTube Music account playlists reported by the desktop player, **When** the user views the Playlists tab, **Then** both desktop YouTube Music playlists and editable Tubify playlists are accessible.

---

### User Story 4 - Live Karaoke Lyrics with Time-Synced Following (Priority: P4)

As a listener, I want to view lyrics for the currently playing song with real-time karaoke line highlighting and auto-scrolling synchronized to the desktop playback position, and tap any lyric line to seek the song to that moment.

**Why this priority**: Delivers a rich, Spotify-like karaoke experience on the phone screen while audio plays on the PC speakers.

**Independent Test**: Play a popular song on the Windows PC, open the Lyrics tab on the phone, verify time-synced lyrics load and highlight/scroll automatically as the song progresses, and tap a lyric line to verify the PC seeks to that timestamp.

**Acceptance Scenarios**:

1. **Given** a song is actively playing on the desktop player, **When** the user opens the Lyrics view (or when the track changes), **Then** the app automatically fetches lyrics matching the current track's title, artist, and duration.
2. **Given** time-synced lyrics (`[mm:ss.xx]`) are available for the current song, **When** the song plays on the desktop, **Then** the currently sung line is visually highlighted and smoothly auto-scrolled to the center of the viewport in real time.
3. **Given** time-synced lyrics are displayed, **When** the user taps on a specific lyric line, **Then** the Windows desktop player seeks directly to that line's timestamp (`seekTo`).
4. **Given** only plain (unsynced) lyrics or no lyrics are found for a track, **When** the user views the Lyrics tab, **Then** the app gracefully displays the static plain lyrics or a clear "No lyrics found for this track" message.

---

### Edge Cases

- **Desktop player closed or unreachable**: App displays a clear "Offline / Unreachable" connection banner with a Retry button and option to change the host IP.
- **Pairing timeout or denial**: If the user denies the prompt on Windows or does not click Allow within 30 seconds, the app shows a clear message and lets the user request a new code in one tap.
- **Advertisement playing (`adPlaying: true`)**: App indicates that an ad is interrupting playback and disables seek/karaoke sync until the song resumes.
- **Duplicate song in playlist**: Adding a song already present in a playlist prevents accidental duplicates (or notifies the user).
- **Instrumental track or missing lyrics**: Lyrics view clearly indicates when a track is instrumental or has no matching lyrics without throwing an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to configure and persist the target desktop host IP/address and port (defaulting to port `9863`).
- **FR-002**: System MUST verify desktop reachability via the companion metadata check before initiating pairing.
- **FR-003**: System MUST execute the 2-step pairing workflow (request pairing code, display code to user, await desktop approval token) and persist the token locally on the client device.
- **FR-004**: System MUST subscribe to real-time desktop state updates via Socket.IO and fall back to fetching a state snapshot on initial load or reconnect.
- **FR-005**: System MUST display current track metadata (title, artist, album, thumbnail artwork, duration, like/dislike status) and smoothly interpolated playback progress (at <=250ms ticks while playing).
- **FR-006**: System MUST provide transport controls for Play/Pause, Next, Previous, Seek to position, Shuffle, Repeat mode cycling (None, All, One), and Like/Dislike toggling.
- **FR-007**: System MUST provide dedicated remote volume controls on the Now Playing screen, including a live 0–100% slider, `-5%` / `+5%` step buttons, and a Mute/Unmute toggle synchronized with the desktop player's volume.
- **FR-008**: System MUST display the current queue (`items` and `automixItems`) with the active track highlighted and allow jumping to any track by index.
- **FR-009**: System MUST allow searching YouTube Music songs by text query and starting immediate playback of any search result on the desktop player, as well as pasting/sharing a YouTube Music URL or ID to play.
- **FR-010**: System MUST allow creating, renaming, deleting, and editing playlists—including adding songs (from Search, Queue, or Now Playing) and removing songs—persisted on the Windows host (`data/playlists.json`), alongside browsing native YTMDesktop playlists.
- **FR-011**: System MUST fetch time-synced LRC lyrics for the active track, highlight and auto-scroll the active lyric line in sync with playback progress (karaoke mode), and seek the desktop player when the user taps a timestamped lyric line.
- **FR-012**: System MUST package cleanly as an installable Android application as well as run in a standard mobile web browser over the local network.

### Key Entities

- **ConnectionProfile**: Saved target desktop configuration (`host`, `port`, `appId`, `token`).
- **PlaybackState**: Authoritative view of the desktop player (`trackState`, `videoProgress`, `volume`, `adPlaying`, `repeatMode`, `video` metadata, `queue`, `playlistId`).
- **SearchTrack**: Song returned by search (`videoId`, `title`, `artist`, `album`, `duration`, `thumbnailUrl`).
- **EditablePlaylist**: User-editable playlist persisted on the host (`id`, `title`, `createdAt`, `tracks: SearchTrack[]`).
- **LyricLine**: Parsed karaoke lyric entry (`timeSeconds`, `text`) belonging to a `TrackLyrics` response (`synced`, `instrumental`, `lines`, `plainText`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user on the same Wi-Fi network can pair their phone with the Windows desktop player in under 30 seconds.
- **SC-002**: Playback and remote volume actions (play/pause, skip, volume slider/mute, seek, queue jump) reflect on the Windows desktop player within 500 milliseconds on a standard home LAN.
- **SC-003**: Song search queries return playable YouTube Music song results in under 1.5 seconds, and adding/removing a song from a playlist updates immediately.
- **SC-004**: Karaoke lyric highlighting stays synchronized within 300 milliseconds of the desktop playback progress and supports tap-to-seek on any synced line.
- **SC-005**: Entire solution operates locally on the user's home network without cloud relays or external database services.

## Assumptions

- The Windows PC is running YouTube Music Desktop App v2 (`ytmdesktop`) with Companion Server (`9863`) and Companion Authorization enabled.
- The Android phone and Windows PC are connected to the same local network (or Tailscale).
- The Windows PC has standard outbound Internet access to `music.youtube.com` (for YouTube Music playback and song search) and `lrclib.net` (for synced karaoke lyrics).
