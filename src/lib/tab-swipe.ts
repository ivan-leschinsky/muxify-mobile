/**
 * The swipe between a screen's tabs, such as Topics and Sessions on the Host
 * Screen. It has the Pane Swipe's numbers, so the app has one sideways
 * gesture: see pan-axis.ts.
 */

import { followOffset, type SwipeDirection } from './pan-axis';

/** How much of the finger's travel the list follows when there is no tab that way. */
const RUBBER_BAND = 0.25;

/** The tab a swipe goes to: a swipe left shows the tab on the right. */
export function neighbourTab<T>(tabs: readonly T[], tab: T, direction: SwipeDirection): T | null {
  const index = tabs.indexOf(tab) + (direction === 'left' ? 1 : -1);
  return index >= 0 && index < tabs.length ? tabs[index]! : null;
}

/**
 * How far the list is from its place while the finger is `dx` from where the
 * drag began. Toward a tab, as the Pane follows a Pane Swipe. Toward no tab,
 * only a little, and it springs back.
 */
export function tabSwipeOffset(dx: number, width: number, towardTab: boolean): number {
  return towardTab ? followOffset(dx, width) : dx * RUBBER_BAND;
}
