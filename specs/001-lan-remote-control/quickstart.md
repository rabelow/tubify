# Quickstart & Validation Guide: Tubify LAN Remote

## 1. Prerequisites on Windows PC

1. **YTMDesktop v2** is running with:
   - **Settings -> Integrations -> Companion Server** enabled (port `9863`).
   - **Settings -> Integrations -> Enable Companion Authorization** enabled.
2. Verify the local Companion Server responds:
   ```powershell
   Invoke-RestMethod http://192.168.0.144:9863/metadata
   # Expected: apiVersions : {v1}
   ```
3. Ensure Windows Firewall allows inbound LAN connections from your phone on port `9863` and `5173`. Run in an **Administrator PowerShell** once:
   ```powershell
   New-NetFirewallRule -DisplayName "Tubify LAN Remote (9863, 5173)" -Direction Inbound -Protocol TCP -LocalPort 9863,5173 -Profile Private -Action Allow
   ```

## 2. Run & Validate in Mobile Browser (LAN Mode)

```powershell
npm install
npm test
npm run dev -- --host
```

1. Open `http://192.168.0.144:5173` on your Android phone (connected to the same Wi-Fi).
2. **US1 — Pair, Playback & Remote Volume**:
   - Confirm the host IP defaults to `192.168.0.144` and port `9863`, then tap **Connect & Pair**.
   - Click **Allow** in YTMDesktop on Windows when the pairing code appears.
   - Verify the **Now Playing** screen shows live track info, artwork, and progress.
   - Drag the **Remote Volume slider** (`0–100%`), tap `-5%` / `+5%`, and toggle **Mute/Unmute**; verify Windows audio volume responds immediately.
   - Tap **Play/Pause**, **Next**, **Seek**, **Shuffle**, **Repeat**, and **Like/Dislike**.
3. **US2 — Queue**:
   - Switch to the **Queue** tab and tap any upcoming track to jump directly to it on Windows.
4. **US3 — Search & Playlist Editing**:
   - Switch to the **Search** tab, type a song or artist, and tap **Play** to start it on Windows or **+ Playlist** to add it to a playlist.
   - Switch to the **Playlists** tab, create a playlist, open it, verify added songs appear, remove a song, and tap **Play Playlist** to play it on Windows.
5. **US4 — Karaoke Synced Lyrics**:
   - Switch to the **Lyrics** tab while a song is playing.
   - Verify time-synced lyrics highlight and auto-scroll in sync with the music, and tap any lyric line to seek the Windows player to that line.

## 3. Build Android APK (Capacitor)

```powershell
npm run build
npx cap sync android
npx cap open android
```

Build and install the APK onto your Android phone via Android Studio or `cd android && .\gradlew assembleDebug`. Keep `npm run dev -- --host` (or `npm run preview -- --host`) running on the Windows PC when using Search and Editable Playlists from the APK.
