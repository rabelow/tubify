/**
 * Tubify YouTube URL & Video/Playlist ID Parser
 * 
 * Safely parses YouTube and YouTube Music URLs, short links, embed links,
 * shorts links, and bare IDs into videoId and playlistId descriptors.
 */

export interface ParsedYouTubeInput {
  videoId: string | null;
  playlistId: string | null;
}

/** Standard YouTube 11-character video ID regex */
const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/** Standard YouTube playlist ID prefix patterns */
const PLAYLIST_ID_REGEX = /^(PL|RD|OLAK5uy_|VL|UU|FL)[a-zA-Z0-9_-]{10,}$/;

/**
 * Parses user input (URL or bare ID) and extracts videoId and/or playlistId.
 * 
 * @param input Raw string entered or pasted by the user.
 * @returns ParsedYouTubeInput with videoId and playlistId (or null).
 */
export function parseYouTubeInput(input: string | null | undefined): ParsedYouTubeInput {
  const result: ParsedYouTubeInput = { videoId: null, playlistId: null };

  if (!input || typeof input !== 'string') {
    return result;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return result;
  }

  // 1. Check if the input is a bare 11-character video ID
  if (VIDEO_ID_REGEX.test(trimmed)) {
    return { videoId: trimmed, playlistId: null };
  }

  // 2. Check if the input is a bare playlist ID
  if (PLAYLIST_ID_REGEX.test(trimmed)) {
    return { videoId: null, playlistId: trimmed };
  }

  // 3. Prepare URL string: prepend https:// if protocol was omitted
  let urlString = trimmed;
  if (!/^https?:\/\//i.test(urlString)) {
    if (/^(www\.)?(youtube\.com|music\.youtube\.com|m\.youtube\.com|youtu\.be)\//i.test(urlString)) {
      urlString = `https://${urlString}`;
    }
  }

  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Verify domain is YouTube or YouTube Music
    const isYouTubeDomain =
      hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com') ||
      hostname === 'youtu.be';

    if (!isYouTubeDomain) {
      return result;
    }

    // Extract playlist ID from 'list' query parameter if present
    const listParam = url.searchParams.get('list');
    if (listParam && listParam.trim().length > 0) {
      result.playlistId = listParam.trim();
    }

    if (hostname === 'youtu.be') {
      // Short URL format: pathname is /<videoId>
      const pathSegment = url.pathname.slice(1).split('/')[0];
      if (pathSegment && VIDEO_ID_REGEX.test(pathSegment)) {
        result.videoId = pathSegment;
      }
    } else {
      // Standard youtube.com, music.youtube.com, or m.youtube.com
      const vParam = url.searchParams.get('v');
      if (vParam && VIDEO_ID_REGEX.test(vParam)) {
        result.videoId = vParam;
      } else if (
        url.pathname.startsWith('/shorts/') ||
        url.pathname.startsWith('/embed/') ||
        url.pathname.startsWith('/v/')
      ) {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length >= 2 && VIDEO_ID_REGEX.test(parts[1])) {
          result.videoId = parts[1];
        }
      }
    }
  } catch {
    // Malformed URL or non-URL string: return empty result safely
  }

  return result;
}
