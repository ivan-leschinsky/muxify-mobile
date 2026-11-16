import type { PlaceTab } from '@/storage/records';

/**
 * The Web View of the Tab a Topic Place has on top, at the page and offset
 * where it was left. A screen that opens a Topic pushes it together with the
 * Terminal Screen, so the user sees one move to the page. The Web View then
 * checks that the Host still lists the Tab.
 */
export function placeTabRoute(tab: PlaceTab) {
  return {
    pathname: '/web-view',
    params: { url: tab.url, page: tab.page, scrollY: String(tab.scrollY), restored: '1' },
  } as const;
}
