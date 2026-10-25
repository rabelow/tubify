import { describe, it, expect } from 'vitest';
import { parseYouTubeInput } from '../src/lib/url-parser';

describe('parseYouTubeInput', () => {
  describe('YouTube Music URLs', () => {
    it('parses standard music.youtube.com watch URL', () => {
      const input = 'https://music.youtube.com/watch?v=5NV6Rdv1a3I';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('parses music.youtube.com watch URL with playlist list param', () => {
      const input = 'https://music.youtube.com/watch?v=5NV6Rdv1a3I&list=PLrEnWoR732-D&si=abc123';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: 'PLrEnWoR732-D',
      });
    });

    it('parses music.youtube.com standalone playlist URL', () => {
      const input = 'https://music.youtube.com/playlist?list=PLrEnWoR732-DN6gmmsnfpv4QoX2iJqRjT';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: null,
        playlistId: 'PLrEnWoR732-DN6gmmsnfpv4QoX2iJqRjT',
      });
    });

    it('parses music.youtube.com link without protocol scheme', () => {
      const input = 'music.youtube.com/watch?v=5NV6Rdv1a3I';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });
  });

  describe('Standard YouTube URLs', () => {
    it('parses standard www.youtube.com watch URL', () => {
      const input = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: 'dQw4w9WgXcQ',
        playlistId: null,
      });
    });

    it('parses youtube.com watch URL with playlist and index params', () => {
      const input = 'https://youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&index=1';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: 'dQw4w9WgXcQ',
        playlistId: 'RDdQw4w9WgXcQ',
      });
    });

    it('parses mobile m.youtube.com URL', () => {
      const input = 'https://m.youtube.com/watch?v=5NV6Rdv1a3I';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('parses standalone youtube.com playlist URL', () => {
      const input = 'https://www.youtube.com/playlist?list=PL1234567890';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: null,
        playlistId: 'PL1234567890',
      });
    });
  });

  describe('Shortened & Alternate YouTube URLs', () => {
    it('parses shortened youtu.be link', () => {
      const input = 'https://youtu.be/dQw4w9WgXcQ';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: 'dQw4w9WgXcQ',
        playlistId: null,
      });
    });

    it('parses youtu.be link with timestamp and playlist parameters', () => {
      const input = 'https://youtu.be/dQw4w9WgXcQ?t=42&list=PL1234567890';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: 'dQw4w9WgXcQ',
        playlistId: 'PL1234567890',
      });
    });

    it('parses youtu.be link without protocol scheme', () => {
      const input = 'youtu.be/dQw4w9WgXcQ';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: 'dQw4w9WgXcQ',
        playlistId: null,
      });
    });

    it('parses YouTube Shorts URL', () => {
      const input = 'https://www.youtube.com/shorts/5NV6Rdv1a3I';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('parses YouTube Embed URL', () => {
      const input = 'https://www.youtube.com/embed/5NV6Rdv1a3I';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('parses YouTube /v/ URL', () => {
      const input = 'https://www.youtube.com/v/5NV6Rdv1a3I';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });
  });

  describe('Bare IDs', () => {
    it('parses bare 11-character video ID', () => {
      const input = '5NV6Rdv1a3I';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('parses bare video ID with dashes and underscores', () => {
      const input = 'a-B_c1D2e3F';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: 'a-B_c1D2e3F',
        playlistId: null,
      });
    });

    it('parses bare standard playlist ID starting with PL', () => {
      const input = 'PLrEnWoR732-DN6gmmsnfpv4QoX2iJqRjT';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: null,
        playlistId: 'PLrEnWoR732-DN6gmmsnfpv4QoX2iJqRjT',
      });
    });

    it('parses bare mix playlist ID starting with RD', () => {
      const input = 'RDCLAK5uy_k1234567890';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: null,
        playlistId: 'RDCLAK5uy_k1234567890',
      });
    });
  });

  describe('Trimming, Invalid & Edge Cases', () => {
    it('trims leading and trailing whitespace and newlines', () => {
      const input = '  \n  https://youtu.be/dQw4w9WgXcQ \t ';
      expect(parseYouTubeInput(input)).toEqual({
        videoId: 'dQw4w9WgXcQ',
        playlistId: null,
      });
    });

    it('returns nulls for empty string, whitespace only, null, and undefined', () => {
      expect(parseYouTubeInput('')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('   ')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput(null)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput(undefined)).toEqual({ videoId: null, playlistId: null });
    });

    it('returns nulls for natural language search queries', () => {
      expect(parseYouTubeInput('Daft Punk Get Lucky')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('Queen Bohemian Rhapsody')).toEqual({
        videoId: null,
        playlistId: null,
      });
    });

    it('returns nulls for non-YouTube URLs', () => {
      expect(parseYouTubeInput('https://vimeo.com/123456789')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://example.com/watch?v=5NV6Rdv1a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
    });

    it('rejects strings that almost match video ID length', () => {
      expect(parseYouTubeInput('1234567890')).toEqual({ videoId: null, playlistId: null }); // 10 chars
      expect(parseYouTubeInput('123456789012')).toEqual({ videoId: null, playlistId: null }); // 12 chars
    });
  });
});
