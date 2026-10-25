import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractVideoId,
  parseSearchItem,
  parseInnertubeResponse,
  searchYouTubeMusic,
} from '../src/server/ytmusic-search';

describe('YouTube Music Search Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractVideoId', () => {
    it('extracts videoId from playlistItemData (Path 1)', () => {
      const item = {
        playlistItemData: { videoId: '4D7u5KF7SP8' },
      };
      expect(extractVideoId(item)).toBe('4D7u5KF7SP8');
    });

    it('extracts videoId from overlay playNavigationEndpoint (Path 2)', () => {
      const item = {
        overlay: {
          musicItemThumbnailOverlayRenderer: {
            content: {
              musicPlayButtonRenderer: {
                playNavigationEndpoint: {
                  watchEndpoint: {
                    videoId: '5NV6Rdv1a3I',
                  },
                },
              },
            },
          },
        },
      };
      expect(extractVideoId(item)).toBe('5NV6Rdv1a3I');
    });

    it('extracts videoId from flexColumns[0] runs watchEndpoint (Path 3)', () => {
      const item = {
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: {
                runs: [
                  {
                    text: 'Song Title',
                    navigationEndpoint: {
                      watchEndpoint: {
                        videoId: 'dQw4w9WgXcQ',
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      };
      expect(extractVideoId(item)).toBe('dQw4w9WgXcQ');
    });

    it('rejects invalid or non-11-character video IDs', () => {
      expect(extractVideoId({ playlistItemData: { videoId: 'tooShort' } })).toBeNull();
      expect(extractVideoId({ playlistItemData: { videoId: 'thisIsWayTooLong123' } })).toBeNull();
      expect(extractVideoId(null)).toBeNull();
      expect(extractVideoId({})).toBeNull();
    });
  });

  describe('parseSearchItem', () => {
    it('parses complete 3-part subtitle (artist • album • duration)', () => {
      const item = {
        playlistItemData: { videoId: '4D7u5KF7SP8' },
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
                  { text: 'Daft Punk' },
                  { text: ' • ' },
                  { text: 'Random Access Memories' },
                  { text: ' • ' },
                  { text: '6:10' },
                ],
              },
            },
          },
        ],
        thumbnail: {
          musicThumbnailRenderer: {
            thumbnail: {
              thumbnails: [
                { url: '//lh3.googleusercontent.com/small.jpg', width: 60, height: 60 },
                { url: '//lh3.googleusercontent.com/large.jpg', width: 120, height: 120 },
              ],
            },
          },
        },
      };

      const parsed = parseSearchItem(item);
      expect(parsed).toEqual({
        videoId: '4D7u5KF7SP8',
        title: 'Get Lucky',
        artist: 'Daft Punk',
        album: 'Random Access Memories',
        duration: '6:10',
        thumbnailUrl: 'https://lh3.googleusercontent.com/large.jpg',
      });
    });

    it('parses 2-part subtitle with duration', () => {
      const item = {
        playlistItemData: { videoId: '4D7u5KF7SP8' },
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Single Song' }] },
            },
          },
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: {
                runs: [{ text: 'Independent Artist • 3:45' }],
              },
            },
          },
        ],
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.artist).toBe('Independent Artist');
      expect(parsed?.album).toBeUndefined();
      expect(parsed?.duration).toBe('3:45');
    });

    it('parses 2-part subtitle with album when no duration', () => {
      const item = {
        playlistItemData: { videoId: '4D7u5KF7SP8' },
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'Song Name' }] },
            },
          },
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: {
                runs: [{ text: 'Artist • EP Name' }],
              },
            },
          },
        ],
      };

      const parsed = parseSearchItem(item);
      expect(parsed?.artist).toBe('Artist');
      expect(parsed?.album).toBe('EP Name');
      expect(parsed?.duration).toBeUndefined();
    });

    it('returns null if item has no valid video ID', () => {
      const item = {
        flexColumns: [
          {
            musicResponsiveListItemFlexColumnRenderer: {
              text: { runs: [{ text: 'No Video ID' }] },
            },
          },
        ],
      };
      expect(parseSearchItem(item)).toBeNull();
    });
  });

  describe('parseInnertubeResponse', () => {
    it('extracts tracks from musicShelfRenderer', () => {
      const mockResponse = {
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
                            title: { runs: [{ text: 'Songs' }] },
                            contents: [
                              {
                                musicResponsiveListItemRenderer: {
                                  playlistItemData: { videoId: 'track111111' },
                                  flexColumns: [
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Track 1' }] },
                                      },
                                    },
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Artist 1 • 3:20' }] },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                musicResponsiveListItemRenderer: {
                                  playlistItemData: { videoId: 'track222222' },
                                  flexColumns: [
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Track 2' }] },
                                      },
                                    },
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Artist 2 • Album 2 • 4:10' }] },
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

      const tracks = parseInnertubeResponse(mockResponse);
      expect(tracks.length).toBe(2);
      expect(tracks[0].videoId).toBe('track111111');
      expect(tracks[0].title).toBe('Track 1');
      expect(tracks[1].videoId).toBe('track222222');
      expect(tracks[1].album).toBe('Album 2');
    });

    it('handles empty or unexpected Innertube structures gracefully', () => {
      expect(parseInnertubeResponse(null)).toEqual([]);
      expect(parseInnertubeResponse({})).toEqual([]);
      expect(parseInnertubeResponse({ contents: {} })).toEqual([]);
      expect(parseInnertubeResponse({ contents: { tabbedSearchResultsRenderer: { tabs: [] } } })).toEqual([]);
    });
  });

  describe('searchYouTubeMusic', () => {
    it('returns empty array immediately for empty or whitespace query without network call', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const r1 = await searchYouTubeMusic('');
      const r2 = await searchYouTubeMusic('   ');
      const r3 = await searchYouTubeMusic(undefined as any);

      expect(r1).toEqual([]);
      expect(r2).toEqual([]);
      expect(r3).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('makes POST request to Innertube with WEB_REMIX context and parsed songs', async () => {
      const mockResult = {
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
                                  playlistItemData: { videoId: 'testVideo12' },
                                  flexColumns: [
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Test Song' }] },
                                      },
                                    },
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: 'Test Artist • 2:50' }] },
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

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response);

      const results = await searchYouTubeMusic('Test Query');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://music.youtube.com/youtubei/v1/search?prettyPrint=false');
      expect((options as any).method).toBe('POST');

      const body = JSON.parse((options as any).body);
      expect(body.query).toBe('Test Query');
      expect(body.context.client.clientName).toBe('WEB_REMIX');
      expect(body.params).toBe('EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D');

      expect(results.length).toBe(1);
      expect(results[0].videoId).toBe('testVideo12');
      expect(results[0].title).toBe('Test Song');
      expect(results[0].artist).toBe('Test Artist');
      expect(results[0].duration).toBe('2:50');
    });

    it('throws descriptive error when upstream response is not ok', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(searchYouTubeMusic('Fail Song')).rejects.toThrow(
        'YouTube Music search failed with status 500'
      );
    });
  });
});
