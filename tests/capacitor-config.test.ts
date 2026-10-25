import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import config from '../capacitor.config';

describe('Capacitor Configuration & Android Packaging (Tasks T026, T027, T028)', () => {
  const rootDir = path.resolve(__dirname, '..');
  const manifestPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const readmePath = path.join(rootDir, 'README.md');

  describe('capacitor.config.ts (T026)', () => {
    it('exports a valid default configuration object', () => {
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('has expected appId, appName, and webDir', () => {
      expect(config.appId).toBe('com.rabelow.tubify');
      expect(config.appName).toBe('Tubify');
      expect(config.webDir).toBe('dist');
    });

    it('enables cleartext traffic and sets androidScheme to http for LAN communication', () => {
      expect(config.server).toBeDefined();
      expect(config.server?.cleartext).toBe(true);
      expect(config.server?.androidScheme).toBe('http');
    });
  });

  describe('AndroidManifest.xml Configuration (T027)', () => {
    it('android manifest file exists at android/app/src/main/AndroidManifest.xml', () => {
      expect(fs.existsSync(manifestPath)).toBe(true);
    });

    it('enables android:usesCleartextTraffic="true" on application element', () => {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      expect(content).toContain('android:usesCleartextTraffic="true"');
      // Ensure it is placed inside <application>
      const applicationMatch = content.match(/<application[\s\S]*?>/);
      expect(applicationMatch).not.toBeNull();
      expect(applicationMatch![0]).toContain('android:usesCleartextTraffic="true"');
    });

    it('declares android.permission.INTERNET', () => {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      expect(content).toContain('<uses-permission android:name="android.permission.INTERNET" />');
    });

    it('declares android.permission.ACCESS_NETWORK_STATE', () => {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      expect(content).toContain('<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />');
    });

    it('contains standard launcher activity definition', () => {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      expect(content).toContain('android:name=".MainActivity"');
      expect(content).toContain('android.intent.action.MAIN');
      expect(content).toContain('android.intent.category.LAUNCHER');
    });
  });

  describe('Project Documentation (README.md - T028)', () => {
    it('README.md exists at project root', () => {
      expect(fs.existsSync(readmePath)).toBe(true);
    });

    it('documents YTMDesktop v2 Companion Server prerequisite and port 9863', () => {
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content).toContain('9863');
      expect(content).toMatch(/YTMDesktop|Companion Server/i);
    });

    it('documents PowerShell firewall rule for LAN access', () => {
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content).toContain('New-NetFirewallRule');
      expect(content).toContain('9863,5173');
      expect(content).toContain('Tubify YTMDesktop Companion');
    });

    it('documents all core feature areas', () => {
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content).toMatch(/Now Playing/i);
      expect(content).toMatch(/Remote Volume/i);
      expect(content).toMatch(/Queue/i);
      expect(content).toMatch(/Search/i);
      expect(content).toMatch(/Playlists/i);
      expect(content).toMatch(/Karaoke|Lyrics/i);
      expect(content).toMatch(/Capacitor|Android/i);
    });

    it('documents development usage with --host flag', () => {
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content).toContain('npm run dev -- --host');
    });

    it('documents Android APK build workflow (sync and gradle)', () => {
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content).toContain('npx cap sync');
      expect(content).toMatch(/assembleDebug|cap open android/);
    });
  });
});
