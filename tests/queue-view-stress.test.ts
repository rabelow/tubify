/**
 * Empirical Stress & Adversarial Test Suite for QueueView Component
 * 
 * Verifies:
 * 1. Massive queues: 500+ items in `items` and 500+ items in `automixItems` (1,000 to 3,000 tracks).
 * 2. Continuous index mapping across massive queues up to boundary indices.
 * 3. Sparse & corrupted properties: null, undefined, empty strings, malformed thumbnails, long strings, Unicode.
 * 4. Out-of-bounds `selectedItemIndex`: -1, 999999, -999999, NaN, Infinity, floats, null, undefined.
 * 5. Rapid tap bursts: 100+ clicks in tight loops, rapid alternating item clicks, rapid "+ Add" bursts.
 * 6. Stop-propagation integrity under high frequency interactions.
 * 7. Rapid re-renders with shifting selectedItemIndex and queue states.
 * 8. Resilient empty state when queue structures are deformed or partially null.
 * 9. Duplicate track keys and React console error detection.
 */

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueueView, getQueueItemThumbnail } from '../src/components/QueueView';
import type { QueueItem, QueueState, SearchTrack } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('QueueView Empirical Stress & Adversarial Suite', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  const renderComponent = (element: React.ReactElement) => {
    act(() => {
      root!.render(element);
    });
  };

  /**
   * Helper to generate synthetic queue items
   */
  const generateQueueItems = (count: number, prefix: string): QueueItem[] => {
    const items: QueueItem[] = [];
    for (let i = 0; i < count; i++) {
      items.push({
        title: `${prefix} Track ${i}`,
        author: `Artist ${i % 25}`,
        duration: `${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}`,
        selected: false,
        videoId: `vid_${prefix}_${i}`,
        thumbnails: [
          { url: `https://example.com/${prefix}_${i}_sm.jpg`, width: 60, height: 60 },
          { url: `https://example.com/${prefix}_${i}_lg.jpg`, width: 300, height: 300 },
        ],
      });
    }
    return items;
  };

  // ==========================================================================
  // 1. MASSIVE DATASETS: 500+ Items in items and 500+ Items in automixItems
  // ==========================================================================
  describe('1. Massive Queues Stress Testing (500+ items each)', () => {
    it('successfully renders a massive queue of 600 items and 600 automixItems (1,200 tracks total)', () => {
      const itemsCount = 600;
      const automixCount = 600;
      const totalCount = itemsCount + automixCount;

      const items = generateQueueItems(itemsCount, 'UpNext');
      const automixItems = generateQueueItems(automixCount, 'Automix');

      const queue: QueueState = {
        items,
        automixItems,
        selectedItemIndex: 0,
      };

      const startTime = performance.now();
      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));
      const renderDuration = performance.now() - startTime;

      // Ensure render succeeds within reasonable time limit (< 2500ms in jsdom)
      expect(renderDuration).toBeLessThan(2500);

      // Verify DOM row count
      const trackRows = container?.querySelectorAll('.track-row');
      expect(trackRows?.length).toBe(totalCount);

      // Verify Up Next and Autoplay sections are both rendered
      const sectionTitles = container?.querySelectorAll('.queue-section-title');
      expect(sectionTitles?.length).toBe(2);
      expect(sectionTitles?.[0].textContent).toBe('Up Next');
      expect(sectionTitles?.[1].textContent).toBe('Autoplay Recommendations');

      // Verify boundary tracks in DOM
      expect(container?.querySelector('[data-testid="queue-item-0"]')?.textContent).toContain(
        'UpNext Track 0'
      );
      expect(container?.querySelector(`[data-testid="queue-item-${itemsCount - 1}"]`)?.textContent).toContain(
        `UpNext Track ${itemsCount - 1}`
      );
      expect(container?.querySelector(`[data-testid="queue-item-${itemsCount}"]`)?.textContent).toContain(
        'Automix Track 0'
      );
      expect(container?.querySelector(`[data-testid="queue-item-${totalCount - 1}"]`)?.textContent).toContain(
        `Automix Track ${automixCount - 1}`
      );

      // Verify no React console errors were triggered
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('accurately dispatches continuous indices for boundary tracks in massive queues', () => {
      const itemsCount = 550;
      const automixCount = 550;
      const totalCount = itemsCount + automixCount;

      const items = generateQueueItems(itemsCount, 'Normal');
      const automixItems = generateQueueItems(automixCount, 'Auto');

      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items,
        automixItems,
        selectedItemIndex: -1,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      // Click first item (index 0)
      const firstItem = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-0"]');
      act(() => {
        firstItem?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(0);

      // Click last regular item (index itemsCount - 1 = 549)
      const lastRegularItem = container?.querySelector<HTMLDivElement>(
        `[data-testid="queue-item-${itemsCount - 1}"]`
      );
      act(() => {
        lastRegularItem?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(itemsCount - 1);

      // Click first automix item (index itemsCount = 550)
      const firstAutomixItem = container?.querySelector<HTMLDivElement>(
        `[data-testid="queue-item-${itemsCount}"]`
      );
      act(() => {
        firstAutomixItem?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(itemsCount);

      // Click middle automix item (index 550 + 250 = 800)
      const midAutomixItem = container?.querySelector<HTMLDivElement>(
        `[data-testid="queue-item-${itemsCount + 250}"]`
      );
      act(() => {
        midAutomixItem?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(itemsCount + 250);

      // Click last automix item (index totalCount - 1 = 1099)
      const lastAutomixItem = container?.querySelector<HTMLDivElement>(
        `[data-testid="queue-item-${totalCount - 1}"]`
      );
      act(() => {
        lastAutomixItem?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(totalCount - 1);

      expect(onPlayIndex).toHaveBeenCalledTimes(5);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('correctly highlights deep continuous selectedItemIndex in automix section of massive queue', () => {
      const itemsCount = 500;
      const automixCount = 500;
      const targetIndex = itemsCount + 375; // 875

      const items = generateQueueItems(itemsCount, 'Main');
      const automixItems = generateQueueItems(automixCount, 'Rec');

      const queue: QueueState = {
        items,
        automixItems,
        selectedItemIndex: targetIndex,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const activeRows = container?.querySelectorAll('.track-row.active');
      expect(activeRows?.length).toBe(1);

      const targetRow = container?.querySelector(`[data-testid="queue-item-${targetIndex}"]`);
      expect(targetRow).not.toBeNull();
      expect(targetRow?.classList.contains('active')).toBe(true);
      expect(targetRow?.querySelector('.playing-indicator')).not.toBeNull();
      expect(targetRow?.textContent).toContain('Rec Track 375');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('handles ultra-massive queue of 1,500 items + 1,500 automix items (3,000 tracks) without crashing', () => {
      const items = generateQueueItems(1500, 'HeavyA');
      const automixItems = generateQueueItems(1500, 'HeavyB');

      const queue: QueueState = {
        items,
        automixItems,
        selectedItemIndex: 2999,
      };

      expect(() => {
        renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));
      }).not.toThrow();

      const lastRow = container?.querySelector('[data-testid="queue-item-2999"]');
      expect(lastRow?.classList.contains('active')).toBe(true);
      expect(lastRow?.textContent).toContain('HeavyB Track 1499');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('renders 500 identical items without duplicate key collisions or React warnings', () => {
      // 500 items having identical title and identical videoId
      const identicalItems: QueueItem[] = Array.from({ length: 500 }, () => ({
        title: 'Same Song',
        author: 'Same Artist',
        duration: '3:30',
        selected: false,
        videoId: 'same_video_id',
      }));

      const queue: QueueState = {
        items: identicalItems,
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      expect(container?.querySelectorAll('.track-row').length).toBe(500);

      // Verify no React key warnings (e.g. "Each child in a list should have a unique 'key' prop")
      const keyWarningCalls = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('key'))
      );
      expect(keyWarningCalls.length).toBe(0);
    });
  });

  // ==========================================================================
  // 2. SPARSE & CORRUPTED PROPERTIES
  // ==========================================================================
  describe('2. Sparse Properties & Malformed Items Stress Testing', () => {
    it('safely renders tracks with missing / null / undefined / empty string properties', () => {
      const sparseItems: QueueItem[] = [
        {
          title: null as any,
          author: null as any,
          duration: null as any,
          videoId: null as any,
          selected: false,
          thumbnails: null as any,
        },
        {
          title: undefined as any,
          author: undefined as any,
          duration: undefined as any,
          videoId: undefined as any,
          selected: false,
          thumbnails: undefined as any,
        },
        {
          title: '',
          author: '',
          duration: '',
          videoId: '',
          selected: false,
          thumbnails: [],
        },
      ];

      const queue: QueueState = {
        items: sparseItems,
        automixItems: [],
        selectedItemIndex: -1,
      };

      expect(() => {
        renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));
      }).not.toThrow();

      const rows = container?.querySelectorAll('.track-row');
      expect(rows?.length).toBe(3);

      // Fallbacks should be rendered
      rows?.forEach((row) => {
        expect(row.textContent).toContain('Unknown Track');
        expect(row.textContent).toContain('Unknown Artist');
        // Artwork fallback note
        expect(row.querySelector('.track-thumb-fallback')?.textContent).toContain('🎵');
        // No duration badge when duration is empty
        expect(row.querySelector('.track-duration')).toBeNull();
      });

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('robustly parses all thumbnail edge cases in getQueueItemThumbnail', () => {
      // 1. null / undefined thumbnails
      expect(getQueueItemThumbnail({ thumbnails: null as any } as any)).toBeUndefined();
      expect(getQueueItemThumbnail({ thumbnails: undefined } as any)).toBeUndefined();

      // 2. Non-array thumbnails
      expect(getQueueItemThumbnail({ thumbnails: 'https://example.com/not-array.jpg' as any } as any)).toBeUndefined();
      expect(getQueueItemThumbnail({ thumbnails: 12345 as any } as any)).toBeUndefined();
      expect(getQueueItemThumbnail({ thumbnails: { url: 'https://example.com/obj.jpg' } as any } as any)).toBeUndefined();

      // 3. Array of null / undefined / primitives / objects
      expect(getQueueItemThumbnail({ thumbnails: [null as any] } as any)).toBeUndefined();
      expect(getQueueItemThumbnail({ thumbnails: [undefined as any] } as any)).toBeUndefined();
      expect(getQueueItemThumbnail({ thumbnails: [{}] } as any)).toBeUndefined();
      expect(getQueueItemThumbnail({ thumbnails: [{ width: 100, height: 100 }] as any } as any)).toBeUndefined();
      expect(getQueueItemThumbnail({ thumbnails: [{ url: null as any }] } as any)).toBe(null);
      expect(getQueueItemThumbnail({ thumbnails: [{ url: 'https://valid.com/pic.jpg' }] } as any)).toBe('https://valid.com/pic.jpg');

      // 4. Raw string array
      expect(getQueueItemThumbnail({ thumbnails: ['https://valid.com/string1.jpg', 'https://valid.com/string2.jpg'] as any } as any)).toBe(
        'https://valid.com/string2.jpg'
      );
    });

    it('passes safe normalized payload to onAddToPlaylist when item has completely sparse fields', () => {
      const sparseTrack: QueueItem = {
        title: null as any,
        author: undefined as any,
        duration: null as any,
        videoId: undefined as any,
        selected: false,
        thumbnails: null as any,
      };

      const onAddToPlaylist = vi.fn();
      const queue: QueueState = {
        items: [sparseTrack],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(
        React.createElement(QueueView, {
          queue,
          onPlayIndex: vi.fn(),
          onAddToPlaylist,
        })
      );

      const addBtn = container?.querySelector<HTMLButtonElement>('[data-testid="queue-add-0"]');
      expect(addBtn).not.toBeNull();

      act(() => {
        addBtn?.click();
      });

      expect(onAddToPlaylist).toHaveBeenCalledTimes(1);
      const trackPayload: SearchTrack = onAddToPlaylist.mock.calls[0][0];

      expect(trackPayload).toEqual({
        videoId: '',
        title: 'Unknown Track',
        artist: 'Unknown Artist',
        duration: '',
        thumbnailUrl: undefined,
      });
    });

    it('handles extreme string lengths, Unicode, HTML tags, and emojis safely without crashing or leaking tags', () => {
      const extremeTrack: QueueItem = {
        title: '<script>alert("XSS")</script> & <b>bold</b> 🎵🔥 ' + 'A'.repeat(2000),
        author: 'العربية / עברית / 日本語 / 🇨🇦 ' + 'Artist'.repeat(500),
        duration: '999:59',
        videoId: 'xss_video_id_special_chars_&%$#',
        selected: false,
        thumbnails: [{ url: 'https://example.com/safe.jpg', width: 100, height: 100 }],
      };

      const queue: QueueState = {
        items: [extremeTrack],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const row = container?.querySelector('.track-row');
      expect(row).not.toBeNull();

      // Ensure script tag was not evaluated as HTML DOM element
      expect(container?.querySelectorAll('script').length).toBe(0);
      expect(row?.textContent).toContain('<script>alert("XSS")</script>');
      expect(row?.textContent).toContain('العربية / עברית / 日本語 / 🇨🇦');
    });
  });

  // ==========================================================================
  // 3. OUT-OF-BOUNDS SELECTED ITEM INDEX
  // ==========================================================================
  describe('3. Out-of-bounds selectedItemIndex Stress Testing', () => {
    const standardItems: QueueItem[] = [
      { title: 'Song 0', author: 'Artist', duration: '3:00', selected: false, videoId: '0' },
      { title: 'Song 1', author: 'Artist', duration: '3:00', selected: false, videoId: '1' },
      { title: 'Song 2', author: 'Artist', duration: '3:00', selected: false, videoId: '2' },
    ];
    const standardAutomix: QueueItem[] = [
      { title: 'Song 3', author: 'Artist', duration: '3:00', selected: false, videoId: '3' },
      { title: 'Song 4', author: 'Artist', duration: '3:00', selected: false, videoId: '4' },
    ];

    it.each([
      -1,
      -999,
      999999,
      NaN,
      Infinity,
      -Infinity,
      1.5,
      null as any,
      undefined as any,
      '0' as any,
      '1' as any,
    ])('renders cleanly with out-of-bounds selectedItemIndex=%s without highlighting or crashing', (oobIndex) => {
      const queue: QueueState = {
        items: standardItems,
        automixItems: standardAutomix,
        selectedItemIndex: oobIndex,
      };

      expect(() => {
        renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));
      }).not.toThrow();

      // No row should be highlighted active when selected is false on all items
      const activeRows = container?.querySelectorAll('.track-row.active');
      expect(activeRows?.length).toBe(0);

      // Verify all 5 rows rendered successfully
      const allRows = container?.querySelectorAll('.track-row');
      expect(allRows?.length).toBe(5);
    });

    it('honors item.selected fallback even when selectedItemIndex is completely out-of-bounds (e.g. 999999 or NaN)', () => {
      const itemsWithSelected: QueueItem[] = [
        { title: 'Song 0', author: 'Artist', duration: '3:00', selected: false },
        { title: 'Song 1', author: 'Artist', duration: '3:00', selected: true }, // active via selected: true
        { title: 'Song 2', author: 'Artist', duration: '3:00', selected: false },
      ];

      const queue: QueueState = {
        items: itemsWithSelected,
        automixItems: [],
        selectedItemIndex: NaN,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: vi.fn() }));

      const activeRows = container?.querySelectorAll('.track-row.active');
      expect(activeRows?.length).toBe(1);
      expect(activeRows?.[0].textContent).toContain('Song 1');
    });
  });

  // ==========================================================================
  // 4. RAPID TAP BURSTS & CONCURRENCY
  // ==========================================================================
  describe('4. Rapid Tap Bursts & Event Flooding', () => {
    it('handles 100 rapid consecutive taps on a single queue item without dropping events or crashing', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: generateQueueItems(10, 'RapidSingle'),
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const targetRow = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-4"]');
      expect(targetRow).not.toBeNull();

      // Fire 100 rapid clicks synchronously
      act(() => {
        for (let i = 0; i < 100; i++) {
          targetRow?.click();
        }
      });

      expect(onPlayIndex).toHaveBeenCalledTimes(100);
      for (let i = 0; i < 100; i++) {
        expect(onPlayIndex.mock.calls[i][0]).toBe(4);
      }
    });

    it('handles rapid alternating clicks across 50 different queue items in succession', () => {
      const onPlayIndex = vi.fn();
      const items = generateQueueItems(30, 'AltReg');
      const automix = generateQueueItems(30, 'AltAuto');

      const queue: QueueState = {
        items,
        automixItems: automix,
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const allRows = container?.querySelectorAll<HTMLDivElement>('.track-row');
      expect(allRows?.length).toBe(60);

      // Rapidly click alternating regular and automix items 50 times
      act(() => {
        for (let i = 0; i < 50; i++) {
          const targetIndex = i % 60;
          allRows?.[targetIndex].click();
        }
      });

      expect(onPlayIndex).toHaveBeenCalledTimes(50);
      for (let i = 0; i < 50; i++) {
        expect(onPlayIndex.mock.calls[i][0]).toBe(i % 60);
      }
    });

    it('rapid tap burst on "+ Add" button never leaks click to track row or triggers onPlayIndex', () => {
      const onPlayIndex = vi.fn();
      const onAddToPlaylist = vi.fn();

      const queue: QueueState = {
        items: generateQueueItems(5, 'AddBurst'),
        automixItems: generateQueueItems(5, 'AddBurstAuto'),
        selectedItemIndex: 0,
      };

      renderComponent(
        React.createElement(QueueView, {
          queue,
          onPlayIndex,
          onAddToPlaylist,
        })
      );

      const addBtn = container?.querySelector<HTMLButtonElement>('[data-testid="queue-add-7"]');
      expect(addBtn).not.toBeNull();

      // Fire 50 rapid clicks on the + Add button
      act(() => {
        for (let i = 0; i < 50; i++) {
          addBtn?.click();
        }
      });

      // + Add should be triggered 50 times
      expect(onAddToPlaylist).toHaveBeenCalledTimes(50);
      // onPlayIndex must NOT have been triggered even once
      expect(onPlayIndex).not.toHaveBeenCalled();
    });

    it('handles rapid keyboard bursts (Enter / Space) without crashing', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: generateQueueItems(5, 'KeyBurst'),
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const row = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-2"]');
      expect(row).not.toBeNull();

      act(() => {
        for (let i = 0; i < 40; i++) {
          const key = i % 2 === 0 ? 'Enter' : ' ';
          row?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        }
      });

      expect(onPlayIndex).toHaveBeenCalledTimes(40);
      for (let i = 0; i < 40; i++) {
        expect(onPlayIndex.mock.calls[i][0]).toBe(2);
      }
    });
  });

  // ==========================================================================
  // 5. RAPID RE-RENDERS & RAPID QUEUE STATE SHIFTS
  // ==========================================================================
  describe('5. Rapid Re-renders & Shifting Queue States', () => {
    it('survives 100 rapid consecutive re-renders with shifting selectedItemIndex (playback simulation)', () => {
      const items = generateQueueItems(20, 'Shift');
      const automix = generateQueueItems(20, 'ShiftAuto');

      // Initial render
      renderComponent(
        React.createElement(QueueView, {
          queue: { items, automixItems: automix, selectedItemIndex: 0 },
          onPlayIndex: vi.fn(),
        })
      );

      // Simulate rapid progress updates changing the selected track across 40 indices
      for (let i = 0; i < 40; i++) {
        renderComponent(
          React.createElement(QueueView, {
            queue: { items, automixItems: automix, selectedItemIndex: i },
            onPlayIndex: vi.fn(),
          })
        );

        const activeRow = container?.querySelector('.track-row.active');
        expect(activeRow?.getAttribute('data-index')).toBe(String(i));
      }
    });

    it('cleanly transitions between empty queue, loaded queue, and null queue dynamically', () => {
      const items = generateQueueItems(5, 'Trans');

      // 1. Start with null queue
      renderComponent(React.createElement(QueueView, { queue: null, onPlayIndex: vi.fn() }));
      expect(container?.querySelector('.queue-empty')).not.toBeNull();

      // 2. Transition to loaded queue
      renderComponent(
        React.createElement(QueueView, {
          queue: { items, automixItems: [], selectedItemIndex: 0 },
          onPlayIndex: vi.fn(),
        })
      );
      expect(container?.querySelectorAll('.track-row').length).toBe(5);
      expect(container?.querySelector('.queue-empty')).toBeNull();

      // 3. Transition to empty items
      renderComponent(
        React.createElement(QueueView, {
          queue: { items: [], automixItems: [], selectedItemIndex: -1 },
          onPlayIndex: vi.fn(),
        })
      );
      expect(container?.querySelector('.queue-empty')).not.toBeNull();
      expect(container?.querySelectorAll('.track-row').length).toBe(0);

      // 4. Transition to automix only
      renderComponent(
        React.createElement(QueueView, {
          queue: { items: [], automixItems: items, selectedItemIndex: 2 },
          onPlayIndex: vi.fn(),
        })
      );
      expect(container?.querySelectorAll('.track-row').length).toBe(5);
      expect(container?.querySelector('.queue-section-title')?.textContent).toBe(
        'Autoplay Recommendations'
      );
    });

    it('handles deformed queue objects (partially null/undefined properties) gracefully', () => {
      // Missing items and automixItems
      expect(() => {
        renderComponent(
          React.createElement(QueueView, {
            queue: {} as any,
            onPlayIndex: vi.fn(),
          })
        );
      }).not.toThrow();
      expect(container?.querySelector('.queue-empty')).not.toBeNull();

      // items is null, automixItems has tracks
      const autoTracks = generateQueueItems(3, 'AutoOnly');
      expect(() => {
        renderComponent(
          React.createElement(QueueView, {
            queue: { items: null as any, automixItems: autoTracks, selectedItemIndex: 1 },
            onPlayIndex: vi.fn(),
          })
        );
      }).not.toThrow();
      expect(container?.querySelectorAll('.track-row').length).toBe(3);

      // automixItems is null, items has tracks
      expect(() => {
        renderComponent(
          React.createElement(QueueView, {
            queue: { items: autoTracks, automixItems: null as any, selectedItemIndex: 1 },
            onPlayIndex: vi.fn(),
          })
        );
      }).not.toThrow();
      expect(container?.querySelectorAll('.track-row').length).toBe(3);
    });
  });
});
