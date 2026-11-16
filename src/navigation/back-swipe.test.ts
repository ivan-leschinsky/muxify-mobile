import { BACK_EDGE, backSwipeOptions, startsAtBackEdge } from './back-swipe';

describe('startsAtBackEdge', () => {
  it('gives a drag right from the band to back', () => {
    expect(startsAtBackEdge(0, 12)).toBe(true);
    expect(startsAtBackEdge(BACK_EDGE - 1, 12)).toBe(true);
  });

  it('keeps a drag right from outside the band, and any drag left', () => {
    expect(startsAtBackEdge(BACK_EDGE, 12)).toBe(false);
    expect(startsAtBackEdge(200, 12)).toBe(false);
    expect(startsAtBackEdge(4, -12)).toBe(false);
  });
});

describe('backSwipeOptions', () => {
  it('goes back from anywhere by default', () => {
    expect(backSwipeOptions('anywhere', true)).toMatchObject({
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
      gestureResponseDistance: { end: -1 },
    });
  });

  it('goes back only near the band on a screen with its own sideways move', () => {
    const { gestureEnabled, gestureResponseDistance } = backSwipeOptions('edge', true);
    expect(gestureEnabled).toBe(true);
    expect(gestureResponseDistance.start).toBe(-1);
    expect(gestureResponseDistance.end).toBeGreaterThan(BACK_EDGE);
    expect(gestureResponseDistance.end).toBeLessThan(2 * BACK_EDGE);
  });

  it('keeps the back swipe at the edge before iOS 26', () => {
    expect(backSwipeOptions('anywhere', false).fullScreenGestureEnabled).toBe(false);
  });

  it('does not go back at all when off', () => {
    expect(backSwipeOptions('off', true).gestureEnabled).toBe(false);
  });
});
