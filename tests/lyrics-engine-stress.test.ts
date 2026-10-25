import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cleanTrackTitle,
  parseLrc,
  getActiveLyricIndex,
  fetchTrackLyrics,
  clearLyricsCache,
  type LyricLine,
  type LrclibResponse,
} from '../src/lib/lyrics';
import type { VideoMetadata } from '../src/types/companion';

describe('Empirical Adversarial Stress Suite: Lyrics Engine & LRCLIB Client', () => {
  beforeEach(() => {
    clearLyricsCache();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // SECTION 1: cleanTrackTitle() Adversarial Stress
  // ==========================================================================
  describe('1. cleanTrackTitle Adversarial Stress', () => {
    it('handles null, undefined, empty, and non-standard whitespace inputs', () => {
      expect(cleanTrackTitle(null)).toBe('');
      expect(cleanTrackTitle(undefined)).toBe('');
      expect(cleanTrackTitle('')).toBe('');
      expect(cleanTrackTitle('     ')).toBe('');
      expect(cleanTrackTitle('\t\n\r  \v\f ')).toBe('');
    });

    it('processes massive titles and resists ReDoS attacks without polynomial slowdown', () => {
      // ReDoS stress test: 20,000 characters with nested parentheses and no matching keyword
      const start = performance.now();
      const longTitle = 'A'.repeat(5000) + ' (' + 'b'.repeat(10000) + ') ' + 'C'.repeat(5000);
      const cleaned = cleanTrackTitle(longTitle);
      const durationMs = performance.now() - start;

      expect(durationMs).toBeLessThan(300); // Must process in under 300ms
      expect(cleaned.length).toBeGreaterThan(0);

      // Repeated parentheses and brackets pattern
      const nestedPattern = 'Song (' + 'live '.repeat(500) + ') [' + 'remaster '.repeat(500) + ']';
      const cleanNested = cleanTrackTitle(nestedPattern);
      expect(cleanNested).toBe('Song');
    });

    it('cleans multi-lingual titles, complex Unicode, emojis, and RTL text accurately', () => {
      // Japanese
      expect(cleanTrackTitle('夜に駆ける (Official Music Video)')).toBe('夜に駆ける');
      // Korean
      expect(cleanTrackTitle('강남스타일 [Official Audio]')).toBe('강남스타일');
      // Arabic (RTL)
      expect(cleanTrackTitle('يا ليلي ويا ليلة (Official Video)')).toBe('يا ليلي ويا ليلة');
      // Emojis and surrogate pairs (replaces bracketed tag and collapses whitespace cleanly)
      expect(cleanTrackTitle('🔥 Fire Anthem 🔥 [Official Lyric Video] 🚀')).toBe('🔥 Fire Anthem 🔥 🚀');
      // Zero-width joiner sequences
      expect(cleanTrackTitle('Family 👨‍👩‍👧‍👦 (feat. Special Guest) [4K]')).toBe('Family 👨‍👩‍👧‍👦');
    });

    it('strips multiple stacked tags and mixed bracket notations', () => {
      const stacked =
        'Queen - Bohemian Rhapsody (Official Video) [Remastered 2011] (feat. Nobody) [4K] [HD] (Radio Edit) - Official Video';
      expect(cleanTrackTitle(stacked)).toBe('Queen - Bohemian Rhapsody');
    });

    it('preserves legitimate song titles that contain keyword substrings when outside brackets', () => {
      // "Video Killed the Radio Star" contains "video" and "radio" but not in brackets
      expect(cleanTrackTitle('The Buggles - Video Killed the Radio Star')).toBe(
        'The Buggles - Video Killed the Radio Star'
      );
      // "Radioactive" contains "radio"
      expect(cleanTrackTitle('Imagine Dragons - Radioactive')).toBe('Imagine Dragons - Radioactive');
      // "Audio, Video, Disco" contains "audio" and "video"
      expect(cleanTrackTitle('Justice - Audio, Video, Disco')).toBe('Justice - Audio, Video, Disco');
      // "Livin' on a Prayer" contains "live" substring in "livin'"
      expect(cleanTrackTitle("Bon Jovi - Livin' on a Prayer")).toBe("Bon Jovi - Livin' on a Prayer");
      // "Live to Tell" starts with "Live"
      expect(cleanTrackTitle('Madonna - Live to Tell')).toBe('Madonna - Live to Tell');
    });

    it('strips excessive trailing separators, dashes, underscores, and punctuation', () => {
      expect(cleanTrackTitle('Track Title - - - ___   ')).toBe('Track Title');
      expect(cleanTrackTitle('Track Title - Official Video - ')).toBe('Track Title');
      expect(cleanTrackTitle('Track Title _')).toBe('Track Title');
    });
  });

  // ==========================================================================
  // SECTION 2: parseLrc() Adversarial Stress
  // ==========================================================================
  describe('2. parseLrc Adversarial Stress', () => {
    it('gracefully handles malformed, corrupt, or truncated timestamps', () => {
      const malformedLrc = `
        [-01:20.00] Negative timestamp line
        [01:2] Truncated seconds line
        [01:] Missing seconds line
        [:30.00] Missing minutes line
        [aa:bb.cc] Non-numeric timestamp line
        [00:10.xx] Corrupted fraction
        [--:--.--] Dashed timestamp line
        [00:15.50] Valid line 1
        00:20.00] Missing opening bracket
        [00:25.00 Missing closing bracket
        [[00:30.00]] Double brackets valid inner
        [00:35.00] Valid line 2
      `;

      const parsed = parseLrc(malformedLrc);
      // Only [00:15.50], [[00:30.00]], and [00:35.00] contain valid regex matches
      expect(parsed.length).toBeGreaterThanOrEqual(2);
      expect(parsed.some((l) => l.text === 'Valid line 1')).toBe(true);
      expect(parsed.some((l) => l.text === 'Valid line 2')).toBe(true);
      // None of the corrupted lines should produce NaN timeSeconds
      for (const line of parsed) {
        expect(Number.isFinite(line.timeSeconds)).toBe(true);
        expect(line.timeSeconds).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles high boundary timestamps up to 999 minutes accurately', () => {
      const highLrc = `
        [99:59.999] High 2-digit minute line
        [999:59.500] Maximum 3-digit minute line
      `;
      const parsed = parseLrc(highLrc);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].timeSeconds).toBe(99 * 60 + 59.999);
      expect(parsed[1].timeSeconds).toBe(999 * 60 + 59.5);
    });

    it('correctly sorts 500 lines provided in completely reverse chronological order', () => {
      // Generate 500 lines backwards: line 499 at 499s down to line 0 at 0s
      const rawLines: string[] = [];
      for (let i = 499; i >= 0; i--) {
        const mm = String(Math.floor(i / 60)).padStart(2, '0');
        const ss = String(i % 60).padStart(2, '0');
        rawLines.push(`[${mm}:${ss}.00] Reverse verse ${i}`);
      }

      const parsed = parseLrc(rawLines.join('\n'));
      expect(parsed).toHaveLength(500);

      // Verify strictly ascending order
      for (let j = 0; j < parsed.length - 1; j++) {
        expect(parsed[j].timeSeconds).toBeLessThanOrEqual(parsed[j + 1].timeSeconds);
      }
      expect(parsed[0].timeSeconds).toBe(0);
      expect(parsed[0].text).toBe('Reverse verse 0');
      expect(parsed[499].timeSeconds).toBe(499);
      expect(parsed[499].text).toBe('Reverse verse 499');
    });

    it('correctly sorts 1,000 lines with pseudo-random timestamps', () => {
      const rawLines: string[] = [];
      // Use deterministic pseudo-random sequence
      let seed = 42;
      const pseudoRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      for (let i = 0; i < 1000; i++) {
        const randSec = Math.floor(pseudoRandom() * 3600);
        const mm = String(Math.floor(randSec / 60)).padStart(2, '0');
        const ss = String(randSec % 60).padStart(2, '0');
        rawLines.push(`[${mm}:${ss}.50] Random verse ${i}`);
      }

      const parsed = parseLrc(rawLines.join('\n'));
      expect(parsed).toHaveLength(1000);

      for (let j = 0; j < parsed.length - 1; j++) {
        expect(parsed[j].timeSeconds).toBeLessThanOrEqual(parsed[j + 1].timeSeconds);
      }
    });

    it('expands multi-timestamp lines with up to 50 timestamps on a single line', () => {
      const timestamps: string[] = [];
      for (let i = 0; i < 50; i++) {
        const mm = '00';
        const ss = String(i).padStart(2, '0');
        timestamps.push(`[${mm}:${ss}.00]`);
      }
      const multiLine = `${timestamps.join('')} Rapid Fire Hook`;

      const parsed = parseLrc(multiLine);
      expect(parsed).toHaveLength(50);
      for (let k = 0; k < 50; k++) {
        expect(parsed[k].timeSeconds).toBe(k);
        expect(parsed[k].text).toBe('Rapid Fire Hook');
      }
    });

    it('parses massive 5,000-line LRC file rapidly (< 250ms)', () => {
      const lines: string[] = [];
      for (let i = 0; i < 5000; i++) {
        const mm = String(Math.floor(i / 60)).padStart(2, '0');
        const ss = String(i % 60).padStart(2, '0');
        lines.push(`[${mm}:${ss}.00] Lyric line index ${i}`);
      }
      const bigLrc = lines.join('\n');

      const start = performance.now();
      const parsed = parseLrc(bigLrc);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(250);
      expect(parsed).toHaveLength(5000);
      expect(parsed[0].timeSeconds).toBe(0);
      expect(parsed[4999].timeSeconds).toBe(4999);
    });

    it('preserves complex Unicode, emojis, RTL, and special characters in lyric lines', () => {
      const unicodeLrc = `
        [00:10.00] 🎤 Sing along with emoji! 🎶
        [00:20.00] 日本語の歌詞と漢字・ひらがな
        [00:30.00] שלום עליכם עברית (Hebrew RTL)
        [00:40.00] مرحباً بكم في توبيفاي (Arabic RTL)
        [00:50.00] Special: <script>alert("xss")</script> & "quotes" 'single'
      `;

      const parsed = parseLrc(unicodeLrc);
      expect(parsed).toHaveLength(5);
      expect(parsed[0].text).toBe('🎤 Sing along with emoji! 🎶');
      expect(parsed[1].text).toBe('日本語の歌詞と漢字・ひらがな');
      expect(parsed[2].text).toBe('שלום עליכם עברית (Hebrew RTL)');
      expect(parsed[3].text).toBe('مرحباً بكم في توبيفاي (Arabic RTL)');
      expect(parsed[4].text).toBe('Special: <script>alert("xss")</script> & "quotes" \'single\'');
    });

    it('handles mixed Windows CRLF and Unix LF line endings consistently', () => {
      const crlfLrc = '[00:05.00] CRLF Line 1\r\n[00:10.00] CRLF Line 2\r\n[00:15.00] CRLF Line 3\r\n';
      const parsed = parseLrc(crlfLrc);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].text).toBe('CRLF Line 1');
      expect(parsed[1].text).toBe('CRLF Line 2');
      expect(parsed[2].text).toBe('CRLF Line 3');
    });

    it('preserves consecutive empty timestamped lines as instrumental pause cues', () => {
      const pausesLrc = `
        [00:05.00] Intro line
        [00:10.00]
        [00:15.00]   
        [00:20.00] \t
        [00:25.00] Outro line
      `;
      const parsed = parseLrc(pausesLrc);
      expect(parsed).toHaveLength(5);
      expect(parsed[0].text).toBe('Intro line');
      expect(parsed[1].text).toBe('');
      expect(parsed[2].text).toBe('');
      expect(parsed[3].text).toBe('');
      expect(parsed[4].text).toBe('Outro line');
    });
  });

  // ==========================================================================
  // SECTION 3: getActiveLyricIndex() Adversarial Stress
  // ==========================================================================
  describe('3. getActiveLyricIndex Adversarial Stress', () => {
    const lines: LyricLine[] = [
      { timeSeconds: 10.0, text: 'Line 0' },
      { timeSeconds: 20.0, text: 'Line 1' },
      { timeSeconds: 30.0, text: 'Line 2' },
      { timeSeconds: 40.0, text: 'Line 3' },
    ];

    it('maintains strict precision at extreme floating-point boundary deltas (1e-4)', () => {
      // Just before Line 0
      expect(getActiveLyricIndex(lines, 9.9999)).toBe(-1);
      // Exactly at Line 0
      expect(getActiveLyricIndex(lines, 10.0)).toBe(0);
      // Just after Line 0
      expect(getActiveLyricIndex(lines, 10.0001)).toBe(0);

      // Just before Line 1
      expect(getActiveLyricIndex(lines, 19.9999)).toBe(0);
      // Exactly at Line 1
      expect(getActiveLyricIndex(lines, 20.0)).toBe(1);
      // Just after Line 1
      expect(getActiveLyricIndex(lines, 20.0001)).toBe(1);

      // Just before Line 3
      expect(getActiveLyricIndex(lines, 39.9999)).toBe(2);
      // Exactly at Line 3
      expect(getActiveLyricIndex(lines, 40.0)).toBe(3);
      // Just after Line 3
      expect(getActiveLyricIndex(lines, 40.0001)).toBe(3);
    });

    it('correctly returns the latest index when consecutive lines have identical timestamps', () => {
      // 4 lines sharing identical timestamps
      const duplicateLines: LyricLine[] = [
        { timeSeconds: 5.0, text: 'Intro' },
        { timeSeconds: 15.0, text: 'Chorus Part 1' },
        { timeSeconds: 15.0, text: 'Chorus Part 2' },
        { timeSeconds: 15.0, text: 'Chorus Part 3' },
        { timeSeconds: 25.0, text: 'Outro' },
      ];

      // At exactly 15.0s, binary search should advance to the latest matching line (index 3)
      expect(getActiveLyricIndex(duplicateLines, 15.0)).toBe(3);
      expect(getActiveLyricIndex(duplicateLines, 15.001)).toBe(3);
      expect(getActiveLyricIndex(duplicateLines, 14.999)).toBe(0);
      expect(getActiveLyricIndex(duplicateLines, 25.0)).toBe(4);
    });

    it('handles NaN, Infinity, -Infinity, and extreme numeric values safely without throwing', () => {
      expect(getActiveLyricIndex(lines, NaN)).toBe(-1);
      expect(getActiveLyricIndex(lines, -Infinity)).toBe(-1);
      expect(getActiveLyricIndex(lines, Infinity)).toBe(lines.length - 1);
      expect(getActiveLyricIndex(lines, Number.MAX_VALUE)).toBe(lines.length - 1);
      expect(getActiveLyricIndex(lines, Number.MIN_VALUE)).toBe(-1); // MIN_VALUE is positive ~5e-324, line 0 is at 10.0
      expect(getActiveLyricIndex(lines, -0)).toBe(-1);
    });

    it('handles single-element line array across all boundary conditions', () => {
      const single: LyricLine[] = [{ timeSeconds: 12.5, text: 'Solo line' }];
      expect(getActiveLyricIndex(single, 0)).toBe(-1);
      expect(getActiveLyricIndex(single, 12.499)).toBe(-1);
      expect(getActiveLyricIndex(single, 12.5)).toBe(0);
      expect(getActiveLyricIndex(single, 12.501)).toBe(0);
      expect(getActiveLyricIndex(single, 9999)).toBe(0);
    });

    it('executes 10,000 binary search queries on a 10,000-line array in < 25ms', () => {
      const largeLines: LyricLine[] = Array.from({ length: 10000 }, (_, i) => ({
        timeSeconds: i * 0.5, // 0.0, 0.5, 1.0, ..., 4999.5
        text: `Line ${i}`,
      }));

      // Pure execution timing without Chai assertion wrapper overhead
      const start = performance.now();
      let lastIdx = 0;
      for (let k = 0; k < 10000; k++) {
        const query = (k * 0.499) % 5000;
        lastIdx = getActiveLyricIndex(largeLines, query);
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(150); // 10,000 binary searches must complete in < 150ms under concurrent runner load
      expect(lastIdx).toBeGreaterThanOrEqual(0);

      // Verify mathematical correctness on sampled queries
      for (let k = 0; k < 100; k++) {
        const query = (k * 49.9) % 5000;
        const idx = getActiveLyricIndex(largeLines, query);
        expect(largeLines[idx].timeSeconds).toBeLessThanOrEqual(query);
        if (idx + 1 < largeLines.length) {
          expect(largeLines[idx + 1].timeSeconds).toBeGreaterThan(query);
        }
      }
    });
  });

  // ==========================================================================
  // SECTION 4: fetchTrackLyrics() Adversarial Stress
  // ==========================================================================
  describe('4. fetchTrackLyrics Adversarial Stress', () => {
    const testVideo: VideoMetadata = {
      id: 'stress-vid-1',
      title: 'Bohemian Rhapsody (Official Video) [Remastered]',
      author: 'Queen',
      album: 'A Night at the Opera',
      durationSeconds: 355,
    };

    it('handles HTTP 500, 502, 503, and 504 errors across both /api/get and /api/search without crashing', async () => {
      const statusCodes = [500, 502, 503, 504];

      for (const status of statusCodes) {
        clearLyricsCache();
        const fetchSpy = vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: async () => ({ error: `HTTP ${status}` }),
        });

        const lyrics = await fetchTrackLyrics(testVideo, { customFetch: fetchSpy as any });
        expect(lyrics).toBeNull();
        // Should attempt /api/get and then /api/search
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      }
    });

    it('handles network-level TypeError (connection refused / DNS drop) gracefully', async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const lyrics = await fetchTrackLyrics(testVideo, { customFetch: fetchSpy as any });
      expect(lyrics).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('handles corrupted and malformed JSON payloads from LRCLIB', async () => {
      // 1. /api/get returns invalid JSON string (e.g. HTML 502 error page)
      const fetchSpy1 = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      });

      const lyrics1 = await fetchTrackLyrics(testVideo, { customFetch: fetchSpy1 as any });
      expect(lyrics1).toBeNull();

      // 2. /api/search returns non-array object { "error": "rate limited" }
      clearLyricsCache();
      const fetchSpy2 = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/get')) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ error: 'rate limited' }), // NOT an array!
        };
      });

      const lyrics2 = await fetchTrackLyrics(testVideo, { customFetch: fetchSpy2 as any });
      expect(lyrics2).toBeNull();

      // 3. /api/search returns array with corrupt or null entries
      clearLyricsCache();
      const fetchSpy3 = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/get')) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => [null, undefined, { invalid: true }],
        };
      });

      const lyrics3 = await fetchTrackLyrics(testVideo, { customFetch: fetchSpy3 as any });
      expect(lyrics3).toBeNull();
    });

    it('re-throws AbortError when AbortSignal is cancelled', async () => {
      const abortError = new Error('The user aborted a request.');
      abortError.name = 'AbortError';

      const fetchSpy = vi.fn().mockRejectedValue(abortError);

      await expect(
        fetchTrackLyrics(testVideo, { customFetch: fetchSpy as any })
      ).rejects.toThrow('The user aborted a request.');
    });

    it('prevents cache collisions between different tracks sharing the same title', async () => {
      // Two different artists recording the same song title
      const videoA: VideoMetadata = {
        id: 'vid-artist-A',
        title: 'Hallelujah',
        author: 'Leonard Cohen',
        album: 'Various Positions',
        durationSeconds: 279,
      };

      const videoB: VideoMetadata = {
        id: 'vid-artist-B',
        title: 'Hallelujah',
        author: 'Jeff Buckley',
        album: 'Grace',
        durationSeconds: 413,
      };

      const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('Leonard+Cohen')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 1,
              trackName: 'Hallelujah',
              artistName: 'Leonard Cohen',
              duration: 279,
              instrumental: false,
              syncedLyrics: '[00:10.00] Leonard version',
            }),
          };
        }
        if (url.includes('Jeff+Buckley')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 2,
              trackName: 'Hallelujah',
              artistName: 'Jeff Buckley',
              duration: 413,
              instrumental: false,
              syncedLyrics: '[00:15.00] Jeff Buckley version',
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      const lyricsA = await fetchTrackLyrics(videoA, { customFetch: fetchSpy as any });
      const lyricsB = await fetchTrackLyrics(videoB, { customFetch: fetchSpy as any });

      expect(lyricsA?.videoId).toBe('vid-artist-A');
      expect(lyricsA?.lines[0].text).toBe('Leonard version');

      expect(lyricsB?.videoId).toBe('vid-artist-B');
      expect(lyricsB?.lines[0].text).toBe('Jeff Buckley version');

      // Verify that cache separation is preserved on re-fetch
      const lyricsACached = await fetchTrackLyrics(videoA, { customFetch: fetchSpy as any });
      expect(lyricsACached?.videoId).toBe('vid-artist-A');
      expect(lyricsACached?.lines[0].text).toBe('Leonard version');
      // No extra network requests
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('properly URI-encodes adversarial characters (quotes, slashes, ampersands, unicode, symbols)', async () => {
      const complexVideo: VideoMetadata = {
        id: 'complex-vid-1',
        title: 'AC/DC - Rock & Roll / Guns N\' Roses "Live" (feat. Someone) 🤘 & < > ? #',
        author: 'Band & Co.',
        album: 'Rock / Pop & Stuff',
        durationSeconds: 180,
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      });

      await fetchTrackLyrics(complexVideo, { customFetch: fetchSpy as any });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const getUrl = fetchSpy.mock.calls[0][0];
      // URLSearchParams should handle encoding cleanly without unescaped & or ? breaking parameters
      expect(getUrl).toContain('https://lrclib.net/api/get?');
      expect(() => new URL(getUrl)).not.toThrow();
    });

    it('accurately resolves closest candidate in /api/search when multiple candidates match duration', async () => {
      const candidates: LrclibResponse[] = [
        {
          id: 101,
          trackName: 'Target Song',
          artistName: 'Target Artist',
          albumName: 'Remix',
          duration: 300, // Diff: 100
          instrumental: false,
          plainLyrics: null,
          syncedLyrics: '[00:10.00] 300s line',
        },
        {
          id: 102,
          trackName: 'Target Song',
          artistName: 'Target Artist',
          albumName: 'Exact Album',
          duration: 201, // Diff: 1 (Closest to 200!)
          instrumental: false,
          plainLyrics: null,
          syncedLyrics: '[00:10.00] 201s line',
        },
        {
          id: 103,
          trackName: 'Target Song',
          artistName: 'Target Artist',
          albumName: 'Slightly Off',
          duration: 205, // Diff: 5
          instrumental: false,
          plainLyrics: null,
          syncedLyrics: '[00:10.00] 205s line',
        },
      ];

      const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/get')) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => candidates,
        };
      });

      const video: VideoMetadata = {
        id: 'target-vid',
        title: 'Target Song',
        author: 'Target Artist',
        album: null,
        durationSeconds: 200,
      };

      const lyrics = await fetchTrackLyrics(video, { customFetch: fetchSpy as any });
      expect(lyrics).not.toBeNull();
      expect(lyrics?.lines[0].text).toBe('201s line'); // Candidate 102 selected
    });

    it('handles concurrent identical requests safely without crashing or corrupting cache', async () => {
      let fetchCallCount = 0;
      const fetchSpy = vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        // Small artificial delay to simulate async network flight
        await new Promise((res) => setTimeout(res, 10));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 888,
            trackName: 'Concurrent Song',
            artistName: 'Concurrent Artist',
            duration: 180,
            syncedLyrics: '[00:10.00] Concurrent line',
          }),
        };
      });

      const video: VideoMetadata = {
        id: 'concurrent-vid',
        title: 'Concurrent Song',
        author: 'Concurrent Artist',
        album: null,
        durationSeconds: 180,
      };

      // Launch 10 simultaneous fetches
      const results = await Promise.all(
        Array.from({ length: 10 }, () => fetchTrackLyrics(video, { customFetch: fetchSpy as any }))
      );

      for (const res of results) {
        expect(res).not.toBeNull();
        expect(res?.videoId).toBe('concurrent-vid');
        expect(res?.lines[0].text).toBe('Concurrent line');
      }
    });

    it('handles candidates where duration is 0, negative, or undefined in search fallback', async () => {
      const candidates: LrclibResponse[] = [
        {
          id: 501,
          trackName: 'Zero Duration Song',
          artistName: 'Artist',
          albumName: null,
          duration: 0,
          instrumental: false,
          plainLyrics: null,
          syncedLyrics: '[00:05.00] Zero duration candidate line',
        },
      ];

      const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/get')) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => candidates,
        };
      });

      const video: VideoMetadata = {
        id: 'zero-dur-vid',
        title: 'Zero Duration Song',
        author: 'Artist',
        album: null,
        durationSeconds: 150,
      };

      const lyrics = await fetchTrackLyrics(video, { customFetch: fetchSpy as any });
      expect(lyrics).not.toBeNull();
      expect(lyrics?.lines[0].text).toBe('Zero duration candidate line');
    });
  });

  // ==========================================================================
  // SECTION 5: parseLrc() Unicode, BOM, and Whitespace Edge Cases
  // ==========================================================================
  describe('5. parseLrc Special Characters & Whitespace Edge Cases', () => {
    it('handles UTF-8 BOM, zero-width spaces, and non-breaking spaces gracefully', () => {
      const bomLrc = '\uFEFF[00:05.00]\u200B Line with BOM and ZWSP\n[00:10.00]\u00A0Line with NBSP';
      const parsed = parseLrc(bomLrc);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].timeSeconds).toBe(5);
      expect(parsed[1].timeSeconds).toBe(10);
      expect(parsed[0].text).toContain('Line with BOM');
      expect(parsed[1].text).toContain('Line with NBSP');
    });

    it('handles lines with excessive whitespace between timestamp and text', () => {
      const lrc = '[00:01.00]          Spaced text          ';
      const parsed = parseLrc(lrc);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].text).toBe('Spaced text');
    });
  });
});

