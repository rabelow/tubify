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
3. Ensure Windows Firewall allows inbound LAN connections from your phone on port `9863` (and `5173` if testing the web UI before building the APK). Run in an **Administrator PowerShell** once:
   ```powershell
   New-NetFirewallRule -DisplayName "Tubify YTMDesktop Companion (9863)" -Direction Inbound -Protocol TCP -LocalPort 9863,5173 -Profile Private -Action Allow
   ```

## 2. Run & Validate in Mobile Browser (LAN Mode)

```powershell
npm install
npm test
npm run dev -- --host
```

1. Open `http://192.168.0.144:5173` on your Android phone (connected to the same Wi-Fi).
2. Confirm the host IP defaults to `192.168.0.144` and port `9863`, then tap **Connect & Pair**.
3. Verify the pairing code appears on the phone and a popup appears in YTMDesktop on Windows.
4. Click **Allow** in YTMDesktop on Windows.
5. Verify the phone transitions to **Now Playing** and displays the active track, artwork, and live progress.
6. Tap **Play/Pause**, **Next**, **Seek**, and adjust **Volume**; verify Windows audio responds within <500ms.
7. Switch to the **Queue** tab and tap any track to jump directly to it.
8. Switch to the **Playlists** tab and tap a playlist to start playing it.
9. Tap **Play Link**, paste a YouTube Music URL, and confirm playback starts on Windows.

## 3. Build Android APK (Capacitor)

```powershell
npm run build
npx cap sync android
npx cap open android
```

Build and install the debug APK onto your Android phone via Android Studio or `cd android && .\gradlew assembleDebug`.
