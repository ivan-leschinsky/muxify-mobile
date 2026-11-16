import { neighbourTab, tabSwipeOffset } from './tab-swipe';

const TABS = ['topics', 'sessions'] as const;

describe('neighbourTab', () => {
  it('shows the tab on the right for a swipe left, and on the left for a swipe right', () => {
    expect(neighbourTab(TABS, 'topics', 'left')).toBe('sessions');
    expect(neighbourTab(TABS, 'sessions', 'right')).toBe('topics');
  });

  it('has no tab past either end', () => {
    expect(neighbourTab(TABS, 'topics', 'right')).toBeNull();
    expect(neighbourTab(TABS, 'sessions', 'left')).toBeNull();
    expect(neighbourTab(['sessions'], 'sessions', 'left')).toBeNull();
  });
});

describe('tabSwipeOffset', () => {
  it('follows the finger toward a tab', () => {
    expect(tabSwipeOffset(-50, 400, true)).toBe(-50);
  });

  it('moves much less than the finger toward no tab', () => {
    const offset = tabSwipeOffset(80, 400, false);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(40);
  });
});
