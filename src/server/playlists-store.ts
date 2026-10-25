/**
 * Tubify PlaylistsStore
 * 
 * Persistent storage for user-created editable playlists backed by data/playlists.json.
 * Features:
 * 1. Atomic file writes via temporary sibling files and rename
 * 2. Automatic directory and file initialization
 * 3. Strict duplicate track prevention by videoId (idempotent addition)
 * 4. Resilient error handling and corruption fallback
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { EditablePlaylist, SearchTrack } from '../types/companion';

export interface PlaylistsFileContent {
  playlists: EditablePlaylist[];
}

export class PlaylistsStore {
  private filePath: string;
  private playlists: EditablePlaylist[] = [];

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(process.cwd(), 'data', 'playlists.json');
    this.init();
  }

  /**
   * Initializes storage directory and loads initial data.
   */
  private init(): void {
    const dir = path.dirname(this.filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.error(`[tubify:playlists] Failed to ensure directory ${dir}:`, err);
    }

    this.readFromDisk();
  }

  /**
   * Reads data from disk. If file is missing or corrupt, initializes to empty playlists array.
   */
  private readFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      this.playlists = [];
      this.writeToDisk();
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      if (!raw || !raw.trim()) {
        this.playlists = [];
        this.writeToDisk();
        return;
      }

      const parsed = JSON.parse(raw);
      const rawList = Array.isArray(parsed?.playlists)
        ? parsed.playlists
        : (Array.isArray(parsed) ? parsed : []);
      this.playlists = rawList
        .filter((pl: any) => pl && typeof pl === 'object')
        .map((pl: any) => this.normalizePlaylist(pl))
        .filter((pl: EditablePlaylist | null): pl is EditablePlaylist => pl !== null);
    } catch (err) {
      console.warn(`[tubify:playlists] Failed to parse ${this.filePath}, resetting to empty:`, err);
      this.playlists = [];
      this.writeToDisk();
    }
  }

  /**
   * Ensures playlist entity conforms to EditablePlaylist.
   */
  private normalizePlaylist(pl: any): EditablePlaylist | null {
    if (!pl || typeof pl !== 'object') return null;

    const title = typeof pl.title === 'string' && pl.title.trim()
      ? pl.title.trim()
      : (typeof pl.name === 'string' && pl.name.trim() ? pl.name.trim() : 'Untitled Playlist');

    return {
      id: String(pl.id ?? crypto.randomUUID()),
      title,
      name: title,
      createdAt: typeof pl.createdAt === 'string' ? pl.createdAt : new Date().toISOString(),
      updatedAt: typeof pl.updatedAt === 'string' ? pl.updatedAt : new Date().toISOString(),
      tracks: Array.isArray(pl.tracks)
        ? pl.tracks.filter((t: any) => t && typeof t.videoId === 'string').map((t: any) => ({
            videoId: String(t.videoId),
            title: String(t.title ?? 'Unknown Title'),
            artist: String(t.artist ?? 'Unknown Artist'),
            album: t.album ? String(t.album) : undefined,
            duration: t.duration ? String(t.duration) : undefined,
            thumbnailUrl: t.thumbnailUrl ? String(t.thumbnailUrl) : undefined,
          }))
        : [],
    };
  }

  /**
   * Atomically writes playlists data to disk using a sibling temp file.
   */
  private writeToDisk(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const payload: PlaylistsFileContent = {
      playlists: this.playlists,
    };
    const jsonStr = JSON.stringify(payload, null, 2);

    const tempFile = path.join(
      dir,
      `.playlists.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      fs.writeFileSync(tempFile, jsonStr, 'utf-8');
      try {
        fs.renameSync(tempFile, this.filePath);
      } catch (renameErr) {
        // Fallback for Windows file locks or cross-device edge cases
        fs.copyFileSync(tempFile, this.filePath);
        fs.unlinkSync(tempFile);
      }
    } catch (err) {
      // Clean up temp file if left behind
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch {}
      }
      console.error(`[tubify:playlists] Error saving playlists to disk:`, err);
      throw err;
    }
  }

  /**
   * Returns a list of all editable playlists.
   */
  public getPlaylists(): EditablePlaylist[] {
    return this.playlists.map((pl) => ({
      ...pl,
      tracks: [...pl.tracks],
    }));
  }

  /**
   * Finds a playlist by ID. Returns null if not found.
   */
  public getPlaylist(id: string): EditablePlaylist | null {
    const found = this.playlists.find((pl) => pl.id === id);
    if (!found) return null;
    return {
      ...found,
      tracks: [...found.tracks],
    };
  }

  /**
   * Creates a new playlist with the specified title (defaults to "Untitled Playlist").
   */
  public createPlaylist(title?: string): EditablePlaylist {
    const cleanTitle = title && title.trim() ? title.trim() : 'Untitled Playlist';
    const now = new Date().toISOString();
    const newPlaylist: EditablePlaylist = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      name: cleanTitle,
      createdAt: now,
      updatedAt: now,
      tracks: [],
    };

    this.playlists.push(newPlaylist);
    this.writeToDisk();
    return { ...newPlaylist, tracks: [] };
  }

  /**
   * Renames an existing playlist. Returns null if not found.
   */
  public renamePlaylist(id: string, title: string): EditablePlaylist | null {
    const pl = this.playlists.find((item) => item.id === id);
    if (!pl) return null;

    const cleanTitle = title && title.trim() ? title.trim() : 'Untitled Playlist';
    pl.title = cleanTitle;
    pl.name = cleanTitle;
    pl.updatedAt = new Date().toISOString();

    this.writeToDisk();
    return { ...pl, tracks: [...pl.tracks] };
  }

  /**
   * Deletes a playlist by ID. Returns true if deleted, false if not found.
   */
  public deletePlaylist(id: string): boolean {
    const index = this.playlists.findIndex((pl) => pl.id === id);
    if (index === -1) return false;

    this.playlists.splice(index, 1);
    this.writeToDisk();
    return true;
  }

  /**
   * Adds a track to a playlist.
   * If a track with the same videoId already exists in the playlist,
   * duplicate addition is prevented and the existing playlist is returned unmodified.
   */
  public addTrack(id: string, track: SearchTrack): EditablePlaylist | null {
    const pl = this.playlists.find((item) => item.id === id);
    if (!pl) return null;

    if (!track || typeof track.videoId !== 'string' || !track.videoId.trim()) {
      throw new Error('Track must have a valid videoId');
    }

    const cleanVideoId = typeof track.videoId === 'string' ? track.videoId.trim() : '';

    // Duplicate Prevention Check
    const alreadyExists = pl.tracks.some((t) => t.videoId === cleanVideoId);
    if (alreadyExists) {
      return { ...pl, tracks: [...pl.tracks] };
    }

    const cleanTrack: SearchTrack = {
      videoId: cleanVideoId,
      title: (track.title ?? 'Unknown Title').trim(),
      artist: (track.artist ?? 'Unknown Artist').trim(),
      album: track.album ? track.album.trim() : undefined,
      duration: track.duration ? track.duration.trim() : undefined,
      thumbnailUrl: track.thumbnailUrl ? track.thumbnailUrl.trim() : undefined,
    };

    pl.tracks.push(cleanTrack);
    pl.updatedAt = new Date().toISOString();

    this.writeToDisk();
    return { ...pl, tracks: [...pl.tracks] };
  }

  /**
   * Removes a track from a playlist by videoId. Returns null if playlist not found.
   */
  public removeTrack(id: string, videoId: string): EditablePlaylist | null {
    const pl = this.playlists.find((item) => item.id === id);
    if (!pl) return null;

    const initialLen = pl.tracks.length;
    const targetId = typeof videoId === 'string' ? videoId.trim() : '';
    pl.tracks = pl.tracks.filter((t) => t.videoId !== targetId);

    if (pl.tracks.length !== initialLen) {
      pl.updatedAt = new Date().toISOString();
      this.writeToDisk();
    }

    return { ...pl, tracks: [...pl.tracks] };
  }
}
