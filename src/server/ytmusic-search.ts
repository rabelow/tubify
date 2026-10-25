/**
 * Tubify YouTube Music Search Service
 * 
 * Directly queries YouTube Music's internal Innertube WEB_REMIX API
 * without requiring API keys, client secrets, or OAuth credentials.
 * Normalizes deep renderer responses into clean SearchTrack[] records.
 */

import type { SearchTrack } from '../types/companion';

const INNERTUBE_SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
const SONGS_FILTER_PARAMS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const DURATION_REGEX = /^\d+:\d+(:\d+)?$/;

/**
 * Extracts an 11-character video ID using multi-path resolution:
 * Path 1: item.playlistItemData?.videoId
 * Path 2: item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
 * Path 3: item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId
 */
export function extractVideoId(item: any): string | null {
  if (!item) return null;

  // Path 1
  const id1 = item.playlistItemData?.videoId;
  if (typeof id1 === 'string' && VIDEO_ID_REGEX.test(id1)) {
    return id1;
  }

  // Path 2
  const id2 =
    item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (typeof id2 === 'string' && VIDEO_ID_REGEX.test(id2)) {
    return id2;
  }

  // Path 3
  const runs = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  if (Array.isArray(runs)) {
    for (const run of runs) {
      const id3 = run?.navigationEndpoint?.watchEndpoint?.videoId;
      if (typeof id3 === 'string' && VIDEO_ID_REGEX.test(id3)) {
        return id3;
      }
    }
  }

  return null;
}

/**
 * Parses raw Innertube item renderer into normalized SearchTrack.
 */
export function parseSearchItem(item: any): SearchTrack | null {
  if (!item) return null;

  const videoId = extractVideoId(item);
  if (!videoId) return null;

  // 1. Title Extraction
  const titleRuns = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  const rawTitle = titleRuns?.[0]?.text;
  const title = typeof rawTitle === 'string' && rawTitle.trim()
    ? rawTitle.trim()
    : 'Unknown Title';

  // 2. Subtitle / Metadata Extraction (Artist, Album, Duration)
  const metaRuns = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
  let artist = 'Unknown Artist';
  let album: string | undefined;
  let duration: string | undefined;

  if (Array.isArray(metaRuns) && metaRuns.length > 0) {
    const rawSubtitle = metaRuns.map((r: any) => r?.text ?? '').join('');
    // Split on bullet characters (" \u2022 ", " • ", or " · ")
    const parts = rawSubtitle
      .split(/\s*[\u2022•·]\s*/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    if (parts.length >= 3) {
      artist = parts[0];
      const lastPart = parts[parts.length - 1];
      if (DURATION_REGEX.test(lastPart)) {
        duration = lastPart;
        album = parts.slice(1, parts.length - 1).join(' • ');
      } else {
        album = parts.slice(1).join(' • ');
      }
    } else if (parts.length === 2) {
      artist = parts[0];
      if (DURATION_REGEX.test(parts[1])) {
        duration = parts[1];
      } else {
        album = parts[1];
      }
    } else if (parts.length === 1) {
      artist = parts[0];
    }
  }

  // 3. Thumbnail URL Extraction
  let thumbnailUrl: string | undefined;
  const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  if (Array.isArray(thumbnails) && thumbnails.length > 0) {
    const highest = thumbnails[thumbnails.length - 1];
    if (highest?.url) {
      let rawUrl = String(highest.url).trim();
      if (rawUrl.startsWith('//')) {
        rawUrl = `https:${rawUrl}`;
      }
      thumbnailUrl = rawUrl;
    }
  }

  return {
    videoId,
    title,
    artist,
    album: album || undefined,
    duration: duration || undefined,
    thumbnailUrl,
  };
}

/**
 * Parses full Innertube response body into an array of SearchTrack items.
 */
export function parseInnertubeResponse(data: any): SearchTrack[] {
  if (!data) return [];

  try {
    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs;
    if (!Array.isArray(tabs) || tabs.length === 0) return [];

    const sectionContents = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (!Array.isArray(sectionContents)) return [];

    // Find the section that contains musicShelfRenderer
    const shelfSection = sectionContents.find((section: any) => section?.musicShelfRenderer);
    if (!shelfSection) return [];

    const items = shelfSection.musicShelfRenderer?.contents;
    if (!Array.isArray(items)) return [];

    const tracks: SearchTrack[] = [];
    for (const item of items) {
      const renderer = item?.musicResponsiveListItemRenderer;
      if (renderer) {
        const track = parseSearchItem(renderer);
        if (track) {
          tracks.push(track);
        }
      }
    }

    return tracks;
  } catch (err) {
    console.warn('[tubify:search] Error navigating Innertube response tree:', err);
    return [];
  }
}

/**
 * Searches YouTube Music for songs matching the query.
 * Returns empty array if query is empty or whitespace.
 */
export async function searchYouTubeMusic(query: string): Promise<SearchTrack[]> {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  if (!cleanQuery) {
    return [];
  }

  const payload = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20241021.01.00',
      },
    },
    query: cleanQuery,
    params: SONGS_FILTER_PARAMS,
  };

  const response = await fetch(INNERTUBE_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`YouTube Music search failed with status ${response.status}`);
  }

  const data = await response.json();
  return parseInnertubeResponse(data);
}
