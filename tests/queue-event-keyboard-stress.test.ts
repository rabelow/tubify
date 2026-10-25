/**
 * Empirical Stress Test Suite for QueueView: Event Propagation, Keyboard & Boundary Transitions
 * 
 * Target: src/components/QueueView.tsx
 * Challenger: m3_challenger_2
 * Focus:
 * 1. Event Propagation Isolation: Rapid "+ Add" button clicks (50+ bursts) never trigger onPlayIndex
 * 2. Keyboard Interaction: Enter & Space trigger onPlayIndex on row, while Tab, Arrows, Escape do not
 * 3. Boundary Transitions: items[N-1] triggers onPlayIndex(N-1), automixItems[0] triggers onPlayIndex(N)
 * 4. Active Highlight Boundary Switching: Clean transition from N-1 to N with zero stale highlights
 * 5. Nested Control Keyboard Bubbling & Accessibility Challenge
 */

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueueView, getQueueItemThumbnail } from '../src/components/QueueView';
import type { QueueItem, QueueState, SearchTrack } from '../src/types/companion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function createDummyItem(id: string, title?: string, author?: string): QueueItem {
  return {
    videoId: id,
    title: title ?? `Track ${id}`,
    author: author ?? `Artist ${id}`,
    duration: '3:30',
    selected: false,
    thumbnails: [
      { url: `https://example.com/${id}-sm.jpg`, width: 60, height: 60 },
      { url: `https://example.com/${id}-lg.jpg`, width: 300, height: 300 },
    ],
  };
}

