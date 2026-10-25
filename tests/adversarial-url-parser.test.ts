import { describe, it, expect } from 'vitest';
import { parseYouTubeInput } from '../src/lib/url-parser';

describe('Adversarial Stress Suite: parseYouTubeInput', () => {
  describe('Extreme, malformed, non-string, and boundary inputs', () => {
    it('handles null, undefined, empty, and whitespace safely', () => {
      expect(parseYouTubeInput(null)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput(undefined)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('   ')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('\t\n\r  \n')).toEqual({ videoId: null, playlistId: null });
    });

    it('handles non-string types safely via runtime typecast', () => {
      expect(parseYouTubeInput(12345 as any)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput(true as any)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput(false as any)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput({} as any)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput([] as any)).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput((() => {}) as any)).toEqual({ videoId: null, playlistId: null });
    });

    it('handles massive string inputs without hanging or crashing (ReDoS protection)', () => {
      const hugeRandom = 'a'.repeat(50000);
      expect(parseYouTubeInput(hugeRandom)).toEqual({ videoId: null, playlistId: null });

      const hugeUrl = 'https://music.youtube.com/watch?v=5NV6Rdv1a3I&' + 'junk='.repeat(5000) + '1';
      const parsed = parseYouTubeInput(hugeUrl);
      expect(parsed.videoId).toBe('5NV6Rdv1a3I');

      const hugeBare = 'PL' + 'a'.repeat(50000);
      const parsedPlaylist = parseYouTubeInput(hugeBare);
      expect(parsedPlaylist.playlistId).toBe(hugeBare);
    });

    it('handles strings with null bytes and control characters', () => {
      expect(parseYouTubeInput('5NV6Rdv1a\0I')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('https://music.youtube.com/watch?v=5NV6Rdv1a\0I')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://music.youtube.com/watch?v=5NV6Rdv1a3I\u0000')).toBeDefined();
    });

    it('handles Unicode, emojis, and RTL characters without exceptions', () => {
      expect(parseYouTubeInput('https://music.youtube.com/watch?v=5NV6Rdv1a3I&artist=🎵🎶🎧')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('🎵🎶🎧')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('مرحبا')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('\u202Ehttps://music.youtube.com/watch?v=5NV6Rdv1a3I')).toBeDefined();
    });
  });

  describe('Adversarial & Non-YouTube URLs', () => {
    it('rejects domain spoofing, homographs, and subdomain tricks', () => {
      // Attacker domain ending with youtube.com without dot separation
      expect(parseYouTubeInput('https://evil-youtube.com/watch?v=5NV6Rdv1a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://notyoutube.com/watch?v=5NV6Rdv1a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
      // Attacker domain with youtube.com as subdomain
      expect(parseYouTubeInput('https://youtube.com.attacker.com/watch?v=5NV6Rdv1a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://music.youtube.com.attacker.com/watch?v=5NV6Rdv1a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://youtu.be.attacker.com/5NV6Rdv1a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
      // Userinfo spoofing
      expect(parseYouTubeInput('https://music.youtube.com@evil.com/watch?v=5NV6Rdv1a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
      // Cyrillic homograph
      expect(parseYouTubeInput('https://уoutu.be/5NV6Rdv1a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
    });

    it('rejects non-web schemes and injection attempts', () => {
      expect(parseYouTubeInput('javascript:alert(1)')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('javascript:alert("5NV6Rdv1a3I")')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('data:text/html,<script>alert(1)</script>')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('file:///C:/Windows/System32/drivers/etc/hosts')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('blob:https://music.youtube.com/uuid')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput("<script>alert('5NV6Rdv1a3I')</script>")).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput("' OR '1'='1")).toEqual({ videoId: null, playlistId: null });
    });

    it('rejects other popular music and video streaming services', () => {
      expect(parseYouTubeInput('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://soundcloud.com/artist/track-name')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://vimeo.com/76979871')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.dailymotion.com/video/x7tgad0')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://music.apple.com/us/album/song/123456')).toEqual({
        videoId: null,
        playlistId: null,
      });
    });
  });

  describe('Query string bloat, duplicate params, and edge cases', () => {
    it('extracts correctly when 100+ query parameters precede or follow v', () => {
      const bloat: string[] = [];
      for (let i = 0; i < 150; i++) {
        bloat.push(`param${i}=val${i}`);
      }
      const url = `https://music.youtube.com/watch?${bloat.join('&')}&v=5NV6Rdv1a3I&extra=true`;
      expect(parseYouTubeInput(url)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('extracts first v when multiple v parameters exist', () => {
      const url = 'https://www.youtube.com/watch?v=5NV6Rdv1a3I&v=dQw4w9WgXcQ';
      expect(parseYouTubeInput(url)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('handles empty or malformed v query values safely', () => {
      expect(parseYouTubeInput('https://www.youtube.com/watch?v=')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/watch?v=short')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/watch?v=waytoolongvideoid12345')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/watch?v=5NV6Rdv!a3I')).toEqual({
        videoId: null,
        playlistId: null,
      });
    });

    it('handles empty or blank list parameters safely', () => {
      expect(parseYouTubeInput('https://www.youtube.com/watch?v=5NV6Rdv1a3I&list=')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/watch?v=5NV6Rdv1a3I&list=%20%20')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('https://music.youtube.com/playlist?list=')).toEqual({
        videoId: null,
        playlistId: null,
      });
    });

    it('extracts both videoId and playlistId with messy timestamps and hashes', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890abcdef&t=1h2m3s#t=45s';
      expect(parseYouTubeInput(url)).toEqual({
        videoId: 'dQw4w9WgXcQ',
        playlistId: 'PL1234567890abcdef',
      });
    });

    it('extracts Liked Music (LM) and special short playlist parameters', () => {
      const url = 'https://music.youtube.com/watch?v=5NV6Rdv1a3I&list=LM';
      expect(parseYouTubeInput(url)).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: 'LM',
      });

      const playlistOnly = 'https://music.youtube.com/playlist?list=LM';
      expect(parseYouTubeInput(playlistOnly)).toEqual({
        videoId: null,
        playlistId: 'LM',
      });
    });
  });

  describe('Path structures: Shorts, Embed, /v/, and youtu.be', () => {
    it('handles YouTube shorts with trailing slashes and query params', () => {
      expect(parseYouTubeInput('https://www.youtube.com/shorts/5NV6Rdv1a3I/')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('https://youtube.com/shorts/5NV6Rdv1a3I?feature=share')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('youtube.com/shorts/5NV6Rdv1a3I')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('handles YouTube embed links with params', () => {
      expect(parseYouTubeInput('https://www.youtube.com/embed/5NV6Rdv1a3I/')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/embed/5NV6Rdv1a3I?autoplay=1&enablejsapi=1')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('handles YouTube /v/ links with params', () => {
      expect(parseYouTubeInput('https://www.youtube.com/v/5NV6Rdv1a3I/')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/v/5NV6Rdv1a3I?version=3')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
    });

    it('handles youtu.be links with extra paths, query params, and trailing slash', () => {
      expect(parseYouTubeInput('https://youtu.be/5NV6Rdv1a3I/')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('https://youtu.be/5NV6Rdv1a3I?t=42s&list=PL1234567890abcdef')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: 'PL1234567890abcdef',
      });
      expect(parseYouTubeInput('youtu.be/5NV6Rdv1a3I/subpath')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('https://youtu.be/')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://youtu.be')).toEqual({
        videoId: null,
        playlistId: null,
      });
    });

    it('handles empty /shorts/ or /embed/ or /v/ paths safely', () => {
      expect(parseYouTubeInput('https://www.youtube.com/shorts/')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/shorts')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/embed/')).toEqual({
        videoId: null,
        playlistId: null,
      });
      expect(parseYouTubeInput('https://www.youtube.com/v/')).toEqual({
        videoId: null,
        playlistId: null,
      });
    });
  });

  describe('Bare IDs & Prototype safety', () => {
    it('accurately parses standard bare 11-char video IDs', () => {
      expect(parseYouTubeInput('5NV6Rdv1a3I')).toEqual({
        videoId: '5NV6Rdv1a3I',
        playlistId: null,
      });
      expect(parseYouTubeInput('dQw4w9WgXcQ')).toEqual({
        videoId: 'dQw4w9WgXcQ',
        playlistId: null,
      });
      expect(parseYouTubeInput('---___1234a')).toEqual({
        videoId: '---___1234a',
        playlistId: null,
      });
    });

    it('accurately parses standard bare playlist IDs', () => {
      expect(parseYouTubeInput('PLrEnWoR732-DN6gmmsnfpv4QoX2iJqRjT')).toEqual({
        videoId: null,
        playlistId: 'PLrEnWoR732-DN6gmmsnfpv4QoX2iJqRjT',
      });
      expect(parseYouTubeInput('RDCLAK5uy_k1234567890')).toEqual({
        videoId: null,
        playlistId: 'RDCLAK5uy_k1234567890',
      });
      expect(parseYouTubeInput('OLAK5uy_1234567890abcdef')).toEqual({
        videoId: null,
        playlistId: 'OLAK5uy_1234567890abcdef',
      });
      expect(parseYouTubeInput('VLPL1234567890abcdef')).toEqual({
        videoId: null,
        playlistId: 'VLPL1234567890abcdef',
      });
      expect(parseYouTubeInput('UU1234567890abcdef')).toEqual({
        videoId: null,
        playlistId: 'UU1234567890abcdef',
      });
      expect(parseYouTubeInput('FL1234567890abcdef')).toEqual({
        videoId: null,
        playlistId: 'FL1234567890abcdef',
      });
    });

    it('rejects bare IDs with illegal length or characters', () => {
      expect(parseYouTubeInput('1234567890')).toEqual({ videoId: null, playlistId: null }); // 10 chars
      expect(parseYouTubeInput('123456789012')).toEqual({ videoId: null, playlistId: null }); // 12 chars
      expect(parseYouTubeInput('5NV6Rdv1a3!')).toEqual({ videoId: null, playlistId: null });
      expect(parseYouTubeInput('PLtooShort')).toEqual({ videoId: null, playlistId: null }); // < 10 suffix chars
      expect(parseYouTubeInput('XX123456789012345678')).toEqual({ videoId: null, playlistId: null }); // unknown prefix
    });

    it('is immune to prototype pollution keywords as inputs', () => {
      const protoRes = parseYouTubeInput('__proto__');
      expect(protoRes).toEqual({ videoId: null, playlistId: null });
      expect((Object.prototype as any).videoId).toBeUndefined();

      const toStringRes = parseYouTubeInput('toString');
      expect(toStringRes).toEqual({ videoId: null, playlistId: null });

      const valueOfRes = parseYouTubeInput('valueOf');
      expect(valueOfRes).toEqual({ videoId: null, playlistId: null });
    });
  });

  describe('100+ Adversarial Input Batch Generator', () => {
    it('executes 120 generated fuzz inputs without unhandled exceptions', () => {
      const fuzzInputs = [
        'http://',
        'https://',
        '://',
        'http:///music.youtube.com',
        'https:////www.youtube.com/watch?v=5NV6Rdv1a3I',
        'http:youtube.com',
        'https:music.youtube.com/watch?v=5NV6Rdv1a3I',
        'youtube.com',
        'music.youtube.com',
        'm.youtube.com',
        'youtu.be',
        'www.youtube.com',
        'https://music.youtube.com',
        'https://music.youtube.com/',
        'https://www.youtube.com',
        'https://www.youtube.com/',
        'https://m.youtube.com',
        'https://m.youtube.com/',
        'https://youtu.be',
        'https://youtu.be/',
        'https://gaming.youtube.com/watch?v=5NV6Rdv1a3I',
        'https://studio.youtube.com/video/5NV6Rdv1a3I/edit',
        'https://accounts.google.com/ServiceLogin',
        'https://www.google.com/url?q=https://music.youtube.com/watch?v=5NV6Rdv1a3I',
        'https://music.youtube.com/search?q=bohemian+rhapsody',
        'https://music.youtube.com/explore',
        'https://music.youtube.com/library',
        'https://music.youtube.com/channel/UC1234567890',
        'https://music.youtube.com/watch',
        'https://music.youtube.com/watch?',
        'https://music.youtube.com/watch?v',
        'https://music.youtube.com/watch?v=',
        'https://music.youtube.com/watch?v=&&&',
        'https://music.youtube.com/watch?&&&v=5NV6Rdv1a3I',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I&',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I#',
        'https://music.youtube.com/watch?#v=5NV6Rdv1a3I',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I?v=another',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I/extra',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I\\extra',
        'https://music.youtube.com:443/watch?v=5NV6Rdv1a3I',
        'https://music.youtube.com:8080/watch?v=5NV6Rdv1a3I',
        'http://music.youtube.com:80/watch?v=5NV6Rdv1a3I',
        'ftp://music.youtube.com/watch?v=5NV6Rdv1a3I',
        'ws://music.youtube.com/watch?v=5NV6Rdv1a3I',
        'wss://music.youtube.com/watch?v=5NV6Rdv1a3I',
        'git://music.youtube.com/watch?v=5NV6Rdv1a3I',
        'ssh://music.youtube.com/watch?v=5NV6Rdv1a3I',
        '//music.youtube.com/watch?v=5NV6Rdv1a3I',
        '///music.youtube.com/watch?v=5NV6Rdv1a3I',
        '\\\\music.youtube.com\\watch?v=5NV6Rdv1a3I',
        '..\\music.youtube.com',
        '../../../../etc/passwd',
        'C:\\Windows\\System32\\cmd.exe',
        '%20https://music.youtube.com/watch?v=5NV6Rdv1a3I',
        'https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3D5NV6Rdv1a3I',
        'https://music.youtube.com/watch?v=%35%4E%56%36%52%64%76%31%61%33%49',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I%00',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I%0A',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I%0D',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I%23',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I%26list=PL123',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I%20',
        '   https://music.youtube.com/watch?v=5NV6Rdv1a3I   ',
        '\t\t\thttps://music.youtube.com/watch?v=5NV6Rdv1a3I\n\n\n',
        '\r\nhttps://music.youtube.com/watch?v=5NV6Rdv1a3I\r\n',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I \n',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I\t',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I\u00A0',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I\u200B',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I\uFEFF',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I\u2028',
        'https://music.youtube.com/watch?v=5NV6Rdv1a3I\u2029',
        'undefined',
        'null',
        'NaN',
        'true',
        'false',
        '[object Object]',
        '{}',
        '[]',
        '{"videoId":"5NV6Rdv1a3I"}',
        '<iframe src="https://www.youtube.com/embed/5NV6Rdv1a3I"></iframe>',
        '<a href="https://music.youtube.com/watch?v=5NV6Rdv1a3I">click</a>',
        'youtube.com/watch?v=5NV6Rdv1a3I',
        'www.youtube.com/watch?v=5NV6Rdv1a3I',
        'm.youtube.com/watch?v=5NV6Rdv1a3I',
        'music.youtube.com/watch?v=5NV6Rdv1a3I',
        'music.youtube.com/playlist?list=PLrEnWoR732-DN6gmmsnfpv4QoX2iJqRjT',
        'youtu.be/5NV6Rdv1a3I',
        'youtu.be/5NV6Rdv1a3I?si=test',
        'youtu.be/5NV6Rdv1a3I?t=15',
        'youtu.be/5NV6Rdv1a3I?list=PL1234567890123456',
        'www.youtu.be/5NV6Rdv1a3I',
        'https://www.youtu.be/5NV6Rdv1a3I',
        'http://youtu.be/5NV6Rdv1a3I',
        'http://music.youtube.com/watch?v=5NV6Rdv1a3I',
        'http://www.youtube.com/watch?v=5NV6Rdv1a3I',
        'http://m.youtube.com/watch?v=5NV6Rdv1a3I',
        'http://youtube.com/watch?v=5NV6Rdv1a3I',
        'HTTPS://MUSIC.YOUTUBE.COM/WATCH?V=5NV6RDV1A3I',
        'HTTPS://WWW.YOUTUBE.COM/WATCH?V=5NV6RDV1A3I',
        'HTTPS://YOUTU.BE/5NV6RDV1A3I',
        'https://Music.YouTube.com/Watch?v=5NV6Rdv1a3I',
        'https://www.YouTube.com/Watch?v=5NV6Rdv1a3I',
        '5NV6Rdv1a3I',
        'dQw4w9WgXcQ',
        'abcdefghijk',
        'ABCDEFGHIJK',
        '01234567890',
        'a-b_c-d_e-f',
        'PL1234567890123456',
        'RD1234567890123456',
        'OLAK5uy_1234567890',
        'VL1234567890123456',
        'UU1234567890123456',
        'FL1234567890123456',
        'LM',
        'WL',
        'LL',
        'a',
        'ab',
        'abc',
        'abcd',
        'abcde',
        'abcdef',
        'abcdefg',
        'abcdefgh',
        'abcdefghi',
        'abcdefghij',
        'abcdefghijk', // exactly 11
        'abcdefghijkl', // 12
      ];

      expect(fuzzInputs.length).toBeGreaterThanOrEqual(100);

      for (const input of fuzzInputs) {
        let res: any;
        expect(() => {
          res = parseYouTubeInput(input);
        }).not.toThrow();

        expect(res).toBeDefined();
        expect(res).toHaveProperty('videoId');
        expect(res).toHaveProperty('playlistId');
        if (res.videoId !== null) {
          expect(typeof res.videoId).toBe('string');
          expect(res.videoId.length).toBe(11);
        }
        if (res.playlistId !== null) {
          expect(typeof res.playlistId).toBe('string');
          expect(res.playlistId.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
