# Tubify

> **Tubify** is a fast, responsive, dark-mode mobile web and Capacitor Android remote controller for **YouTube Music Desktop** ([YTMDesktop v2](https://ytmdesktop.app/)) Companion Server at port `9863`.

Tubify allows you to control desktop playback from your smartphone or tablet over your local Wi-Fi network (LAN) with zero cloud dependencies, real-time Socket.IO state synchronization, dedicated remote volume adjustments, full queue browsing, zero-key in-app YouTube Music search, persistent editable playlists, and karaoke time-synced lyrics with auto-scroll.

---

## Core Features

1. **Live Now Playing & Transport Control**
   - High-resolution album artwork, track title, artist, and album display.
   - Smooth 200ms client-interpolated seek bar reflecting exact playback progress.
   - Full transport controls: Play/Pause, Next, Previous, Seek, Shuffle, Repeat Mode, Like, and Dislike.
   - Live advertisement badge indicator.

2. **Dedicated Remote Volume Control**
   - Continuous 0–100% remote volume slider.
   - Fine-grained `-5%` and `+5%` step buttons for precise audio adjustment.
   - One-tap Mute / Unmute toggle preserving the previous volume level.

3. **Queue Management & Tap-to-Jump**
   - Renders active desktop queue items (`player.queue.items`) and automatic radio queue (`player.queue.automixItems`).
   - Continuous indexing and visual highlight of the active playing song (`selectedItemIndex`).
   - Tap any track in the queue to jump desktop playback directly (`playQueueIndex`).
   - Quick "+ Add to Playlist" button per queued track.

4. **In-App YouTube Music Search & URL Resolver**
   - Zero-key YouTube Music `WEB_REMIX` Innertube API queries via Vite Connect `/api/search` middleware.
   - Instant search results with title, artist, album, duration, and album art.
   - Direct YouTube / YouTube Music URL and 11-character video ID parser (`parseYouTubeInput`).
   - One-tap "Play on PC" (`changeVideo`) command to switch desktop playback instantly.

5. **Persistent Editable Playlists**
   - Local JSON database (`data/playlists.json`) managed via `/api/playlists` CRUD endpoints.
   - Atomic disk writes with file-locking and automatic duplicate prevention by `videoId`.
   - Create, rename, delete playlists, and add/remove tracks from Search, Queue, or Now Playing.
   - Support for both custom editable Tubify playlists and native YTMDesktop playlists (`GET /api/v1/playlists`).

6. **Karaoke Time-Synced Lyrics**
   - Automatic lyrics resolution via LRCLIB client (`/api/get` with `/api/search` fallback).
   - High-performance binary-search active line tracker and multi-timestamp LRC parser.
   - Karaoke glowing active line with centered smooth auto-scroll.
   - 4-second manual scroll interruption recovery guard.
   - Tap any synced lyric line to seek desktop playback to that timestamp.
   - Graceful fallbacks for plain-text lyrics and instrumental tracks.

7. **Capacitor Android Packaging with Cleartext LAN Traffic**
   - Packaged as a native Android app via Capacitor 7.
   - Configured with `android:usesCleartextTraffic="true"` and network permissions for seamless LAN HTTP and WebSocket communication to YTMDesktop (`:9863`) and Vite dev server (`:5173`).

---

## Prerequisites

- **Host PC Operating System**: Windows 10 or Windows 11.
- **YouTube Music Desktop**: [YTMDesktop v2](https://ytmdesktop.app/) installed and running.
- **Enable Companion Server in YTMDesktop**:
  1. Open YTMDesktop Settings (`gear icon` or `Ctrl+,`).
  2. Navigate to **Integrations** -> **Companion Server**.
  3. Turn on **Companion Server**.
  4. Ensure port is set to **`9863`**.
- **Runtime Environment**: Node.js 18+ and npm installed on your PC.
- **Network**: Mobile phone and PC must be connected to the same local Wi-Fi / LAN network.

---

## Windows Firewall Setup

To allow your mobile device to communicate with the YTMDesktop Companion Server (`9863`) and the Tubify web server (`5173`), run the following command in an elevated **PowerShell** prompt (Run as Administrator):

```powershell
New-NetFirewallRule -DisplayName "Tubify YTMDesktop Companion" -Direction Inbound -LocalPort 9863,5173 -Protocol TCP -Action Allow
```

---

## Development & Mobile Web Usage

1. **Clone and install dependencies**:
   ```bash
   npm install
   ```

2. **Start the development server on your local network**:
   ```bash
   npm run dev -- --host
   ```
   Vite will display your LAN IP address (for example `http://192.168.0.144:5173`).

3. **Open Tubify on your mobile phone**:
   - Open your mobile browser (Chrome, Safari, Firefox).
   - Navigate to `http://<YOUR_PC_LAN_IP>:5173`.

4. **Pair with YTMDesktop**:
   - Enter your PC LAN IP address (default: `192.168.0.144`) and port `9863`.
   - Tap **Connect**.
   - Tubify will request pairing and display a 4-digit code.
   - Enter the code in YTMDesktop or click **Allow** in the prompt on your desktop.
   - Your pairing token is securely saved in `localStorage` (`tubify.connection.v1`) for instant auto-reconnect.

---

## Android APK Build (Capacitor)

Tubify includes native Android scaffolding pre-configured for LAN cleartext traffic.

1. **Build the production web bundle**:
   ```bash
   npm run build
   ```

2. **Sync web assets to Android platform**:
   ```bash
   npx cap sync
   ```

3. **Open Android Studio to run or build APK**:
   ```bash
   npx cap open android
   ```
   From Android Studio, click **Run** (or **Build > Build Bundle(s) / APK(s) > Build APK(s)**).

   Alternatively, build a debug APK directly via command line:
   ```bash
   cd android
   ./gradlew assembleDebug
   ```
   The APK will be generated at `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## Testing & Quality Assurance

Tubify is verified by extensive automated unit and adversarial stress test suites (500+ tests) across all core modules:

- **Run all tests**:
  ```bash
  npm test
  ```
- **Type-check and production build**:
  ```bash
  npm run build
  ```

Test suites cover:
- `tests/companion-client.test.ts`: REST API endpoints, raw `Authorization: <token>` header, transport commands, remote volume commands, and Socket.IO realtime connection.
- `tests/url-parser.test.ts`: YouTube Music URLs, standard YouTube URLs, shortlinks, video IDs, and playlist IDs.
- `tests/playlists-store.test.ts`: Atomic disk persistence, playlist CRUD, and track deduplication.
- `tests/lyrics.test.ts` & `tests/lyrics-engine-stress.test.ts`: LRC parsing, boundary timestamps, and binary search performance.
- `tests/capacitor-config.test.ts`: Capacitor configuration exports, `AndroidManifest.xml` cleartext traffic, permissions, and README validation.

---

## License

MIT
