import { describe, it, expect } from 'vitest';
import {
  cleanTrackTitle,
  parseLrc,
  getActiveLyricIndex,
  type LyricLine,
} from '../src/lib/lyrics';

describe('T022: Lyric Parsing, Title Cleaning, and Binary Search Synchronization Suite', () => {
  // ==========================================================================
  // 1. cleanTrackTitle() Unit Tests
  // ==========================================================================
  describe('cleanTrackTitle', () => {
    it('returns empty string for null, undefined, or empty string', () => {
      expect(cleanTrackTitle(null)).toBe('');
      expect(cleanTrackTitle(undefined)).toBe('');
      expect(cleanTrackTitle('')).toBe('');
      expect(cleanTrackTitle('   ')).toBe('');
    });

    it('preserves clean titles without unwanted tags', () => {
      expect(cleanTrackTitle('Bohemian Rhapsody')).toBe('Bohemian Rhapsody');
      expect(cleanTrackTitle('Get Lucky')).toBe('Get Lucky');
      expect(cleanTrackTitle('Hotel California')).toBe('Hotel California');
    });

    it('strips official video and audio tags in parentheses or brackets', () => {
      expect(cleanTrackTitle('Daft Punk - Get Lucky (Official Video)')).toBe('Daft Punk - Get Lucky');
      expect(cleanTrackTitle('Shape of You [Official Audio]')).toBe('Shape of You');
      expect(cleanTrackTitle('Never Gonna Give You Up (Official Music Video)')).toBe('Never Gonna Give You Up');
      expect(cleanTrackTitle('Blinding Lights [Official Music Video]')).toBe('Blinding Lights');
    });

    it('strips lyric video and visualizer tags', () => {
      expect(cleanTrackTitle('Someone Like You (Lyric Video)')).toBe('Someone Like You');
      expect(cleanTrackTitle('Starboy [Official Lyric Video]')).toBe('Starboy');
      expect(cleanTrackTitle('Midnight City (Visualizer)')).toBe('Midnight City');
      expect(cleanTrackTitle('Song Title [Official Visualizer]')).toBe('Song Title');
    });

    it('strips remastered tags and live tags', () => {
      expect(cleanTrackTitle('Bohemian Rhapsody (Remastered 2011)')).toBe('Bohemian Rhapsody');
      expect(cleanTrackTitle('Comfortably Numb [2011 - Remaster]')).toBe('Comfortably Numb');
      expect(cleanTrackTitle('Stairway to Heaven (Remaster)')).toBe('Stairway to Heaven');
      expect(cleanTrackTitle('Radio Ga Ga (Live at Wembley)')).toBe('Radio Ga Ga');
    });

    it('strips featured artist annotations in brackets or parentheses', () => {
      expect(cleanTrackTitle('Get Lucky (feat. Pharrell Williams)')).toBe('Get Lucky');
      expect(cleanTrackTitle('Uptown Funk [ft. Bruno Mars]')).toBe('Uptown Funk');
      expect(cleanTrackTitle('Starboy (feat. Daft Punk)')).toBe('Starboy');
    });

    it('strips quality tags like HD, 4K, HQ, Radio Edit', () => {
      expect(cleanTrackTitle('Thriller (HD)')).toBe('Thriller');
      expect(cleanTrackTitle('Bad [4K]')).toBe('Bad');
      expect(cleanTrackTitle('Clocks (Radio Edit)')).toBe('Clocks');
    });

    it('strips trailing standalone video/audio suffixes and dashes', () => {
      expect(cleanTrackTitle('Michael Jackson - Beat It - Official Video')).toBe('Michael Jackson - Beat It');
      expect(cleanTrackTitle('Song - Lyric Video')).toBe('Song');
      expect(cleanTrackTitle('Track Title - ')).toBe('Track Title');
      expect(cleanTrackTitle('Another Track _ ')).toBe('Another Track');
    });
  });

  // ==========================================================================
  // 2. parseLrc() Unit Tests
  // ==========================================================================
  describe('parseLrc', () => {
    it('returns an empty array for null, undefined, empty, or whitespace-only inputs', () => {
      expect(parseLrc(null)).toEqual([]);
      expect(parseLrc(undefined)).toEqual([]);
      expect(parseLrc('')).toEqual([]);
      expect(parseLrc('   \n  \t  \n  ')).toEqual([]);
    });

    it('parses standard centiseconds timestamps [mm:ss.xx]', () => {
      const lrc = `
        [00:15.30] Is this the real life?
        [01:23.45] Is this just fantasy?
      `;
      const result = parseLrc(lrc);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ timeSeconds: 15.3, text: 'Is this the real life?' });
      expect(result[1]).toEqual({ timeSeconds: 83.45, text: 'Is this just fantasy?' });
    });

    it('parses milliseconds timestamps [mm:ss.xxx]', () => {
      const lrc = `
        [01:05.123] Caught in a landslide
        [02:10.987] No escape from reality
      `;
      const result = parseLrc(lrc);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ timeSeconds: 65.123, text: 'Caught in a landslide' });
      expect(result[1]).toEqual({ timeSeconds: 130.987, text: 'No escape from reality' });
    });

    it('parses integer seconds timestamps [mm:ss]', () => {
      const lrc = `
        [00:45] Open your eyes
        [01:12] Look up to the skies and see
      `;
      const result = parseLrc(lrc);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ timeSeconds: 45.0, text: 'Open your eyes' });
      expect(result[1]).toEqual({ timeSeconds: 72.0, text: 'Look up to the skies and see' });
    });

    it('handles multi-timestamp lines [00:10.00][01:20.00] Repeated line and sorts ascending', () => {
      const lrc = `
        [01:45.67][00:12.34] Chorus line repeated
      `;
      const result = parseLrc(lrc);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ timeSeconds: 12.34, text: 'Chorus line repeated' });
      expect(result[1]).toEqual({ timeSeconds: 105.67, text: 'Chorus line repeated' });
    });

    it('skips ID and metadata tags cleanly', () => {
      const lrc = `
        [ar: Queen]
        [ti: Bohemian Rhapsody]
        [al: A Night at the Opera]
        [length: 05:55]
        [by: LRCLIB]
        [offset: 0]
        [00:05.50] Mama, just killed a man
      `;
      const result = parseLrc(lrc);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ timeSeconds: 5.5, text: 'Mama, just killed a man' });
    });

    it('preserves empty lines as instrumental / pause markers', () => {
      const lrc = `
        [00:10.00] First verse line
        [00:25.00]
        [00:30.00]    
        [00:40.00] Second verse line
      `;
      const result = parseLrc(lrc);
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ timeSeconds: 10.0, text: 'First verse line' });
      expect(result[1]).toEqual({ timeSeconds: 25.0, text: '' });
      expect(result[2]).toEqual({ timeSeconds: 30.0, text: '' });
      expect(result[3]).toEqual({ timeSeconds: 40.0, text: 'Second verse line' });
    });

    it('sorts lines strictly ascending when raw LRC timestamps are out of order', () => {
      const lrc = `
        [01:00.00] Third line
        [00:10.00] First line
        [00:35.50] Second line
      `;
      const result = parseLrc(lrc);
      expect(result).toHaveLength(3);
      expect(result[0].timeSeconds).toBe(10.0);
      expect(result[1].timeSeconds).toBe(35.5);
      expect(result[2].timeSeconds).toBe(60.0);
      expect(result[0].text).toBe('First line');
      expect(result[1].text).toBe('Second line');
      expect(result[2].text).toBe('Third line');
    });

    it('handles 3-digit minute values accurately', () => {
      const lrc = `[120:30.00] Long ambient performance`;
      const result = parseLrc(lrc);
      expect(result).toHaveLength(1);
      expect(result[0].timeSeconds).toBe(120 * 60 + 30);
      expect(result[0].text).toBe('Long ambient performance');
    });
  });

  // ==========================================================================
  // 3. getActiveLyricIndex() Binary Search Unit Tests
  // ==========================================================================
  describe('getActiveLyricIndex', () => {
    const lines: LyricLine[] = [
      { timeSeconds: 10.0, text: 'Line 0' },
      { timeSeconds: 20.0, text: 'Line 1' },
      { timeSeconds: 30.5, text: 'Line 2' },
      { timeSeconds: 50.0, text: 'Line 3' },
      { timeSeconds: 80.25, text: 'Line 4' },
    ];

    it('returns -1 for empty or null array', () => {
      expect(getActiveLyricIndex([], 15.0)).toBe(-1);
      expect(getActiveLyricIndex(null as any, 15.0)).toBe(-1);
      expect(getActiveLyricIndex(undefined as any, 15.0)).toBe(-1);
    });

    it('returns -1 for negative playback seconds', () => {
      expect(getActiveLyricIndex(lines, -0.01)).toBe(-1);
      expect(getActiveLyricIndex(lines, -10.0)).toBe(-1);
    });

    it('returns -1 before the first lyric line (song intro)', () => {
      expect(getActiveLyricIndex(lines, 0.0)).toBe(-1);
      expect(getActiveLyricIndex(lines, 5.0)).toBe(-1);
      expect(getActiveLyricIndex(lines, 9.999)).toBe(-1);
    });

    it('returns 0 exactly at line 0 timestamp', () => {
      expect(getActiveLyricIndex(lines, 10.0)).toBe(0);
    });

    it('returns 0 between line 0 and line 1', () => {
      expect(getActiveLyricIndex(lines, 10.001)).toBe(0);
      expect(getActiveLyricIndex(lines, 15.0)).toBe(0);
      expect(getActiveLyricIndex(lines, 19.999)).toBe(0);
    });

    it('returns 1 exactly at line 1 timestamp', () => {
      expect(getActiveLyricIndex(lines, 20.0)).toBe(1);
    });

    it('handles floating point precision between lines', () => {
      expect(getActiveLyricIndex(lines, 20.5)).toBe(1);
      expect(getActiveLyricIndex(lines, 30.499)).toBe(1);
      expect(getActiveLyricIndex(lines, 30.5)).toBe(2);
      expect(getActiveLyricIndex(lines, 40.0)).toBe(2);
      expect(getActiveLyricIndex(lines, 49.999)).toBe(2);
      expect(getActiveLyricIndex(lines, 50.0)).toBe(3);
    });

    it('returns lines.length - 1 at exactly the last line and beyond', () => {
      expect(getActiveLyricIndex(lines, 80.25)).toBe(4);
      expect(getActiveLyricIndex(lines, 90.0)).toBe(4);
      expect(getActiveLyricIndex(lines, 3600.0)).toBe(4);
    });

    it('correctly operates with a single lyric line', () => {
      const single: LyricLine[] = [{ timeSeconds: 5.0, text: 'Single line' }];
      expect(getActiveLyricIndex(single, 2.0)).toBe(-1);
      expect(getActiveLyricIndex(single, 5.0)).toBe(0);
      expect(getActiveLyricIndex(single, 10.0)).toBe(0);
    });

    it('operates correctly and performantly on large line collections', () => {
      // 1,000 lines, 2 seconds apart: 0s, 2s, 4s, ..., 1998s
      const massiveLines: LyricLine[] = Array.from({ length: 1000 }, (_, i) => ({
        timeSeconds: i * 2,
        text: `Verse ${i}`,
      }));

      expect(getActiveLyricIndex(massiveLines, -1)).toBe(-1);
      expect(getActiveLyricIndex(massiveLines, 0)).toBe(0);
      expect(getActiveLyricIndex(massiveLines, 1.99)).toBe(0);
      expect(getActiveLyricIndex(massiveLines, 2.0)).toBe(1);
      expect(getActiveLyricIndex(massiveLines, 500)).toBe(250);
      expect(getActiveLyricIndex(massiveLines, 501.5)).toBe(250);
      expect(getActiveLyricIndex(massiveLines, 1998)).toBe(999);
      expect(getActiveLyricIndex(massiveLines, 3000)).toBe(999);
    });
  });
});
