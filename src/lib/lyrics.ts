/**
 * Tubify Lyrics Engine & LRCLIB Client
 * 
 * Provides:
 * 1. Track title cleaning heuristics (stripping YouTube video artifacts)
 * 2. High-precision LRC timestamp lexer and parser (handling multi-tags, centiseconds, ms, pauses)
 * 3. Logarithmic binary search active lyric line synchronizer
 * 4. LRCLIB API client with /api/get, /api/search fallback, candidate duration matching, and in-memory cache
 */

import type { LyricLine, TrackLyrics, VideoMetadata } from '../types/companion';

export type { LyricLine, TrackLyrics };

export interface LrclibResponse {
  id: number;
  name?: string;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  hasWordSync?: boolean;
  lyricsfile?: string;
}

export interface FetchLyricsOptions {
  signal?: AbortSignal;
  customFetch?: typeof fetch;
}

// In-memory cache for fetched lyrics to prevent redundant network requests
const lyricsCache = new Map<string, TrackLyrics>();

/**
 * Clears the in-memory lyrics cache (useful for testing or cache resets).
 */
export function clearLyricsCache(): void {
  lyricsCache.clear();
}

/**
 * Clean YouTube video titles by stripping promotional and format tags
 * e.g., "(Official Music Video)", "[Official Audio]", "(Lyric Video)", "(Remastered 2011)", "(feat. Artist)"
 */
export function cleanTrackTitle(title: string | null | undefined): string {
  if (!title) return '';

  let cleaned = title;

  // 1. Remove parenthesized or bracketed format/video descriptor tags containing keywords
  // e.g. (Official Music Video), [Official Lyric Video], [2011 - Remaster], (Visualizer), (Live at Wembley)
  cleaned = cleaned.replace(
    /\s*[\(\[][^)\]]*(?:official|music\s+video|video|audio|lyrics?|visualizer|remaster|live|radio\s+edit|hd|hq|4k)[^)\]]*[\)\]]/gi,
    ''
  );

  // 2. Remove parenthesized or bracketed featured artists like "(feat. X)" or "[ft. Y]"
  cleaned = cleaned.replace(/\s*[\(\[][^)\]]*(?:feat|ft)\.?[^)\]]*[\)\]]/gi, '');

  // 3. Remove standalone trailing suffixes like " - Official Video", " - Lyric Video", etc.
  cleaned = cleaned.replace(
    /\s*-\s*(?:official\s+(?:music\s+)?video|official\s+audio|lyric\s+video|visualizer|music\s+video).*$/gi,
    ''
  );

  // 4. Strip trailing dashes, underscores, and extra whitespace
  cleaned = cleaned.replace(/[\s\-_]+$/, '').trim();

  return cleaned;
}

/**
 * Parse raw LRC text into sorted, validated LyricLine items.
 * Handles standard centiseconds [mm:ss.xx], milliseconds [mm:ss.xxx], integer seconds [mm:ss],
 * multi-timestamp lines [00:10.00][00:20.00] Echo, skips ID/metadata tags [ar: ...],
 * and preserves empty lyric lines for musical interludes.
 */
export function parseLrc(lrcText: string | null | undefined): LyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines: LyricLine[] = [];
  const rawLines = lrcText.split(/\r?\n/);
  const timestampRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const stripRegex = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Collect all timestamps in this line
    const matches = Array.from(trimmed.matchAll(timestampRegex));
    if (matches.length === 0) {
      // Non-timestamped line or metadata tag like [ar: Queen], skip cleanly
      continue;
    }

    // Extract text with all timestamp tags stripped
    const text = trimmed.replace(stripRegex, '').trim();

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let fraction = 0;
      if (match[3]) {
        fraction = parseFloat('0.' + match[3]);
      }
      const timeSeconds = +(minutes * 60 + seconds + fraction).toFixed(3);
      lines.push({ timeSeconds, text });
    }
  }

  // Sort strictly monotonically ascending by timeSeconds
  lines.sort((a, b) => a.timeSeconds - b.timeSeconds);

  return lines;
}

/**
 * Logarithmic binary search O(log N) to determine the active lyric line index.
 * Returns -1 if no lines, before first line (intro), or negative time.
 * Returns lines.length - 1 if at or past the last line.
 */
