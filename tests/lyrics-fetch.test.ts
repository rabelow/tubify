import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchTrackLyrics,
  clearLyricsCache,
  type LrclibResponse,
} from '../src/lib/lyrics';
import type { VideoMetadata } from '../src/types/companion';

describe('T023: fetchTrackLyrics & LRCLIB Network Client Suite', () => {
  const sampleVideo: VideoMetadata = {
    id: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up (Official Music Video)',
    author: 'Rick Astley',
    album: 'Whenever You Need Somebody',
    durationSeconds: 213,
  };

  const sampleLrc = `
    [00:18.50] We're no strangers to love
    [00:22.80] You know the rules and so do I
    [00:27.10] A full commitment's what I'm thinking of
  `;

  beforeEach(() => {
    clearLyricsCache();
    vi.restoreAllMocks();
  });

  it('returns null immediately when video is null, undefined, or missing title', async () => {
    const fetchSpy = vi.fn();
    expect(await fetchTrackLyrics(null, { customFetch: fetchSpy as any })).toBeNull();
    expect(await fetchTrackLyrics(undefined, { customFetch: fetchSpy as any })).toBeNull();
    expect(
      await fetchTrackLyrics(
        { id: '123', title: '', author: '', album: null, durationSeconds: 0 },
        { customFetch: fetchSpy as any }
      )
    ).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches successfully from /api/get and parses synced lyrics', async () => {
    const mockResponse: LrclibResponse = {
      id: 1001,
      trackName: 'Never Gonna Give You Up',
      artistName: 'Rick Astley',
      albumName: 'Whenever You Need Somebody',
      duration: 213,
      instrumental: false,
      plainLyrics: "We're no strangers to love...",
      syncedLyrics: sampleLrc,
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const lyrics = await fetchTrackLyrics(sampleVideo, { customFetch: fetchSpy as any });

    expect(lyrics).not.toBeNull();
    expect(lyrics?.videoId).toBe('dQw4w9WgXcQ');
    expect(lyrics?.synced).toBe(true);
    expect(lyrics?.instrumental).toBe(false);
    expect(lyrics?.lines).toHaveLength(3);
    expect(lyrics?.lines[0]).toEqual({ timeSeconds: 18.5, text: "We're no strangers to love" });
    expect(lyrics?.plainText).toBe("We're no strangers to love...");

    // Verify /api/get URL parameters cleaned the title
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain('https://lrclib.net/api/get?');
    expect(calledUrl).toContain('track_name=Never+Gonna+Give+You+Up');
    expect(calledUrl).toContain('artist_name=Rick+Astley');
    expect(calledUrl).toContain('duration=213');
  });

  it('falls back to /api/search when /api/get returns 404 and picks closest duration candidate', async () => {
    const searchCandidates: LrclibResponse[] = [
      {
        id: 2001,
        trackName: 'Never Gonna Give You Up',
        artistName: 'Rick Astley',
        albumName: 'Extended Mix',
        duration: 350, // Far from 213s
        instrumental: false,
        plainLyrics: null,
        syncedLyrics: '[00:10.00] Extended line 1\n[00:20.00] Extended line 2',
      },
      {
        id: 2002,
        trackName: 'Never Gonna Give You Up',
        artistName: 'Rick Astley',
        albumName: 'Album Version',
        duration: 214, // Closest to 213s!
        instrumental: false,
        plainLyrics: 'Album plain lyrics',
        syncedLyrics: sampleLrc,
      },
      {
        id: 2003,
        trackName: 'Never Gonna Give You Up (Radio Edit)',
        artistName: 'Rick Astley',
        albumName: 'Radio',
        duration: 180,
        instrumental: false,
        plainLyrics: null,
        syncedLyrics: '[00:15.00] Radio edit line',
      },
    ];

    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/get')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ statusCode: 404, message: 'TrackNotFound' }),
        };
      }
      if (url.includes('/api/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => searchCandidates,
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const lyrics = await fetchTrackLyrics(sampleVideo, { customFetch: fetchSpy as any });

    expect(lyrics).not.toBeNull();
    expect(lyrics?.synced).toBe(true);
    // Should have selected id 2002 (duration 214 closest to 213)
    expect(lyrics?.lines).toHaveLength(3);
    expect(lyrics?.lines[0].timeSeconds).toBe(18.5);
    expect(lyrics?.plainText).toBe('Album plain lyrics');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('handles instrumental tracks correctly', async () => {
    const instrumentalResponse: LrclibResponse = {
      id: 3001,
      trackName: 'YYZ',
      artistName: 'Rush',
      albumName: 'Moving Pictures',
      duration: 266,
      instrumental: true,
      plainLyrics: null,
      syncedLyrics: null,
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => instrumentalResponse,
    });

    const instrumentalVideo: VideoMetadata = {
      id: 'yyz-rush',
      title: 'YYZ',
      author: 'Rush',
      album: 'Moving Pictures',
      durationSeconds: 266,
    };

    const lyrics = await fetchTrackLyrics(instrumentalVideo, { customFetch: fetchSpy as any });
    expect(lyrics).not.toBeNull();
    expect(lyrics?.instrumental).toBe(true);
    expect(lyrics?.synced).toBe(false);
    expect(lyrics?.lines).toEqual([]);
  });

  it('handles plain lyrics fallback when no synced lyrics are available', async () => {
    const plainLyricsResponse: LrclibResponse = {
      id: 4001,
      trackName: 'Obscure Indie Song',
      artistName: 'Indie Artist',
      albumName: 'EP',
      duration: 180,
      instrumental: false,
      plainLyrics: 'Line 1 of poem\nLine 2 of poem\nLine 3 of poem',
      syncedLyrics: null,
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => plainLyricsResponse,
    });

    const video: VideoMetadata = {
      id: 'indie-123',
      title: 'Obscure Indie Song',
      author: 'Indie Artist',
      album: 'EP',
      durationSeconds: 180,
    };

    const lyrics = await fetchTrackLyrics(video, { customFetch: fetchSpy as any });
    expect(lyrics).not.toBeNull();
    expect(lyrics?.synced).toBe(false);
    expect(lyrics?.instrumental).toBe(false);
    expect(lyrics?.lines).toEqual([]);
    expect(lyrics?.plainText).toContain('Line 1 of poem');
  });

  it('uses in-memory cache on subsequent requests for the same track', async () => {
    const mockResponse: LrclibResponse = {
      id: 5001,
      trackName: 'Cached Song',
      artistName: 'Artist',
      albumName: null,
      duration: 120,
      instrumental: false,
      plainLyrics: 'Some lyrics',
      syncedLyrics: '[00:10.00] Line one',
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const video: VideoMetadata = {
      id: 'cache-test-video-id',
      title: 'Cached Song',
      author: 'Artist',
      album: null,
      durationSeconds: 120,
    };

    // First call: hits network
    const lyrics1 = await fetchTrackLyrics(video, { customFetch: fetchSpy as any });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lyrics1?.lines[0].text).toBe('Line one');

    // Second call: served from in-memory cache
    const lyrics2 = await fetchTrackLyrics(video, { customFetch: fetchSpy as any });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // Still 1!
    expect(lyrics2).toBe(lyrics1);
  });

  it('returns null gracefully when neither /api/get nor /api/search find results', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/get')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ statusCode: 404, message: 'TrackNotFound' }),
        };
      }
      if (url.includes('/api/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => [], // No items found
        };
      }
      return { ok: false, status: 500 };
    });

    const video: VideoMetadata = {
      id: 'unknown-song-xyz',
      title: 'Unknown Track with No Lyrics Anywhere',
      author: 'Unknown Artist',
      album: null,
      durationSeconds: 120,
    };

    const lyrics = await fetchTrackLyrics(video, { customFetch: fetchSpy as any });
    expect(lyrics).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('handles server network failure or 503 overload without crashing', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('503 Service Unavailable: ServerOverloaded'));

    const video: VideoMetadata = {
      id: 'overload-test',
      title: 'Overload Song',
      author: 'Popular Artist',
      album: null,
      durationSeconds: 200,
    };

    const lyrics = await fetchTrackLyrics(video, { customFetch: fetchSpy as any });
    expect(lyrics).toBeNull();
  });
});
