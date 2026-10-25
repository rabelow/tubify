import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddToPlaylistModal } from '../src/components/AddToPlaylistModal';
import { CompanionClient } from '../src/lib/companion-client';
import type { EditablePlaylist, SearchTrack } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('AddToPlaylistModal Component', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let mockClient: CompanionClient;
  let onClose: ReturnType<typeof vi.fn>;
  let onSuccess: ReturnType<typeof vi.fn>;

  const sampleTrack: SearchTrack = {
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    duration: '3:33',
    thumbnailUrl: 'https://lh3.googleusercontent.com/rick.jpg',
  };

  const samplePlaylists: EditablePlaylist[] = [
    {
      id: 'pl-101',
      title: 'Classics',
      name: 'Classics',
      updatedAt: '2026-10-24T22:00:00Z',
      tracks: [],
    },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockClient = new CompanionClient();
    onClose = vi.fn();
    onSuccess = vi.fn();

    vi.spyOn(mockClient, 'getEditablePlaylists').mockResolvedValue(samplePlaylists);
    vi.spyOn(mockClient, 'addTrackToPlaylist').mockResolvedValue(samplePlaylists[0]);
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

  it('renders track preview and existing playlists', async () => {
    await renderComponent(
      <AddToPlaylistModal
        track={sampleTrack}
        client={mockClient}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    expect(container?.textContent).toContain('Never Gonna Give You Up');
    expect(container?.textContent).toContain('Rick Astley');
    expect(container?.textContent).toContain('Classics');
  });

  it('adds track to existing playlist on selection and triggers onSuccess', async () => {
    await renderComponent(
      <AddToPlaylistModal
        track={sampleTrack}
        client={mockClient}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const playlistBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Classics')
    );
    expect(playlistBtn).toBeDefined();

    await act(async () => {
      playlistBtn?.click();
    });

    expect(mockClient.addTrackToPlaylist).toHaveBeenCalledWith('pl-101', sampleTrack);
    expect(onSuccess).toHaveBeenCalledWith('Classics');
  });

  it('creates new playlist and adds track when submitting quick create form', async () => {
    const created: EditablePlaylist = {
      id: 'pl-new-99',
      title: 'New Grooves',
      name: 'New Grooves',
      updatedAt: '2026-10-24T22:10:00Z',
      tracks: [],
    };

    vi.spyOn(mockClient, 'createEditablePlaylist').mockResolvedValueOnce(created);

    await renderComponent(
      <AddToPlaylistModal
        track={sampleTrack}
        client={mockClient}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const input = container?.querySelector('input[placeholder="New playlist name..."]') as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      input.value = 'New Grooves';
      const tracker = (input as any)._valueTracker;
      if (tracker) tracker.setValue('');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const createBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('+ Create & Add')
    );
    expect(createBtn).toBeDefined();

    await act(async () => {
      createBtn?.click();
    });

    expect(mockClient.createEditablePlaylist).toHaveBeenCalledWith('New Grooves');
    expect(mockClient.addTrackToPlaylist).toHaveBeenCalledWith('pl-new-99', sampleTrack);
    expect(onSuccess).toHaveBeenCalledWith('New Grooves');
  });

  it('calls onClose when close or cancel button is clicked', async () => {
    await renderComponent(
      <AddToPlaylistModal
        track={sampleTrack}
        client={mockClient}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    const closeBtn = container?.querySelector('button[aria-label="Close modal"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    act(() => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const cancelBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent === 'Cancel'
    );
    expect(cancelBtn).toBeDefined();

    act(() => {
      cancelBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