export function getActiveLyricIndex(lines: LyricLine[], currentSeconds: number): number {
  if (!lines || lines.length === 0 || currentSeconds < 0) {
    return -1;
  }

  if (currentSeconds < lines[0].timeSeconds) {
    return -1;
  }

  let low = 0;
  let high = lines.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].timeSeconds <= currentSeconds) {
      result = mid;
      low = mid + 1; // Seek further right to find latest valid line
    } else {
      high = mid - 1;
    }
  }

  return result;
}

/**
 * Fetch lyrics from LRCLIB for the specified track.
 * 1. Checks in-memory cache first.
 * 2. Calls GET https://lrclib.net/api/get with track_name, artist_name, album_name, duration.
 * 3. Falls back to GET https://lrclib.net/api/search on 404 or missing synced lyrics.
 * 4. Selects candidate closest in duration within ±5s.
 * 5. Returns parsed TrackLyrics or null if unavailable.
 */
export async function fetchTrackLyrics(
  video: VideoMetadata | null | undefined,
  options?: FetchLyricsOptions
): Promise<TrackLyrics | null> {
  if (!video || !video.title) {
    return null;
  }

  const cleanedTitle = cleanTrackTitle(video.title);
  if (!cleanedTitle) {
    return null;
  }

  const artist = (video.author || '').trim();
  const cacheKey = video.id ? video.id : `${cleanedTitle}::${artist}`;

  // Check cache
  const cached = lyricsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fetchFn = options?.customFetch || fetch;
  const headers = {
    'User-Agent': 'Tubify/1.0.0 (https://github.com/rabelow/tubify)',
  };

  const durationSec = video.durationSeconds && video.durationSeconds > 0
    ? Math.round(video.durationSeconds)
    : undefined;

  let lrclibData: LrclibResponse | null = null;

  // 1. Attempt primary /api/get endpoint
  try {
    const getParams = new URLSearchParams({
      track_name: cleanedTitle,
      artist_name: artist,
    });
    if (video.album && video.album.trim().length > 0) {
      getParams.set('album_name', video.album.trim());
    }
    if (durationSec !== undefined) {
      getParams.set('duration', durationSec.toString());
    }

    const getRes = await fetchFn(`https://lrclib.net/api/get?${getParams.toString()}`, {
      headers,
      signal: options?.signal,
    });

    if (getRes.ok) {
      lrclibData = (await getRes.json()) as LrclibResponse;
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    // Network or parse issue on /api/get, continue to fallback
  }

  // 2. Fallback to /api/search if /api/get returned nothing or lacked synced lyrics
  if (!lrclibData || (!lrclibData.syncedLyrics && !lrclibData.instrumental && !lrclibData.plainLyrics)) {
    try {
      const searchParams = new URLSearchParams({
        track_name: cleanedTitle,
        artist_name: artist,
      });

      const searchRes = await fetchFn(`https://lrclib.net/api/search?${searchParams.toString()}`, {
        headers,
        signal: options?.signal,
      });

      if (searchRes.ok) {
        const results = (await searchRes.json()) as LrclibResponse[];
        if (Array.isArray(results) && results.length > 0) {
          // Candidate selection priority:
          // 1. Synced lyrics closest to duration (within ±5s if duration available)
          const syncedCandidates = results.filter((r) => r.syncedLyrics && r.syncedLyrics.trim().length > 0);
          if (syncedCandidates.length > 0) {
            if (durationSec !== undefined) {
              // Sort by proximity to expected duration
              syncedCandidates.sort(
                (a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec)
              );
            }
            lrclibData = syncedCandidates[0];
          } else {
            // 2. Instrumental or plain lyrics
            const fallbackCandidate = results.find(
              (r) => r.instrumental || (r.plainLyrics && r.plainLyrics.trim().length > 0)
            );
            if (fallbackCandidate) {
              lrclibData = fallbackCandidate;
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw err;
      }
      // Log search failure, continue
    }
  }

  if (!lrclibData) {
    return null;
  }

  const parsedLines = lrclibData.syncedLyrics ? parseLrc(lrclibData.syncedLyrics) : [];
  const trackLyrics: TrackLyrics = {
    videoId: video.id || '',
    synced: parsedLines.length > 0,
    instrumental: Boolean(lrclibData.instrumental),
    lines: parsedLines,
    plainText: lrclibData.plainLyrics || null,
  };

  // Cache successful parse result
  lyricsCache.set(cacheKey, trackLyrics);

  return trackLyrics;
}
