import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PlaylistsStore } from '../src/server/playlists-store';
import {
  extractVideoId,
  parseSearchItem,
  parseInnertubeResponse,
  searchYouTubeMusic,
} from '../src/server/ytmusic-search';
import type { SearchTrack } from '../src/types/companion';

describe('Milestone 4 Empirical Stress Suite: PlaylistsStore & ytmusic-search', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubify-stress-'));
    testFilePath = path.join(tempDir, 'playlists.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // =========================================================================
  // 1. PlaylistsStore: Concurrency, Rapid Operations & Duplicate Collisions
  // =========================================================================
  describe('1. PlaylistsStore: Concurrency & Duplicate Injections', () => {
    it('handles rapid sequential addition of 100 distinct tracks', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Massive Playlist');

      for (let i = 0; i < 100; i++) {
        const track: SearchTrack = {
          videoId: `vid_${String(i).padStart(7, '0')}`,
          title: `Track #${i}`,
          artist: `Artist #${i % 10}`,
          album: `Album #${i % 5}`,
          duration: `${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}`,
        };
        const updated = store.addTrack(pl.id, track);
        expect(updated?.tracks.length).toBe(i + 1);
      }

      const reloaded = store.getPlaylist(pl.id);
      expect(reloaded?.tracks.length).toBe(100);

      // Verify file persistence on disk
      const diskData = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(diskData.playlists[0].tracks.length).toBe(100);
      expect(diskData.playlists[0].tracks[99].videoId).toBe('vid_0000099');
    });

    it('STRICT DEDUPLICATION: rejects exact same videoId added 50 times in a loop', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Idempotence Test');

      const track: SearchTrack = {
        videoId: '4D7u5KF7SP8',
        title: 'Get Lucky',
        artist: 'Daft Punk',
      };

      for (let i = 0; i < 50; i++) {
        store.addTrack(pl.id, track);
      }

      const result = store.getPlaylist(pl.id);
      expect(result?.tracks.length).toBe(1);
      expect(result?.tracks[0].videoId).toBe('4D7u5KF7SP8');
    });

    it('STRICT DEDUPLICATION: prevents duplicate track even when title or metadata changes', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Metadata Conflict');

      store.addTrack(pl.id, {
        videoId: 'fJ9rUzIMcZQ',
        title: 'Bohemian Rhapsody (Original)',
        artist: 'Queen',
        album: 'A Night at the Opera',
      });

      // Attempt injection with different title and artist
      const updated = store.addTrack(pl.id, {
        videoId: 'fJ9rUzIMcZQ',
        title: 'Bohemian Rhapsody (Remastered 2011)',
        artist: 'Queen Official',
        album: 'Greatest Hits',
      });

      expect(updated?.tracks.length).toBe(1);
      // Original title should be preserved
      expect(updated?.tracks[0].title).toBe('Bohemian Rhapsody (Original)');
    });

    it('ADVERSARIAL DUPLICATE INJECTION: tests behavior when videoId has surrounding whitespace', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Whitespace Collision');

      store.addTrack(pl.id, {
        videoId: 'testVid1234',
        title: 'Original Track',
        artist: 'Original Artist',
      });

      // Inject with leading and trailing spaces
      store.addTrack(pl.id, {
        videoId: '  testVid1234  ',
        title: 'Sneaky Duplicate',
        artist: 'Duplicate Artist',
      });

      const result = store.getPlaylist(pl.id);
      // Check whether duplicate was created due to raw comparison vs trimmed comparison
      const matchCount = result?.tracks.filter((t) => t.videoId.trim() === 'testVid1234').length;
      // In a strictly deduplicated store, count should be 1
      expect(matchCount).toBe(1);
    });

    it('interleaves rapid additions and removals cleanly', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Churn Playlist');

      // Add 20 tracks
      for (let i = 0; i < 20; i++) {
        store.addTrack(pl.id, { videoId: `track_${i}`, title: `Track ${i}`, artist: 'Artist' });
      }
      expect(store.getPlaylist(pl.id)?.tracks.length).toBe(20);

      // Remove even tracks
      for (let i = 0; i < 20; i += 2) {
        store.removeTrack(pl.id, `track_${i}`);
      }

      const remaining = store.getPlaylist(pl.id);
      expect(remaining?.tracks.length).toBe(10);
      expect(remaining?.tracks.map((t) => t.videoId)).toEqual([
        'track_1', 'track_3', 'track_5', 'track_7', 'track_9',
        'track_11', 'track_13', 'track_15', 'track_17', 'track_19',
      ]);
    });

    it('removing a non-existent track leaves the playlist unchanged without re-writing', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Untouched');
      store.addTrack(pl.id, { videoId: 'v1', title: 'Song 1', artist: 'Artist 1' });

      const statBefore = fs.statSync(testFilePath);
      const updated = store.removeTrack(pl.id, 'ghost_video_id');

      expect(updated?.tracks.length).toBe(1);
      expect(updated?.tracks[0].videoId).toBe('v1');

      const statAfter = fs.statSync(testFilePath);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });

    it('ADVERSARIAL REMOVAL: removes track even when videoId parameter has surrounding whitespace', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Remove Whitespace');
      store.addTrack(pl.id, { videoId: 'targetVid123', title: 'Target Song', artist: 'Target Artist' });
      expect(store.getPlaylist(pl.id)?.tracks.length).toBe(1);

      // Attempt removal with surrounding whitespace
      const res = store.removeTrack(pl.id, '  targetVid123  ');
      expect(res?.tracks.length).toBe(0);
    });

    it('simulates rapid async microtask concurrency on single store', async () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Concurrency Sim');

      // 50 concurrent additions wrapped in Promise.resolve()
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          Promise.resolve().then(() =>
            store.addTrack(pl.id, {
              videoId: `async_track_${i}`,
              title: `Async Track ${i}`,
              artist: 'Async Artist',
            })
          )
        )
      );

      const result = store.getPlaylist(pl.id);
      expect(result?.tracks.length).toBe(50);
    });

    it('ensures temporary atomic files (.playlists.tmp.*) are cleaned up', () => {
      const store = new PlaylistsStore(testFilePath);
      for (let i = 0; i < 15; i++) {
        store.createPlaylist(`Temp File Test ${i}`);
      }

      const dirFiles = fs.readdirSync(tempDir);
      const tmpFiles = dirFiles.filter((f) => f.startsWith('.playlists.tmp'));
      expect(tmpFiles.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. PlaylistsStore: Corrupted, Empty, and Unparseable Files on Disk
  // =========================================================================
  describe('2. PlaylistsStore: Corrupted, Empty & Unparseable Disk Files', () => {
    it('handles 0-byte completely empty file on disk', () => {
      fs.writeFileSync(testFilePath, '', 'utf-8');
      expect(fs.statSync(testFilePath).size).toBe(0);

      const store = new PlaylistsStore(testFilePath);
      expect(store.getPlaylists()).toEqual([]);

      const diskContent = JSON.parse(fs.readFileSync(testFilePath, 'utf-8'));
      expect(diskContent).toEqual({ playlists: [] });
    });

    it('handles whitespace-only file on disk', () => {
      fs.writeFileSync(testFilePath, '   \r\n\t  \n  ', 'utf-8');

      const store = new PlaylistsStore(testFilePath);
      expect(store.getPlaylists()).toEqual([]);
    });

    it('recovers from truncated / incomplete JSON syntax', () => {
      fs.writeFileSync(testFilePath, '{"playlists": [{"id": "pl-1", "title": "Incomplete', 'utf-8');

      const store = new PlaylistsStore(testFilePath);
      expect(store.getPlaylists()).toEqual([]);
      expect(() => store.createPlaylist('New Start')).not.toThrow();
      expect(store.getPlaylists().length).toBe(1);
    });

    it('recovers from raw null bytes or binary garbage in file', () => {
      const corruptBuffer = Buffer.from([0x00, 0xff, 0xfe, 0x12, 0x34, 0x00, 0x00]);
      fs.writeFileSync(testFilePath, corruptBuffer);

      const store = new PlaylistsStore(testFilePath);
      expect(store.getPlaylists()).toEqual([]);
    });

    it('handles JSON primitives (string, number, boolean, null) gracefully', () => {
      const primitives = ['"just a string"', '12345', 'true', 'false', 'null'];

      for (const prim of primitives) {
        fs.writeFileSync(testFilePath, prim, 'utf-8');
        const store = new PlaylistsStore(testFilePath);
        expect(store.getPlaylists()).toEqual([]);
      }
    });

    it('parses bare array JSON format without { playlists: [] } wrapper', () => {
      const bareArray = [
        {
          id: 'bare-1',
          title: 'Bare Array Playlist',
          tracks: [{ videoId: 'vid1', title: 'Bare Track', artist: 'Bare Artist' }],
        },
      ];
      fs.writeFileSync(testFilePath, JSON.stringify(bareArray), 'utf-8');

      const store = new PlaylistsStore(testFilePath);
      const playlists = store.getPlaylists();
      expect(playlists.length).toBe(1);
      expect(playlists[0].id).toBe('bare-1');
      expect(playlists[0].title).toBe('Bare Array Playlist');
      expect(playlists[0].tracks.length).toBe(1);
    });

    it('handles unexpected non-array property in { playlists: "not-an-array" }', () => {
      fs.writeFileSync(testFilePath, JSON.stringify({ playlists: 'invalid string' }), 'utf-8');

      const store = new PlaylistsStore(testFilePath);
      expect(store.getPlaylists()).toEqual([]);
    });

    it('survives corrupted array entries (null or primitive items) in playlists', () => {
      const malformedData = {
        playlists: [
          null,
          123,
          'unexpected string',
          { id: 'valid-pl', title: 'Surviving Playlist', tracks: [] },
        ],
      };
      fs.writeFileSync(testFilePath, JSON.stringify(malformedData), 'utf-8');

      // Should not throw unhandled exception
      expect(() => new PlaylistsStore(testFilePath)).not.toThrow();
    });

    it('ADVERSARIAL DISK CORRUPTION: does not wipe valid playlists when array contains null or corrupted items', () => {
      const malformedData = {
        playlists: [
          null,
          { id: 'valid-pl', title: 'Surviving Playlist', tracks: [] },
        ],
      };
      fs.writeFileSync(testFilePath, JSON.stringify(malformedData), 'utf-8');

      const store = new PlaylistsStore(testFilePath);
      const valid = store.getPlaylist('valid-pl');
      expect(valid).not.toBeNull();
      expect(valid?.title).toBe('Surviving Playlist');
    });

    it('filters out corrupted track items in a playlist on disk', () => {
      const dataWithBadTracks = {
        playlists: [
          {
            id: 'pl-with-bad-tracks',
            title: 'Dirty Tracks Playlist',
            tracks: [
              null,
              undefined,
              'not an object',
              { title: 'Missing videoId' },
              { videoId: 12345 }, // non-string videoId
              { videoId: 'validVid1', title: 'Good Track', artist: 'Good Artist' },
            ],
          },
        ],
      };
      fs.writeFileSync(testFilePath, JSON.stringify(dataWithBadTracks), 'utf-8');

      const store = new PlaylistsStore(testFilePath);
      const pl = store.getPlaylist('pl-with-bad-tracks');
      expect(pl).not.toBeNull();
      expect(pl?.tracks.length).toBe(1);
      expect(pl?.tracks[0].videoId).toBe('validVid1');
    });

    it('creates missing nested parent directories automatically', () => {
      const deepPath = path.join(tempDir, 'nested', 'deep', 'sub', 'playlists.json');
      expect(fs.existsSync(path.dirname(deepPath))).toBe(false);

      const store = new PlaylistsStore(deepPath);
      expect(fs.existsSync(deepPath)).toBe(true);
      expect(store.getPlaylists()).toEqual([]);
    });
  });

  // =========================================================================
  // 3. PlaylistsStore: Boundary Inputs, Special Characters & Non-Existent IDs
  // =========================================================================
  describe('3. PlaylistsStore: Boundary Inputs & Special Characters', () => {
    it('normalizes empty and whitespace-only playlist titles to "Untitled Playlist"', () => {
      const store = new PlaylistsStore(testFilePath);

      const p1 = store.createPlaylist('');
      const p2 = store.createPlaylist('   ');
      const p3 = store.createPlaylist('\t\n\r');
      const p4 = store.createPlaylist(undefined);

      expect(p1.title).toBe('Untitled Playlist');
      expect(p2.title).toBe('Untitled Playlist');
      expect(p3.title).toBe('Untitled Playlist');
      expect(p4.title).toBe('Untitled Playlist');
    });

    it('preserves Unicode, emoji, quotes, and special characters in playlist titles', () => {
      const store = new PlaylistsStore(testFilePath);
      const specialTitle = '🎵 Tubify Rocks! 🎸 <script>alert("xss")</script> \' " \\ \u2022 العربية 日本語';

      const created = store.createPlaylist(specialTitle);
      expect(created.title).toBe(specialTitle);

      // Verify persistence and reloading
      const store2 = new PlaylistsStore(testFilePath);
      const reloaded = store2.getPlaylist(created.id);
      expect(reloaded?.title).toBe(specialTitle);
    });

    it('handles extreme length playlist title (10,000 characters)', () => {
      const store = new PlaylistsStore(testFilePath);
      const longTitle = 'A'.repeat(10000);

      const created = store.createPlaylist(longTitle);
      expect(created.title.length).toBe(10000);

      const reloaded = store.getPlaylist(created.id);
      expect(reloaded?.title.length).toBe(10000);
    });

    it('returns null / false when querying, updating, or deleting non-existent IDs', () => {
      const store = new PlaylistsStore(testFilePath);

      expect(store.getPlaylist('non-existent-uuid')).toBeNull();
      expect(store.renamePlaylist('non-existent-uuid', 'New Name')).toBeNull();
      expect(store.deletePlaylist('non-existent-uuid')).toBe(false);
      expect(
        store.addTrack('non-existent-uuid', {
          videoId: 'v1234567890',
          title: 'Track',
          artist: 'Artist',
        })
      ).toBeNull();
      expect(store.removeTrack('non-existent-uuid', 'v1234567890')).toBeNull();
    });

    it('throws descriptive error on invalid track payloads in addTrack', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Valid PL');

      expect(() => store.addTrack(pl.id, null as any)).toThrow('Track must have a valid videoId');
      expect(() => store.addTrack(pl.id, undefined as any)).toThrow('Track must have a valid videoId');
      expect(() => store.addTrack(pl.id, {} as any)).toThrow('Track must have a valid videoId');
      expect(() => store.addTrack(pl.id, { videoId: '' } as any)).toThrow('Track must have a valid videoId');
      expect(() => store.addTrack(pl.id, { videoId: '   ' } as any)).toThrow('Track must have a valid videoId');
      expect(() => store.addTrack(pl.id, { videoId: 12345 } as any)).toThrow('Track must have a valid videoId');
    });

    it('cleanly trims track metadata and handles undefined optional fields', () => {
      const store = new PlaylistsStore(testFilePath);
      const pl = store.createPlaylist('Metadata Test');

      const updated = store.addTrack(pl.id, {
        videoId: '4D7u5KF7SP8',
        title: '  Get Lucky  ',
        artist: '  Daft Punk  ',
        album: '  Random Access Memories  ',
        duration: '  6:10  ',
        thumbnailUrl: '  https://example.com/art.jpg  ',
      });

      const track = updated?.tracks[0];
      expect(track?.title).toBe('Get Lucky');
      expect(track?.artist).toBe('Daft Punk');
      expect(track?.album).toBe('Random Access Memories');
      expect(track?.duration).toBe('6:10');
      expect(track?.thumbnailUrl).toBe('https://example.com/art.jpg');
    });
  });

  // =========================================================================
  // 4. ytmusic-search: Query Edge Cases & Adversarial Inputs
  // =========================================================================
  describe('4. ytmusic-search: Query Edge Cases & Adversarial Inputs', () => {
    it('returns empty array immediately for empty, whitespace, and nullish queries without network requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const inputs = ['', '   ', '\t\n\r', undefined as any, null as any];
      for (const input of inputs) {
        const res = await searchYouTubeMusic(input);
        expect(res).toEqual([]);
      }

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends properly encoded payload for multilingual / non-Latin queries', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ contents: {} }),
      } as Response);

      const nonLatinQueries = [
        '米津玄師 Lemon', // Japanese
        '뉴진스 Hype Boy', // Korean
        'فيروز كيفك انت', // Arabic
        'Виктор Цой Группа крови', // Cyrillic
        '周杰伦 晴天', // Chinese
        'अरिजीत सिंह', // Hindi
        '🔥🚀🎵', // Emoji
      ];

      for (const q of nonLatinQueries) {
        await searchYouTubeMusic(q);
        const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
        const body = JSON.parse((lastCall[1] as any).body);
        expect(body.query).toBe(q);
      }
    });

    it('handles extreme length queries (5,000 characters) without error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ contents: {} }),
      } as Response);

      const hugeQuery = 'A'.repeat(5000);
      const res = await searchYouTubeMusic(hugeQuery);
      expect(res).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(body.query.length).toBe(5000);
    });

    it('handles SQL injection, XSS, and path traversal strings safely', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ contents: {} }),
      } as Response);

      const adversarialQueries = [
        "' OR 1=1; DROP TABLE playlists; --",
        '<script>alert("xss")</script><img src=x onerror=alert(1)>',
        '../../../../../../etc/passwd',
        '{"$gt": ""}',
        '%s%s%s%s%s%n',
      ];

      for (const query of adversarialQueries) {
        await searchYouTubeMusic(query);
      }
      expect(fetchSpy).toHaveBeenCalledTimes(adversarialQueries.length);
    });

    it('throws descriptive error on upstream HTTP 500, 502, 503, 404', async () => {
      const errorStatuses = [404, 500, 502, 503];

      for (const status of errorStatuses) {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
          ok: false,
          status,
        } as Response);

        await expect(searchYouTubeMusic('Fail Query')).rejects.toThrow(
          `YouTube Music search failed with status ${status}`
        );
      }
    });

    it('propagates network exceptions (e.g. DNS failure, connection refused)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(searchYouTubeMusic('Network Fail')).rejects.toThrow('Failed to fetch');
    });
  });

  // =========================================================================
  // 5. ytmusic-search: Malformed & Degraded Innertube Payloads
  // =========================================================================
  describe('5. ytmusic-search: Malformed Innertube Payloads', () => {
    it('returns empty array when response tree is completely missing or degraded', () => {
      const degradedPayloads = [
        null,
        undefined,
        {},
        { contents: null },
        { contents: {} },
        { contents: { tabbedSearchResultsRenderer: null } },
        { contents: { tabbedSearchResultsRenderer: { tabs: [] } } },
        { contents: { tabbedSearchResultsRenderer: { tabs: [null] } } },
        {
          contents: {
            tabbedSearchResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [], // empty contents
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        {
          contents: {
            tabbedSearchResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [{ someOtherRenderer: {} }], // no musicShelfRenderer
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        {
          contents: {
            tabbedSearchResultsRenderer: {
              tabs: [
                {
                  tabRenderer: {
                    content: {
                      sectionListRenderer: {
                        contents: [{ musicShelfRenderer: { contents: [] } }], // empty shelf contents
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ];

      for (const payload of degradedPayloads) {
        expect(parseInnertubeResponse(payload)).toEqual([]);
      }
    });

    it('extracts videoId via Path 1, Path 2, and Path 3 accurately', () => {
      // Path 1
      const itemPath1 = {
        playlistItemData: { videoId: 'path1Video1' },
      };
      expect(extractVideoId(itemPath1)).toBe('path1Video1');

      // Path 2
      const itemPath2 = {
        overlay: {
          musicItemThumbnailOverlayRenderer: {
            content: {
              musicPlayButtonRenderer: {
                playNavigationEndpoint: {
                  watchEndpoint: { videoId: 'path2Video2' },
                },
              },
            },
          },
        },
      };
      expect(extractVideoId(itemPath2)).toBe('path2Video2');

      // Path 3
      const itemPath3 = {
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: {
                runs: [
                  {
                    navigationEndpoint: {
                      watchEndpoint: { videoId: 'path3Video3' },
                    },
                  },
                ],
              },
            },
          },
        ],
      };
      expect(extractVideoId(itemPath3)).toBe('path3Video3');
    });

    it('falls back from invalid Path 1 to valid Path 2 or Path 3', () => {
      const item = {
        playlistItemData: { videoId: 'tooShort' }, // invalid Path 1
        overlay: {
          musicItemThumbnailOverlayRenderer: {
            content: {
              musicPlayButtonRenderer: {
                playNavigationEndpoint: {
                  watchEndpoint: { videoId: 'validPath2X' }, // valid Path 2 (11 chars)
                },
              },
            },
          },
        },
      };

      expect(extractVideoId(item)).toBe('validPath2X');
    });

    it('parses subtitle with 1 part (artist only)', () => {
      const item = {
        playlistItemData: { videoId: '11charsVid1' },
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Song Title' }] },
            },
          },
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Solo Artist' }] },
            },
          },
        ],
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.artist).toBe('Solo Artist');
      expect(parsed?.album).toBeUndefined();
      expect(parsed?.duration).toBeUndefined();
    });

    it('parses subtitle with 4+ parts: artist • feature • album • duration', () => {
      const item = {
        playlistItemData: { videoId: '11charsVid2' },
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Get Lucky' }] },
            },
          },
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: {
                runs: [
                  { text: 'Daft Punk • Pharrell Williams • Random Access Memories • 6:10' },
                ],
              },
            },
          },
        ],
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.artist).toBe('Daft Punk');
      expect(parsed?.album).toBe('Pharrell Williams • Random Access Memories');
      expect(parsed?.duration).toBe('6:10');
    });

    it('parses subtitle with middle dot · delimiter', () => {
      const item = {
        playlistItemData: { videoId: '11charsVid3' },
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Mid Dot Song' }] },
            },
          },
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Artist · Album Name · 4:15' }] },
            },
          },
        ],
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.artist).toBe('Artist');
      expect(parsed?.album).toBe('Album Name');
      expect(parsed?.duration).toBe('4:15');
    });

    it('parses long durations with hours (e.g. 1:15:30)', () => {
      const item = {
        playlistItemData: { videoId: '11charsVid4' },
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Live Concert' }] },
            },
          },
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Rock Band • Live Tour • 1:25:40' }] },
            },
          },
        ],
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.duration).toBe('1:25:40');
    });

    it('handles items with missing thumbnails gracefully', () => {
      const item = {
        playlistItemData: { videoId: '11charsVid5' },
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'No Artwork' }] },
            },
          },
        ],
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.thumbnailUrl).toBeUndefined();
    });

    it('ADVERSARIAL SEARCH: falls back to "Unknown Title" when title runs contain whitespace only', () => {
      const item = {
        playlistItemData: { videoId: '11charsVid9' },
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: '   ' }] },
            },
          },
        ],
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.title).toBe('Unknown Title');
    });

    it('converts protocol-relative thumbnail URLs (//) to https://', () => {
      const item = {
        playlistItemData: { videoId: '11charsVid6' },
        thumbnail: {
          musicThumbnailRenderer: {
            thumbnail: {
              thumbnails: [
                { url: '//lh3.googleusercontent.com/pic120.jpg', width: 120, height: 120 },
              ],
            },
          },
        },
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.thumbnailUrl).toBe('https://lh3.googleusercontent.com/pic120.jpg');
    });

    it('filters out items with completely missing or invalid video IDs from response', () => {
      const response = {
        contents: {
          tabbedSearchResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        {
                          musicShelfRenderer: {
                            contents: [
                              {
                                musicResponsiveListItemRenderer: {
                                  playlistItemData: { videoId: 'valid11Vid1' },
                                  flexColumns: [
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Valid 1' }] },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                musicResponsiveListItemRenderer: {
                                  playlistItemData: { videoId: 'bad_id' }, // invalid (not 11 chars)
                                },
                              },
                              {
                                musicResponsiveListItemRenderer: {
                                  // missing videoId completely
                                  flexColumns: [],
                                },
                              },
                              {
                                musicResponsiveListItemRenderer: {
                                  playlistItemData: { videoId: 'valid11Vid2' },
                                  flexColumns: [
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Valid 2' }] },
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      };

      const results = parseInnertubeResponse(response);
      expect(results.length).toBe(2);
      expect(results[0].videoId).toBe('valid11Vid1');
      expect(results[1].videoId).toBe('valid11Vid2');
    });
  });
});
