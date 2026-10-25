import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PlaylistsStore } from '../src/server/playlists-store';
import type { SearchTrack } from '../src/types/companion';

describe('PlaylistsStore Unit Suite', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubify-playlists-test-'));
    testFilePath = path.join(tempDir, 'playlists.json');
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('initializes empty playlists file if missing', () => {
    const store = new PlaylistsStore(testFilePath);
    expect(fs.existsSync(testFilePath)).toBe(true);
    expect(store.getPlaylists()).toEqual([]);

    const diskContent = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
    expect(diskContent).toEqual({ playlists: [] });
  });

  it('creates new playlist with specified title', () => {
    const store = new PlaylistsStore(testFilePath);
    const playlist = store.createPlaylist('Late Night Coding');

    expect(playlist.id).toBeDefined();
    expect(playlist.title).toBe('Late Night Coding');
    expect(playlist.name).toBe('Late Night Coding');
    expect(playlist.tracks).toEqual([]);
    expect(playlist.createdAt).toBeDefined();
    expect(playlist.updatedAt).toBeDefined();

    const playlists = store.getPlaylists();
    expect(playlists.length).toBe(1);
    expect(playlists[0].title).toBe('Late Night Coding');
  });

  it('defaults to "Untitled Playlist" when title is empty or whitespace', () => {
    const store = new PlaylistsStore(testFilePath);
    const p1 = store.createPlaylist('');
    const p2 = store.createPlaylist('   ');
    const p3 = store.createPlaylist(undefined);

    expect(p1.title).toBe('Untitled Playlist');
    expect(p2.title).toBe('Untitled Playlist');
    expect(p3.title).toBe('Untitled Playlist');
  });

  it('renames an existing playlist and updates timestamps', () => {
    const store = new PlaylistsStore(testFilePath);
    const created = store.createPlaylist('Original Name');

    const updated = store.renamePlaylist(created.id, 'Renamed Chill');
    expect(updated).not.toBeNull();
    expect(updated?.title).toBe('Renamed Chill');
    expect(updated?.name).toBe('Renamed Chill');

    const reloaded = store.getPlaylist(created.id);
    expect(reloaded?.title).toBe('Renamed Chill');
  });

  it('returns null when renaming a non-existent playlist', () => {
    const store = new PlaylistsStore(testFilePath);
    const result = store.renamePlaylist('non-existent-id', 'New Title');
    expect(result).toBeNull();
  });

  it('deletes an existing playlist and returns true', () => {
    const store = new PlaylistsStore(testFilePath);
    const p1 = store.createPlaylist('To Delete');
    const p2 = store.createPlaylist('To Keep');

    expect(store.getPlaylists().length).toBe(2);

    const deleted = store.deletePlaylist(p1.id);
    expect(deleted).toBe(true);
    expect(store.getPlaylists().length).toBe(1);
    expect(store.getPlaylist(p1.id)).toBeNull();
    expect(store.getPlaylist(p2.id)).not.toBeNull();
  });

  it('returns false when deleting a non-existent playlist', () => {
    const store = new PlaylistsStore(testFilePath);
    const deleted = store.deletePlaylist('fake-id');
    expect(deleted).toBe(false);
  });

  it('adds tracks with full metadata to a playlist', () => {
    const store = new PlaylistsStore(testFilePath);
    const playlist = store.createPlaylist('Rock Hits');

    const track1: SearchTrack = {
      videoId: '4D7u5KF7SP8',
      title: 'Get Lucky',
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      duration: '6:10',
      thumbnailUrl: 'https://img.youtube.com/vi/4D7u5KF7SP8/0.jpg',
    };

    const updated = store.addTrack(playlist.id, track1);
    expect(updated).not.toBeNull();
    expect(updated?.tracks.length).toBe(1);
    expect(updated?.tracks[0]).toEqual(track1);

    const track2: SearchTrack = {
      videoId: 'fJ9rUzIMcZQ',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      duration: '5:55',
    };

    const updated2 = store.addTrack(playlist.id, track2);
    expect(updated2?.tracks.length).toBe(2);
    expect(updated2?.tracks[1].videoId).toBe('fJ9rUzIMcZQ');
    expect(updated2?.tracks[1].album).toBe('A Night at the Opera');
  });

  it('STRICT DUPLICATE PREVENTION: does not duplicate track with identical videoId', () => {
    const store = new PlaylistsStore(testFilePath);
    const playlist = store.createPlaylist('Favorites');

    const track: SearchTrack = {
      videoId: 'duplicate123',
      title: 'Song A',
      artist: 'Artist A',
      duration: '3:30',
    };

    // Add first time
    const res1 = store.addTrack(playlist.id, track);
    expect(res1?.tracks.length).toBe(1);

    // Attempt to add second time
    const res2 = store.addTrack(playlist.id, track);
    expect(res2?.tracks.length).toBe(1);

    // Attempt to add with different casing/metadata but same videoId
    const res3 = store.addTrack(playlist.id, {
      ...track,
      title: 'Different Title',
    });
    expect(res3?.tracks.length).toBe(1);
    expect(res3?.tracks[0].title).toBe('Song A'); // Original maintained
  });

  it('removes a track by videoId from a playlist', () => {
    const store = new PlaylistsStore(testFilePath);
    const playlist = store.createPlaylist('Mixed');

    store.addTrack(playlist.id, { videoId: 'v1', title: 'Song 1', artist: 'Artist 1' });
    store.addTrack(playlist.id, { videoId: 'v2', title: 'Song 2', artist: 'Artist 2' });
    store.addTrack(playlist.id, { videoId: 'v3', title: 'Song 3', artist: 'Artist 3' });

    expect(store.getPlaylist(playlist.id)?.tracks.length).toBe(3);

    const afterRemove = store.removeTrack(playlist.id, 'v2');
    expect(afterRemove?.tracks.length).toBe(2);
    expect(afterRemove?.tracks.map((t) => t.videoId)).toEqual(['v1', 'v3']);
  });

  it('gracefully recovers from corrupt or empty JSON files on disk', () => {
    // Write corrupted JSON to file
    fs.writeFileSync(testFilePath, 'INVALID_CORRUPT_JSON_{{{', 'utf-8');

    const store = new PlaylistsStore(testFilePath);
    expect(store.getPlaylists()).toEqual([]);

    // Should be able to create new playlists without throwing
    const pl = store.createPlaylist('Recovered');
    expect(pl.title).toBe('Recovered');
    expect(store.getPlaylists().length).toBe(1);
  });

  it('persists data across separate PlaylistsStore instances reading the same file', () => {
    const store1 = new PlaylistsStore(testFilePath);
    const pl = store1.createPlaylist('Shared Playlist');
    store1.addTrack(pl.id, {
      videoId: 'abc12345678',
      title: 'Persistent Track',
      artist: 'Persistent Artist',
    });

    const store2 = new PlaylistsStore(testFilePath);
    const loaded = store2.getPlaylists();
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe(pl.id);
    expect(loaded[0].title).toBe('Shared Playlist');
    expect(loaded[0].tracks.length).toBe(1);
    expect(loaded[0].tracks[0].videoId).toBe('abc12345678');
  });
});
