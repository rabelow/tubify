/**
 * Comprehensive Unit Test Suite for QueueView Component (Tasks T013, T014)
 * 
 * Verifies:
 * 1. Empty state handling (undefined, null, empty arrays)
 * 2. Up Next items rendering (title, author, duration, artwork, fallbacks)
 * 3. Active track highlighting via selectedItemIndex and item.selected
 * 4. Tap-to-jump track selection (onPlayIndex) with continuous indexing
 * 5. Autoplay recommendations rendering and continuous index mapping (items.length + automixIndex)
 * 6. "+ Add to Playlist" button behavior, payload normalization, and event propagation stop
 * 7. Keyboard navigation (Enter / Space)
 * 8. Edge cases (missing metadata, strings vs objects for thumbnails, automix-only queues)
 * 9. Integration in App.tsx with Queue tab
 */

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueueView, getQueueItemThumbnail } from '../src/components/QueueView';
import App from '../src/App';
import { saveConnectionProfile, clearConnectionProfile } from '../src/lib/storage';
import type { QueueItem, QueueState, SearchTrack } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock socket.io-client for App tests
vi.mock('socket.io-client', () => {
  return {
    io: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    })),
  };
});

describe('QueueView Component (T013)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
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

  const renderComponent = (element: React.ReactElement) => {
    act(() => {
      root!.render(element);
    });
  };

  const sampleItems: QueueItem[] = [
    {
      title: 'Get Lucky',
      author: 'Daft Punk ft. Pharrell Williams',
      duration: '4:08',
      selected: false,
      videoId: '5NV6Rdv1a3I',
      thumbnails: [
        { url: 'https://example.com/thumb1-small.jpg', width: 60, height: 60 },
        { url: 'https://example.com/thumb1-large.jpg', width: 300, height: 300 },
      ],
    },
    {
      title: 'Starboy',
      author: 'The Weeknd ft. Daft Punk',
      duration: '3:50',
      selected: true,
      videoId: '34Na4j8AVgA',
      thumbnails: [
        { url: 'https://example.com/thumb2-large.jpg', width: 300, height: 300 },
      ],
    },
    {
      title: 'Harder, Better, Faster, Stronger',
      author: 'Daft Punk',
      duration: '3:44',
      selected: false,
      videoId: 'gAjR4_CbPpQ',
      thumbnails: [],
    },
  ];

  const sampleAutomixItems: QueueItem[] = [
    {
      title: 'Instant Crush',
      author: 'Daft Punk ft. Julian Casablancas',
      duration: '5:37',
      selected: false,
      videoId: 'a5uQMwRMHcs',
      thumbnails: [
        { url: 'https://example.com/thumb3.jpg', width: 300, height: 300 },
      ],
    },
    {
      title: 'One More Time',
      author: 'Daft Punk',
      duration: '5:20',
      selected: false,
      videoId: 'FGBhQbmMxH8',
      thumbnails: [
        { url: 'https://example.com/thumb4.jpg', width: 300, height: 300 },
      ],
    },
  ];

  describe('Empty State Rendering', () => {
    it('renders empty state message when queue is undefined', () => {
      renderComponent(React.createElement(QueueView, { queue: undefined, onPlayIndex: vi.fn() }));

      expect(container?.textContent).toContain(
        'Queue is empty. Play songs on YouTube Music or search to add music.'
      );
    });

    it('renders empty state message when queue is null', () => {
      renderComponent(React.createElement(QueueView, { queue: null, onPlayIndex: vi.fn() }));

      expect(container?.textContent).toContain(
        'Queue is empty. Play songs on YouTube Music or search to add music.'
      );
    });

    it('renders empty state message when queue has empty items and automixItems', () => {
      const emptyQueue: QueueState = {
        items: [],
        automixItems: [],
        selectedItemIndex: -1,
      };

      renderComponent(React.createElement(QueueView, { queue: emptyQueue, onPlayIndex: vi.fn() }));

      expect(container?.textContent).toContain(
        'Queue is empty. Play songs on YouTube Music or search to add music.'
      );
    });
  });

  describe('Up Next List Rendering', () => {
    it('renders "Up Next" section title and all items in queue.items', () => {
      const queue: QueueState = {
        items: sampleItems,
        automixItems: [],
        selectedItemIndex: 1,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      expect(container?.textContent).toContain('Up Next');
      expect(container?.textContent).toContain('Get Lucky');
      expect(container?.textContent).toContain('Starboy');
      expect(container?.textContent).toContain('Harder, Better, Faster, Stronger');
      expect(container?.textContent).toContain('Daft Punk ft. Pharrell Williams');
      expect(container?.textContent).toContain('4:08');
    });

    it('renders thumbnail when present and fallback icon when missing', () => {
      const queue: QueueState = {
        items: sampleItems,
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const images = container?.querySelectorAll<HTMLImageElement>('img.track-thumb');
      expect(images?.length).toBe(2); // First 2 items have thumbnails
      expect(images?.[0].src).toBe('https://example.com/thumb1-large.jpg');
      expect(images?.[1].src).toBe('https://example.com/thumb2-large.jpg');

      // Third item has empty thumbnails, should render fallback
      const fallbacks = container?.querySelectorAll('.track-thumb-fallback');
      expect(fallbacks?.length).toBe(1);
      expect(fallbacks?.[0].textContent).toContain('🎵');
    });

    it('falls back to music note icon if image fails to load', () => {
      const queue: QueueState = {
        items: [sampleItems[0]],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const img = container?.querySelector<HTMLImageElement>('img.track-thumb');
      expect(img).not.toBeNull();

      // Trigger image error
      act(() => {
        img?.dispatchEvent(new Event('error'));
      });

      const fallback = container?.querySelector('.track-thumb-fallback');
      expect(fallback).not.toBeNull();
      expect(fallback?.textContent).toContain('🎵');
    });
  });

  describe('Active Track Highlighting', () => {
    it('highlights active track where index equals selectedItemIndex', () => {
      const queue: QueueState = {
        items: sampleItems,
        automixItems: [],
        selectedItemIndex: 1, // 'Starboy'
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const rows = container?.querySelectorAll('.track-row');
      expect(rows?.length).toBe(3);

      expect(rows?.[0].classList.contains('active')).toBe(false);
      expect(rows?.[1].classList.contains('active')).toBe(true);
      expect(rows?.[2].classList.contains('active')).toBe(false);

      // Verify playing indicator is present on active row
      const playingIndicator = rows?.[1].querySelector('.playing-indicator');
      expect(playingIndicator).not.toBeNull();
      expect(playingIndicator?.textContent).toContain('▶');
    });

    it('highlights active track when item.selected is true even if selectedItemIndex is not matching', () => {
      const itemsWithSelected: QueueItem[] = [
        { ...sampleItems[0], selected: true },
        { ...sampleItems[1], selected: false },
      ];
      const queue: QueueState = {
        items: itemsWithSelected,
        automixItems: [],
        selectedItemIndex: -1,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const rows = container?.querySelectorAll('.track-row');
      expect(rows?.[0].classList.contains('active')).toBe(true);
      expect(rows?.[1].classList.contains('active')).toBe(false);
    });
  });

  describe('Track Jumping (onPlayIndex)', () => {
    it('dispatches onPlayIndex with correct index when clicking a regular queue item', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: sampleItems,
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const rows = container?.querySelectorAll<HTMLDivElement>('.track-row');
      expect(rows?.length).toBe(3);

      // Click second item (index 1)
      act(() => {
        rows?.[1].click();
      });
      expect(onPlayIndex).toHaveBeenCalledWith(1);

      // Click third item (index 2)
      act(() => {
        rows?.[2].click();
      });
      expect(onPlayIndex).toHaveBeenCalledWith(2);
    });

    it('dispatches onPlayIndex on Enter and Space keydown events', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: sampleItems,
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const rows = container?.querySelectorAll<HTMLDivElement>('.track-row');

      // Enter key
      act(() => {
        rows?.[0].dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );
      });
      expect(onPlayIndex).toHaveBeenCalledWith(0);

      // Space key
      act(() => {
        rows?.[1].dispatchEvent(
          new KeyboardEvent('keydown', { key: ' ', bubbles: true })
        );
      });
      expect(onPlayIndex).toHaveBeenCalledWith(1);

      // Irrelevant key (e.g. Tab) should not trigger
      act(() => {
        rows?.[2].dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
        );
      });
      expect(onPlayIndex).toHaveBeenCalledTimes(2);
    });
  });

  describe('Autoplay Recommendations & Continuous Indexing', () => {
    it('renders "Autoplay Recommendations" section subheader when automixItems are present', () => {
      const queue: QueueState = {
        items: sampleItems,
        automixItems: sampleAutomixItems,
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      expect(container?.textContent).toContain('Autoplay Recommendations');
      expect(container?.textContent).toContain('Instant Crush');
      expect(container?.textContent).toContain('One More Time');
    });

    it('dispatches continuous index (items.length + automixIndex) when clicking automix items', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: sampleItems, // 3 items (indices 0, 1, 2)
        automixItems: sampleAutomixItems, // 2 items (indices 0, 1) -> continuous 3, 4
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      // Automix item 0 (Instant Crush) has continuous index 3
      const automixRow0 = container?.querySelector<HTMLDivElement>(
        '[data-testid="queue-item-3"]'
      );
      expect(automixRow0).not.toBeNull();
      act(() => {
        automixRow0?.click();
      });
      expect(onPlayIndex).toHaveBeenCalledWith(3);

      // Automix item 1 (One More Time) has continuous index 4
      const automixRow1 = container?.querySelector<HTMLDivElement>(
        '[data-testid="queue-item-4"]'
      );
      expect(automixRow1).not.toBeNull();
      act(() => {
        automixRow1?.click();
      });
      expect(onPlayIndex).toHaveBeenCalledWith(4);
    });

    it('highlights automix item as active when selectedItemIndex matches continuous index', () => {
      const queue: QueueState = {
        items: sampleItems, // length 3
        automixItems: sampleAutomixItems,
        selectedItemIndex: 3, // continuous index for first automix item
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const automixRow0 = container?.querySelector('[data-testid="queue-item-3"]');
      expect(automixRow0?.classList.contains('active')).toBe(true);

      const playingIndicator = automixRow0?.querySelector('.playing-indicator');
      expect(playingIndicator).not.toBeNull();
    });

    it('correctly handles queue with only automixItems and empty items (offset 0)', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: [],
        automixItems: sampleAutomixItems,
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      expect(container?.textContent).toContain('Autoplay Recommendations');
      expect(container?.textContent).not.toContain('Up Next');

      const automixRow0 = container?.querySelector<HTMLDivElement>(
        '[data-testid="queue-item-0"]'
      );
      expect(automixRow0).not.toBeNull();
      expect(automixRow0?.classList.contains('active')).toBe(true);

      act(() => {
        automixRow0?.click();
      });
      expect(onPlayIndex).toHaveBeenCalledWith(0);
    });
  });

  describe('Add to Playlist Button', () => {
    it('dispatches onAddToPlaylist with normalized SearchTrack payload', () => {
      const onAddToPlaylist = vi.fn();
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: sampleItems,
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(
        React.createElement(QueueView, {
          queue,
          onPlayIndex,
          onAddToPlaylist,
        })
      );

      const addBtn0 = container?.querySelector<HTMLButtonElement>(
        '[data-testid="queue-add-0"]'
      );
      expect(addBtn0).not.toBeNull();

      act(() => {
        addBtn0?.click();
      });

      // Verify onAddToPlaylist was called with normalized SearchTrack
      expect(onAddToPlaylist).toHaveBeenCalledTimes(1);
      const calledTrack: SearchTrack = onAddToPlaylist.mock.calls[0][0];
      expect(calledTrack.videoId).toBe('5NV6Rdv1a3I');
      expect(calledTrack.title).toBe('Get Lucky');
      expect(calledTrack.artist).toBe('Daft Punk ft. Pharrell Williams');
      expect(calledTrack.duration).toBe('4:08');
      expect(calledTrack.thumbnailUrl).toBe('https://example.com/thumb1-large.jpg');

      // Verify clicking + Add stopped propagation and did NOT trigger onPlayIndex
      expect(onPlayIndex).not.toHaveBeenCalled();
    });

    it('works on automix items as well with correct normalized payload', () => {
      const onAddToPlaylist = vi.fn();
      const queue: QueueState = {
        items: sampleItems, // 3
        automixItems: sampleAutomixItems,
        selectedItemIndex: 0,
      };

      renderComponent(
        React.createElement(QueueView, {
          queue,
          onPlayIndex: vi.fn(),
          onAddToPlaylist,
        })
      );

      const addAutomixBtn = container?.querySelector<HTMLButtonElement>(
        '[data-testid="queue-add-3"]'
      );
      expect(addAutomixBtn).not.toBeNull();

      act(() => {
        addAutomixBtn?.click();
      });

      expect(onAddToPlaylist).toHaveBeenCalledWith({
        videoId: 'a5uQMwRMHcs',
        title: 'Instant Crush',
        artist: 'Daft Punk ft. Julian Casablancas',
        duration: '5:37',
        thumbnailUrl: 'https://example.com/thumb3.jpg',
      });
    });

    it('gracefully handles missing onAddToPlaylist callback', () => {
      const queue: QueueState = {
        items: [sampleItems[0]],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const addBtn = container?.querySelector<HTMLButtonElement>(
        '[data-testid="queue-add-0"]'
      );
      expect(() => {
        act(() => {
          addBtn?.click();
        });
      }).not.toThrow();
    });
  });

  describe('Edge Cases & Resiliency', () => {
    it('gracefully renders queue item with completely missing optional fields', () => {
      const minimalItem: QueueItem = {
        title: '',
        author: '',
        duration: '',
        selected: false,
      };

      const queue: QueueState = {
        items: [minimalItem],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      expect(container?.textContent).toContain('Unknown Track');
      expect(container?.textContent).toContain('Unknown Artist');
    });

    it('getQueueItemThumbnail handles raw string thumbnails, object thumbnails, and empty arrays', () => {
      const itemWithStringThumb: QueueItem = {
        title: 'A',
        author: 'B',
        duration: '1:00',
        selected: false,
        thumbnails: ['https://example.com/direct.jpg'] as any,
      };
      expect(getQueueItemThumbnail(itemWithStringThumb)).toBe(
        'https://example.com/direct.jpg'
      );

      const itemWithEmptyThumb: QueueItem = {
        title: 'A',
        author: 'B',
        duration: '1:00',
        selected: false,
        thumbnails: [],
      };
      expect(getQueueItemThumbnail(itemWithEmptyThumb)).toBeUndefined();

      const itemWithNoThumb: QueueItem = {
        title: 'A',
        author: 'B',
        duration: '1:00',
        selected: false,
      };
      expect(getQueueItemThumbnail(itemWithNoThumb)).toBeUndefined();
    });

    it('handles async onPlayIndex promise rejection gracefully', async () => {
      const rejectingPlay = vi.fn().mockRejectedValue(new Error('Desktop offline'));
      const queue: QueueState = {
        items: [sampleItems[0]],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: rejectingPlay }));

      const row = container?.querySelector<HTMLDivElement>('.track-row');
      expect(() => {
        act(() => {
          row?.click();
        });
      }).not.toThrow();

      expect(rejectingPlay).toHaveBeenCalledWith(0);
    });
  });

  describe('App.tsx Integration (T014)', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      clearConnectionProfile();
      localStorage.clear();
    });

    it('renders QueueView with live tracks when switching to the Queue tab in connected App', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'test-token-valid',
      });

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                player: {
                  trackState: 1,
                  videoProgress: 10,
                  volume: 50,
                  muted: false,
                  adPlaying: false,
                  queue: {
                    items: sampleItems,
                    automixItems: sampleAutomixItems,
                    selectedItemIndex: 1,
                  },
                },
                video: {
                  id: '34Na4j8AVgA',
                  title: 'Starboy',
                  author: 'The Weeknd ft. Daft Punk',
                  durationSeconds: 230,
                  channelId: 'UC',
                  album: null,
                  albumId: null,
                  likeStatus: null,
                  thumbnails: [],
                },
                playlistId: null,
              }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      renderComponent(React.createElement(App));

      // Wait for auto-connect and initial state fetch
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });

      // Locate the Queue tab button in the bottom navigation
      const queueNavButton = container?.querySelector<HTMLButtonElement>(
        'button.nav-item[aria-label="Queue"]'
      );
      expect(queueNavButton).not.toBeNull();

      // Click the Queue tab
      act(() => {
        queueNavButton?.click();
      });

      // App should now render the QueueView container
      const queueView = container?.querySelector('.queue-view');
      expect(queueView).not.toBeNull();

      // Should display items from the state
      expect(container?.textContent).toContain('Up Next');
      expect(container?.textContent).toContain('Get Lucky');
      expect(container?.textContent).toContain('Starboy');
      expect(container?.textContent).toContain('Autoplay Recommendations');
      expect(container?.textContent).toContain('Instant Crush');

      // Second item ('Starboy') should be active
      const activeItem = container?.querySelector('.track-row.active');
      expect(activeItem).not.toBeNull();
      expect(activeItem?.textContent).toContain('Starboy');
    });

    it('dispatches playQueueIndex command when tapping track in App Queue tab', async () => {
      saveConnectionProfile({
        host: '192.168.0.144',
        port: 9863,
        token: 'test-token-valid',
      });

      let commandSent: any = null;

      globalThis.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (url.includes('/metadata')) {
          return Promise.resolve(new Response(JSON.stringify({ apiVersions: ['v1'] }), { status: 200 }));
        }
        if (url.includes('/api/v1/state')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                player: {
                  trackState: 1,
                  videoProgress: 10,
                  volume: 50,
                  muted: false,
                  adPlaying: false,
                  queue: {
                    items: sampleItems,
                    automixItems: sampleAutomixItems,
                    selectedItemIndex: 0,
                  },
                },
                video: {
                  id: '5NV6Rdv1a3I',
                  title: 'Get Lucky',
                  author: 'Daft Punk',
                  durationSeconds: 248,
                  channelId: 'UC',
                  album: null,
                  albumId: null,
                  likeStatus: null,
                  thumbnails: [],
                },
                playlistId: null,
              }),
              { status: 200 }
            )
          );
        }
        if (url.includes('/api/v1/command')) {
          commandSent = JSON.parse(opts?.body || '{}');
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      renderComponent(React.createElement(App));

      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });

      // Switch to Queue tab
      const queueNavButton = container?.querySelector<HTMLButtonElement>(
        'button.nav-item[aria-label="Queue"]'
      );
      act(() => {
        queueNavButton?.click();
      });

      // Click on automix item (index 3)
      const automixRow = container?.querySelector<HTMLDivElement>(
        '[data-testid="queue-item-3"]'
      );
      expect(automixRow).not.toBeNull();

      act(() => {
        automixRow?.click();
      });

      expect(commandSent).toEqual({
        command: 'playQueueIndex',
        data: 3,
      });
    });
  });
});
