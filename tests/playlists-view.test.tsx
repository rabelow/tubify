import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaylistsView } from '../src/components/PlaylistsView';
import { CompanionClient } from '../src/lib/companion-client';
import type { EditablePlaylist, PlaylistSummary, SearchTrack } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PlaylistsView Component', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let mockClient: CompanionClient;
  let onPlayTrack: ReturnType<typeof vi.fn>;
  let onPlayCustomPlaylist: ReturnType<typeof vi.fn>;
  let onPlayDesktopPlaylist: ReturnType<typeof vi.fn>;

  const sampleTracks: SearchTrack[] = [
    {
      videoId: 'v1111111111',
      title: 'Track One',
      artist: 'Artist One',
      duration: '3:30',
    },
    {
      videoId: 'v2222222222',
      title: 'Track Two',
      artist: 'Artist Two',
      duration: '4:15',
    },
  ];

  const sampleEditable: EditablePlaylist[] = [
    {
      id: 'pl-1',
      title: 'Coding Focus',
      name: 'Coding Focus',
      updatedAt: '2026-10-24T22:00:00.000Z',
      tracks: sampleTracks,
    },
  ];

  const sampleNative: PlaylistSummary[] = [
    {
      id: 'RDCLAK5uy_test',
      title: 'Today’s Biggest Hits',
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockClient = new CompanionClient({ token: 'mock-token' });
    onPlayTrack = vi.fn();
    onPlayCustomPlaylist = vi.fn();
    onPlayDesktopPlaylist = vi.fn();

    vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(sampleEditable);
    vi.spyOn(mockClient, 'getPlaylists').mockResolvedValue(sampleNative);
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
    vi.restoreAllMocks();
  });

  const renderComponent = async (element: React.ReactElement) => {
    await act(async () => {
      root!.render(element);
    });
  };

  it('renders both Tubify playlists and YouTube Music native playlists', async () => {
    await renderComponent(
      <PlaylistsView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayCustomPlaylist={onPlayCustomPlaylist}
        onPlayDesktopPlaylist={onPlayDesktopPlaylist}
      />
    );

    expect(container?.textContent).toContain('Coding Focus');
    expect(container?.textContent).toContain('Today’s Biggest Hits');
    expect(container?.textContent).toContain('2 tracks');
  });

  it('allows creating a new playlist through the inline form', async () => {
    const createdPl: EditablePlaylist = {
      id: 'pl-new',
      title: 'Workout Beats',
      name: 'Workout Beats',
      updatedAt: '2026-10-24T22:05:00.000Z',
      tracks: [],
    };
    vi.spyOn(mockClient, 'createEditablePlaylist').mockResolvedValueOnce(createdPl);

    await renderComponent(
      <PlaylistsView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayCustomPlaylist={onPlayCustomPlaylist}
        onPlayDesktopPlaylist={onPlayDesktopPlaylist}
      />
    );

    const newBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('+ New Playlist')
    );
    expect(newBtn).toBeDefined();

    await act(async () => {
      newBtn?.click();
    });

    const input = container?.querySelector('input[placeholder="Playlist name..."]') as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      input.value = 'Workout Beats';
      const tracker = (input as any)._valueTracker;
      if (tracker) tracker.setValue('');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const createSubmitBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent === 'Create'
    );

    await act(async () => {
      createSubmitBtn?.click();
    });

    expect(mockClient.createEditablePlaylist).toHaveBeenCalledWith('Workout Beats');
    expect(container?.textContent).toContain('Workout Beats');
  });

  it('plays entire custom playlist when clicking Play on the header', async () => {
    await renderComponent(
      <PlaylistsView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayCustomPlaylist={onPlayCustomPlaylist}
        onPlayDesktopPlaylist={onPlayDesktopPlaylist}
      />
    );

    const playAllBtn = container?.querySelector('button[aria-label="Play entire Coding Focus playlist"]') as HTMLButtonElement;
    expect(playAllBtn).not.toBeNull();

    act(() => {
      playAllBtn.click();
    });

    expect(onPlayCustomPlaylist).toHaveBeenCalledWith(sampleTracks);
  });

  it('deletes playlist with confirmation', async () => {
    vi.spyOn(mockClient, 'deleteEditablePlaylist').mockResolvedValueOnce(true);

    await renderComponent(
      <PlaylistsView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayCustomPlaylist={onPlayCustomPlaylist}
        onPlayDesktopPlaylist={onPlayDesktopPlaylist}
      />
    );

    const trashBtn = container?.querySelector('button[aria-label="Delete playlist"]') as HTMLButtonElement;
    expect(trashBtn).not.toBeNull();

    await act(async () => {
      trashBtn.click();
    });

    const confirmBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent === 'Confirm'
    );
    expect(confirmBtn).toBeDefined();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(mockClient.deleteEditablePlaylist).toHaveBeenCalledWith('pl-1');
    expect(container?.textContent).not.toContain('Coding Focus');
  });

  it('plays native desktop playlist on button click', async () => {
    await renderComponent(
      <PlaylistsView
        client={mockClient}
        onPlayTrack={onPlayTrack}
        onPlayCustomPlaylist={onPlayCustomPlaylist}
        onPlayDesktopPlaylist={onPlayDesktopPlaylist}
      />
    );

    const playNativeBtn = container?.querySelector(
      'button[aria-label="Play Today’s Biggest Hits on desktop"]'
    ) as HTMLButtonElement;
    expect(playNativeBtn).not.toBeNull();

    act(() => {
      playNativeBtn.click();
    });

    expect(onPlayDesktopPlaylist).toHaveBeenCalledWith('RDCLAK5uy_test');
  });
});
