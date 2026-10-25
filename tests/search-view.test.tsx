import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchView } from '../src/components/SearchView';
import { CompanionClient } from '../src/lib/companion-client';
import type { SearchTrack } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('SearchView Component', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let mockClient: CompanionClient;
  let onPlayTrack: ReturnType<typeof vi.fn>;
  let onPlayDirectVideo: ReturnType<typeof vi.fn>;
  let onAddToPlaylist: ReturnType<typeof vi.fn>;

  const sampleTracks: SearchTrack[] = [
    {
      videoId: '4D7u5KF7SP8',
      title: 'Get Lucky',
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      duration: '6:10',
      thumbnailUrl: 'https://lh3.googleusercontent.com/test.jpg',
    },
    {
      videoId: 'fJ9rUzIMcZQ',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      duration: '5:55',
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockClient = new CompanionClient();
    onPlayTrack = vi.fn();
    onPlayDirectVideo = vi.fn();
    onAddToPlaylist = vi.fn();
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root!.unmount();
      });
      container.remove();
    }
    container = null;
    root = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const renderComponent = (element: React.ReactElement) => {
    act(() => {
      root!.render(element);
    });
  };

  it('renders initial idle prompt when query is empty', () => {
    renderComponent(
      <SearchView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayDirectVideo={onPlayDirectVideo}
        onAddToPlaylist={onAddToPlaylist}
      />
    );

    expect(container?.textContent).toContain('Search Songs on YouTube Music');
    const input = container?.querySelector('input.search-input') as HTMLInputElement;
    expect(input).not.toBeNull();
  });

  it('debounces search input and displays results from client.searchSongs', async () => {
    vi.spyOn(mockClient, 'searchSongs').mockResolvedValueOnce({
      results: sampleTracks,
    });

    renderComponent(
      <SearchView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayDirectVideo={onPlayDirectVideo}
        onAddToPlaylist={onAddToPlaylist}
      />
    );

    const input = container?.querySelector('input.search-input') as HTMLInputElement;
    act(() => {
      input.value = 'Daft Punk';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // In React 19 synthetic change:
      const tracker = (input as any)._valueTracker;
      if (tracker) tracker.setValue('');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Advance debounce timer
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(mockClient.searchSongs).toHaveBeenCalledWith('Daft Punk');
    expect(container?.textContent).toContain('Get Lucky');
    expect(container?.textContent).toContain('Bohemian Rhapsody');
  });

  it('detects direct YouTube URL and displays Direct Link Detected card', () => {
    renderComponent(
      <SearchView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayDirectVideo={onPlayDirectVideo}
        onAddToPlaylist={onAddToPlaylist}
      />
    );

    const input = container?.querySelector('input.search-input') as HTMLInputElement;
    act(() => {
      input.value = 'https://music.youtube.com/watch?v=5NV6Rdv1a3I';
      const tracker = (input as any)._valueTracker;
      if (tracker) tracker.setValue('');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Direct YouTube Link Detected');
    expect(container?.textContent).toContain('5NV6Rdv1a3I');

    // Tap "Play Now on PC"
    const playDirectBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Play Now on PC')
    );
    expect(playDirectBtn).toBeDefined();

    act(() => {
      playDirectBtn?.click();
    });

    expect(onPlayDirectVideo).toHaveBeenCalledWith('5NV6Rdv1a3I', null);
  });

  it('detects bare 11-char video ID and allows adding to playlist', () => {
    renderComponent(
      <SearchView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayDirectVideo={onPlayDirectVideo}
        onAddToPlaylist={onAddToPlaylist}
      />
    );

    const input = container?.querySelector('input.search-input') as HTMLInputElement;
    act(() => {
      input.value = 'dQw4w9WgXcQ';
      const tracker = (input as any)._valueTracker;
      if (tracker) tracker.setValue('');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Direct YouTube Link Detected');

    const addDirectBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('+ Add to Playlist')
    );
    expect(addDirectBtn).toBeDefined();

    act(() => {
      addDirectBtn?.click();
    });

    expect(onAddToPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: 'dQw4w9WgXcQ',
      })
    );
  });
});