describe('QueueView Event Propagation, Keyboard & Boundary Stress Suite', () => {
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

  // ==========================================================================
  // Section 1: Event Propagation Isolation (+ Add button click bursts)
  // ==========================================================================
  describe('1. Event Propagation Isolation (+ Add button bursts)', () => {
    it('clicking "+ Add" button 50 times in rapid succession never triggers onPlayIndex', () => {
      const onPlayIndex = vi.fn();
      const onAddToPlaylist = vi.fn();

      const items = [
        createDummyItem('track-1', 'Get Lucky', 'Daft Punk'),
        createDummyItem('track-2', 'Starboy', 'The Weeknd'),
      ];

      const queue: QueueState = {
        items,
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

      // Stress click 50 times in rapid succession
      for (let i = 0; i < 50; i++) {
        act(() => {
          addBtn0?.click();
        });
      }

      // onAddToPlaylist must have received exactly 50 calls
      expect(onAddToPlaylist).toHaveBeenCalledTimes(50);
      // onPlayIndex MUST NEVER have been called
      expect(onPlayIndex).not.toHaveBeenCalled();
    });

    it('clicking "+ Add" on automix items 50 times in rapid succession never triggers onPlayIndex', () => {
      const onPlayIndex = vi.fn();
      const onAddToPlaylist = vi.fn();

      const queue: QueueState = {
        items: [createDummyItem('regular-0')],
        automixItems: [createDummyItem('auto-0'), createDummyItem('auto-1')],
        selectedItemIndex: 0,
      };

      renderComponent(
        React.createElement(QueueView, {
          queue,
          onPlayIndex,
          onAddToPlaylist,
        })
      );

      // Continuous index for auto-0 is 1, for auto-1 is 2
      const addBtnAuto1 = container?.querySelector<HTMLButtonElement>(
        '[data-testid="queue-add-2"]'
      );
      expect(addBtnAuto1).not.toBeNull();

      for (let i = 0; i < 50; i++) {
        act(() => {
          addBtnAuto1?.click();
        });
      }

      expect(onAddToPlaylist).toHaveBeenCalledTimes(50);
      expect(onPlayIndex).not.toHaveBeenCalled();
    });

    it('clicking "+ Add" button 100 times across 10 different queue rows never leaks onPlayIndex', () => {
      const onPlayIndex = vi.fn();
      const onAddToPlaylist = vi.fn();

      const items = Array.from({ length: 10 }, (_, i) => createDummyItem(`track-${i}`));
      const queue: QueueState = {
        items,
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex, onAddToPlaylist }));

      // Click "+ Add" on each row 10 times = 100 total clicks
      for (let rowIdx = 0; rowIdx < 10; rowIdx++) {
        const btn = container?.querySelector<HTMLButtonElement>(`[data-testid="queue-add-${rowIdx}"]`);
        expect(btn).not.toBeNull();
        for (let burst = 0; burst < 10; burst++) {
          act(() => {
            btn?.click();
          });
        }
      }

      expect(onAddToPlaylist).toHaveBeenCalledTimes(100);
      expect(onPlayIndex).not.toHaveBeenCalled();
    });

    it('rapid alternating between row click and "+ Add" button click isolates callbacks accurately', () => {
      const onPlayIndex = vi.fn();
      const onAddToPlaylist = vi.fn();

      const queue: QueueState = {
        items: [createDummyItem('track-0')],
        automixItems: [],
        selectedItemIndex: -1,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex, onAddToPlaylist }));

      const row = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-0"]');
      const addBtn = container?.querySelector<HTMLButtonElement>('[data-testid="queue-add-0"]');

      expect(row).not.toBeNull();
      expect(addBtn).not.toBeNull();

      // Alternate 25 cycles (25 row clicks, 25 add clicks = 50 actions)
      for (let i = 0; i < 25; i++) {
        act(() => {
          row?.click();
        });
        act(() => {
          addBtn?.click();
        });
      }

      expect(onPlayIndex).toHaveBeenCalledTimes(25);
      expect(onAddToPlaylist).toHaveBeenCalledTimes(25);
    });

    it('clicking "+ Add" button when onAddToPlaylist is undefined does not throw and never triggers onPlayIndex', () => {
      const onPlayIndex = vi.fn();

      const queue: QueueState = {
        items: [createDummyItem('track-0')],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(
        React.createElement(QueueView, {
          queue,
          onPlayIndex,
          onAddToPlaylist: undefined,
        })
      );

      const addBtn = container?.querySelector<HTMLButtonElement>('[data-testid="queue-add-0"]');
      expect(addBtn).not.toBeNull();

      for (let i = 0; i < 50; i++) {
        expect(() => {
          act(() => {
            addBtn?.click();
          });
        }).not.toThrow();
      }

      expect(onPlayIndex).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Section 2: Keyboard Interaction & Key Filtering Matrix
  // ==========================================================================
  describe('2. Keyboard Interaction & Key Filtering Matrix', () => {
    it('Enter keydown on row triggers onPlayIndex with correct continuousIndex', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: [createDummyItem('track-0'), createDummyItem('track-1')],
        automixItems: [createDummyItem('auto-0')],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const row1 = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-1"]');
      expect(row1).not.toBeNull();

      act(() => {
        row1?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });

      expect(onPlayIndex).toHaveBeenCalledTimes(1);
      expect(onPlayIndex).toHaveBeenCalledWith(1);
    });

    it('Space keydown on row triggers onPlayIndex with correct continuousIndex', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: [createDummyItem('track-0'), createDummyItem('track-1')],
        automixItems: [createDummyItem('auto-0')],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const rowAuto = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-2"]');
      expect(rowAuto).not.toBeNull();

      act(() => {
        rowAuto?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      });

      expect(onPlayIndex).toHaveBeenCalledTimes(1);
      expect(onPlayIndex).toHaveBeenCalledWith(2);
    });

    it('navigation and control keys (Tab, Arrows, Escape, etc.) strictly do NOT trigger onPlayIndex', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: [createDummyItem('track-0')],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const row = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-0"]');
      expect(row).not.toBeNull();

      const nonActivatingKeys = [
        'Tab',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Escape',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'Shift',
        'Control',
        'Alt',
        'Meta',
        'Backspace',
        'Delete',
        'F1',
        'F5',
        'F12',
        'a',
        'z',
        '0',
        '9',
      ];

      for (const key of nonActivatingKeys) {
        act(() => {
          row?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        });
      }

      expect(onPlayIndex).not.toHaveBeenCalled();
    });

    it('rapid burst of 50 Enter/Space keydown events triggers onPlayIndex 50 times without error', () => {
      const onPlayIndex = vi.fn();
      const queue: QueueState = {
        items: [createDummyItem('track-0')],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const row = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-0"]');
      expect(row).not.toBeNull();

      for (let i = 0; i < 50; i++) {
        const key = i % 2 === 0 ? 'Enter' : ' ';
        act(() => {
          row?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        });
      }

      expect(onPlayIndex).toHaveBeenCalledTimes(50);
    });

    it('keyboard navigation: handles asynchronous onPlayIndex rejection gracefully', async () => {
      const rejectingPlay = vi.fn().mockRejectedValue(new Error('Network disconnected'));
      const queue: QueueState = {
        items: [createDummyItem('track-0')],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex: rejectingPlay }));

      const row = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-0"]');

      expect(() => {
        act(() => {
          row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
      }).not.toThrow();

      expect(rejectingPlay).toHaveBeenCalledWith(0);
    });
  });

  // ==========================================================================
  // Section 3: Boundary Transitions (items[N-1] -> N-1 vs automix[0] -> N)
  // ==========================================================================
  describe('3. Boundary Transitions (N-1 vs N)', () => {
    it('clicking last item in items triggers onPlayIndex(N-1), and first item in automix triggers onPlayIndex(N)', () => {
      const onPlayIndex = vi.fn();
      const N = 5; // items: 0..4 (last is 4)
      const M = 4; // automix: continuous 5..8 (first is 5)

      const items = Array.from({ length: N }, (_, i) =>
        createDummyItem(`item-${i}`, `Regular Track ${i}`)
      );
      const automixItems = Array.from({ length: M }, (_, i) =>
        createDummyItem(`automix-${i}`, `Automix Track ${i}`)
      );

      const queue: QueueState = {
        items,
        automixItems,
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      // Last item in `items` is at index N-1 = 4
      const lastItemInItems = container?.querySelector<HTMLDivElement>(
        `[data-testid="queue-item-${N - 1}"]`
      );
      expect(lastItemInItems).not.toBeNull();

      act(() => {
        lastItemInItems?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(N - 1); // 4

      // First item in `automixItems` is at continuous index N = 5
      const firstItemInAutomix = container?.querySelector<HTMLDivElement>(
        `[data-testid="queue-item-${N}"]`
      );
      expect(firstItemInAutomix).not.toBeNull();

      act(() => {
        firstItemInAutomix?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(N); // 5

      // Step difference across the boundary boundary must be strictly 1
      const call1 = onPlayIndex.mock.calls[0][0];
      const call2 = onPlayIndex.mock.calls[1][0];
      expect(call2 - call1).toBe(1);
    });

    it('verifies boundary transition when N = 1 (single queue item with automix immediately following)', () => {
      const onPlayIndex = vi.fn();
      const N = 1;
      const items = [createDummyItem('single-track')];
      const automixItems = [createDummyItem('auto-first'), createDummyItem('auto-second')];

      const queue: QueueState = {
        items,
        automixItems,
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      // Last item in items is index N-1 = 0
      const lastItem = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-0"]');
      act(() => {
        lastItem?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(0);

      // First item in automix is continuous index N = 1
      const firstAutomix = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-1"]');
      act(() => {
        firstAutomix?.click();
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(1);
    });

    it('verifies boundary transition keyboard activation (Enter on N-1, Space on N)', () => {
      const onPlayIndex = vi.fn();
      const N = 3;
      const items = Array.from({ length: N }, (_, i) => createDummyItem(`item-${i}`));
      const automixItems = [createDummyItem('auto-0'), createDummyItem('auto-1')];

      const queue: QueueState = {
        items,
        automixItems,
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const rowLastItem = container?.querySelector<HTMLDivElement>(`[data-testid="queue-item-${N - 1}"]`);
      const rowFirstAutomix = container?.querySelector<HTMLDivElement>(`[data-testid="queue-item-${N}"]`);

      act(() => {
        rowLastItem?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(N - 1); // 2

      act(() => {
        rowFirstAutomix?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      });
      expect(onPlayIndex).toHaveBeenLastCalledWith(N); // 3
    });

    it('active state highlight transitions cleanly across the boundary (N-1 vs N)', () => {
      const N = 3;
      const items = Array.from({ length: N }, (_, i) => createDummyItem(`item-${i}`));
      const automixItems = [createDummyItem('auto-0'), createDummyItem('auto-1')];

      // State 1: selectedItemIndex is N-1 (last item in items)
      const queueAtLastItem: QueueState = {
        items,
        automixItems,
        selectedItemIndex: N - 1, // 2
      };

      renderComponent(React.createElement(QueueView, { queue: queueAtLastItem, onPlayIndex: vi.fn() }));

      const row2 = container?.querySelector('[data-testid="queue-item-2"]');
      const row3 = container?.querySelector('[data-testid="queue-item-3"]');

      expect(row2?.classList.contains('active')).toBe(true);
      expect(row3?.classList.contains('active')).toBe(false);
      expect(row2?.querySelector('.playing-indicator')).not.toBeNull();
      expect(row3?.querySelector('.playing-indicator')).toBeNull();

      // State 2: selectedItemIndex transitions to N (first automix item)
      const queueAtFirstAutomix: QueueState = {
        items,
        automixItems,
        selectedItemIndex: N, // 3
      };

      renderComponent(React.createElement(QueueView, { queue: queueAtFirstAutomix, onPlayIndex: vi.fn() }));

      const updatedRow2 = container?.querySelector('[data-testid="queue-item-2"]');
      const updatedRow3 = container?.querySelector('[data-testid="queue-item-3"]');

      expect(updatedRow2?.classList.contains('active')).toBe(false);
      expect(updatedRow3?.classList.contains('active')).toBe(true);
      expect(updatedRow2?.querySelector('.playing-indicator')).toBeNull();
      expect(updatedRow3?.querySelector('.playing-indicator')).not.toBeNull();
    });

    it('handles empty items array with present automixItems (N = 0, first automix continuous index is 0)', () => {
      const onPlayIndex = vi.fn();
      const automixItems = [createDummyItem('auto-0'), createDummyItem('auto-1')];

      const queue: QueueState = {
        items: [],
        automixItems,
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      const row0 = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-0"]');
      expect(row0).not.toBeNull();
      expect(row0?.classList.contains('active')).toBe(true);

      act(() => {
        row0?.click();
      });
      expect(onPlayIndex).toHaveBeenCalledWith(0);
    });

    it('handles queue with items present and empty automixItems (M = 0)', () => {
      const onPlayIndex = vi.fn();
      const items = [createDummyItem('track-0'), createDummyItem('track-1')];

      const queue: QueueState = {
        items,
        automixItems: [],
        selectedItemIndex: 1,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex }));

      expect(container?.textContent).toContain('Up Next');
      expect(container?.textContent).not.toContain('Autoplay Recommendations');

      const row1 = container?.querySelector<HTMLDivElement>('[data-testid="queue-item-1"]');
      expect(row1?.classList.contains('active')).toBe(true);

      act(() => {
        row1?.click();
      });
      expect(onPlayIndex).toHaveBeenCalledWith(1);
    });
  });

  // ==========================================================================
  // Section 4: Adversarial Keyboard Event Bubbling & Accessibility Challenge
  // ==========================================================================
  describe('4. Adversarial Keyboard Event Bubbling & Accessibility Challenge', () => {
    it('ADVERSARIAL FINDING: keydown (Enter/Space) on nested "+ Add" button bubbles to row and unintentionally triggers onPlayIndex', () => {
      const onPlayIndex = vi.fn();
      const onAddToPlaylist = vi.fn();

      const queue: QueueState = {
        items: [createDummyItem('track-0')],
        automixItems: [],
        selectedItemIndex: 0,
      };

      renderComponent(React.createElement(QueueView, { queue, onPlayIndex, onAddToPlaylist }));

      const addBtn = container?.querySelector<HTMLButtonElement>('[data-testid="queue-add-0"]');
      expect(addBtn).not.toBeNull();

      // In HTML / DOM, when a user navigates to the "+ Add" button with keyboard (Tab)
      // and presses Enter or Space:
      // The browser dispatches a KeyboardEvent on the button element with bubbles: true.
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      act(() => {
        addBtn?.dispatchEvent(enterEvent);
      });

      // EMPIRICAL OBSERVATION:
      // Because QueueTrackRow does not check (e.target !== e.currentTarget) and
      // the "+ Add" button does not stop keydown propagation, the keydown event
      // bubbles up to QueueTrackRow's handleKeyDown listener.
      // QueueTrackRow intercepts Enter and triggers onPlay(0)!
      const enterLeakedToPlay = onPlayIndex.mock.calls.length > 0;

      const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      act(() => {
        addBtn?.dispatchEvent(spaceEvent);
      });

      const spaceLeakedToPlay = onPlayIndex.mock.calls.length > (enterLeakedToPlay ? 1 : 0);

      // Verify whether the event bubbling flaw is present:
      expect(enterLeakedToPlay).toBe(true);
      expect(spaceLeakedToPlay).toBe(true);
      // Furthermore, space keydown event had preventDefault called on it:
      expect(spaceEvent.defaultPrevented).toBe(true);
    });
  });
});
