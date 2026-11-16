# Reopen a Topic where you left it (Option A)

Status: ready-for-agent

Goal (Gleb): when he goes back to a Topic on the phone, he arrives where he
was in it, a Browser Tab included. From a Browser Tab he can reach the Topics
list without walking back through the Terminal Screen.

Design page, with the facts and the options: the Lavish page
`reopen-topic-place.html` (Option A was picked). Decisions:

- Option A. The Web View stays a screen of its own. It gets the Terminal
  Header's title and the same Title Sheet.
- The Topic Place lives on the phone only. No Host CLI change, no desktop change.
- A Tab that the Host lists no more: go to the Window's active Pane.
- Glossary: add **Topic Place**, change **Last Place**, **Web View**, **Header**.

## Language

**Topic Place** (new): where the user was in one Topic on this phone: its
Session, Window, Pane and, if the Web View was on top, the Browser Tab and how
far the page was scrolled. The phone keeps one for each Topic of each Host. It
is the phone's own: the Mac moving tmux's active Window does not move it.
_Avoid_: last place (for one Topic), position, bookmark.

**Last Place** (changed): unchanged fields. Its Topic, when it has one, opens
at that Topic's Topic Place, so a cold start can open the Web View again.

## Data shape

In `src/storage/records.ts`:

```ts
export interface TopicPlace {
  hostId: string;
  topicId: string;
  /** Session name. The Attach targets Sessions by name. */
  session: string;
  /** tmux's id (`@12`) first; index and name find it again after Reopen gives new ids. */
  window: { id: string; index: number; name: string } | null;
  /** tmux's Pane id (`%31`). */
  pane: string | null;
  /** Set while the Web View is on top. */
  tab: { url: string; page: string; scrollY: number } | null;
  /** ISO 8601. */
  at: string;
}
Records.topicPlaces: TopicPlace[]   // one per (hostId, topicId)
```

- `tab.url` is the Host Tab's URL. It is what "is the Tab still there" compares.
  `tab.page` is the URL the Web View showed last, which can differ after a link
  was followed. A restore loads `page` and scrolls to `scrollY` when the loaded
  URL is still `page`.
- Parse at the boundary like `parseLastPlace`: a bad entry is dropped, not fatal.
- Deleting a Host removes its Topic Places (as `recentSessions` in `store.ts`).
- Disconnect does **not** clear Topic Places. Disconnect means "do not take me
  back on a cold start", and that is the Last Place's job only.
- Store API: `topicPlaceFor(hostId, topicId)`, `rememberTopicPlace(place)`.

## One writer: the Attach

The Attach (app-level, ADR 0007) is the only writer, through its existing
serialized `arrivalWrites` chain, so two writes never interleave a
load-then-save of the records file.

- While the Attach is connected and has a Topic, it writes the Topic Place when
  any of these changes: Session, active Window, active Pane, shown Tab.
- New Attach verbs: `showTab(tab: { url; page; scrollY })` returns a token, and
  `leaveTab(token)` clears the Tab. `updateTab(token, { page, scrollY })` keeps
  it current. A stale token (another Tab was shown since, or the Topic changed)
  is a no-op. This is what keeps a Topic switch from wiping the Tab of the Topic
  that the user is leaving: the Web View is dismissed after the switch, and its
  `leaveTab` is then stale.
- A change of Topic resets the shown Tab without a write for the old Topic.

## Restore

When a Topic is **opened** (a Topic card on the Host Screen, the Title Sheet's
Topics list, a cold start with a Last Place Topic, the wake path after Reopen):

1. **Session.** `chooseTopicSession` prefers the Topic Place's Session when the
   Topic lists it live. Otherwise today's rule (most recently opened).
2. **Window.** After the Attach is in the Session: the Topic Place Window by id;
   else by index and name; else leave tmux's active Window.
3. **Pane.** The Topic Place Pane when it is in that Window; else tmux's.
   Keep the Zoom rule (CONTEXT.md "Zoom"): pick it the way the Panes picker does.
4. **Tab.** When the Topic Place has a Tab, the Terminal Screen reads the
   Window's Tabs (`readBrowserTabs`).
   - Listed, and a Tab has `tab.url`: push the Web View with `page` and `scrollY`.
   - Listed, and no Tab has it: stay on the Pane and clear the Tab from the
     Topic Place. Log it.
   - Read failed (no desktop app, remote Host, old CLI): push the Web View
     anyway. The phone loads the URL by itself. Log it.

Not a restore: a Window, Session or Tab pick in the Title Sheet, a Pane Swipe,
the Panes picker. Those are moves inside the Topic, and they only write.

Window and Pane selection belong in the Attach (it holds the client). The Tab
step belongs in the Terminal Screen (it owns the router and the Tabs read). The
Attach carries "restore this Tab" in its state for the screen to act on once,
like other one-shot requests in this codebase. Pick the existing idiom.

## The Web View gets the Header and the Title Sheet

- Its title is the Terminal Header's title for the Topic: the Topic title, over
  one dim line `🌐 <page title> · <Session>`. Without a Topic: the Session name
  over the page title. A tap, or the down chevron, opens the Title Sheet.
  Reload stays on the right. Back stays on the left and goes to the Terminal
  Screen (that is a choice of the Pane, so it clears the Tab).
- **One Title Sheet, not two copies.** Move the chooser state and its handlers
  out of `src/app/terminal.tsx` (the `titleSheet` state, `chooserRevision`,
  `openTitleSheet`, `closeChooser`, `choose`, `selectSession`, `openTopic`,
  `openTab`, the Tabs read, `titleRows`, `sessionCards`, `useChooserLists`,
  `useHostReading`, `useHostEntry` wiring) into one hook that both screens use,
  with `<TitleSheet>` rendered by each screen. The Terminal Screen keeps its
  behaviour exactly. Its e2e (`e2e/header.sh`, `e2e/pickers.sh`,
  `e2e/browser-tabs.sh`, `e2e/topic-screen.sh`) must still pass.
- Picks from the Web View's Title Sheet:
  - Window or Session: do it, then dismiss to the Terminal Screen.
  - Another Tab: show it in this Web View (replace the URL; new `showTab`).
  - Topic: open it the usual way, then dismiss to the Terminal Screen. The old
    Topic keeps its Tab (stale `leaveTab`, above). If the new Topic's Place has
    a Tab, the restore pushes a fresh Web View.
- The Topics list then is one tap on the title plus one on the Topics list, from
  the page. That is the problem Gleb reported.

## Docs to change

- `CONTEXT.md`: add **Topic Place** (Topics section); change **Last Place**,
  **Header** (the Web View has it too), **Web View** (title, Title Sheet, Back
  clears the Tab), **Title Sheet** (also on the Web View).
- New ADR `docs/adr/0020-the-topic-place-is-the-phones.md`: the Topic Place
  lives on the phone, not in tmux and not in the Topic record. Why: tmux's
  active Window is shared with the Mac and every Client; the Mac keeps its last
  Window only in memory; a shared Place needs a new Host CLI and a desktop
  release. Considered and rejected: a tmux Session option, the Topic record.

## Tests

- Unit: records parse (bad entries dropped), store round trip, Host delete
  removes places, `chooseTopicSession` prefers the place, the stale-token rule,
  the restore decision for the three Tab read outcomes, Window fallback by index
  and name. Test through the paths callers use; no widened exports for tests.
- e2e: extend `e2e/browser-tabs.sh` (or a new `e2e/topic-place.sh` run through
  `e2e/sandbox.sh`): open a Topic, open a Tab, go Home, open the Topic again →
  the Web View is on top with that page. From the Web View, the title opens the
  Title Sheet and its Topics list. A Tab removed from the fixture → the Pane.
  Never touch the user's tmux server or Muxify.app (AGENTS.md).

## Out of scope

Option B/C/D, Tabs in `topic show --json`, a Place shared with the Mac.

## Revision 2 (2026-11-16): Back keeps the page

Gleb expected Back on a page to go to the Topics list, and the Topic to open on
the page again. Changed:

- In a Topic, Back and the swipe from the edge on the Web View go to the Host
  Screen and keep the Tab in the Topic Place. Without a Topic, Back goes to the
  Session as before, because nothing would keep the page.
- A restore runs also for the Topic that the Attach still holds. Before, it ran
  only for a different Topic, so the Host Screen's card of the same Topic
  showed the terminal.
- A pick of the current Topic in the Title Sheet only closes the sheet.
- The way from a page to its terminal is the Title Sheet's Window pick, which
  clears the Tab.

## Revision 3 (2026-11-16): one move each way

Gleb saw two moves when a Topic opened on its page: the terminal slid in,
then the page. Changed:

- The screen that opens a Topic gets the Topic Place's Tab from the opener
  (`useHostEntry`'s `onAttached(tab)`) and pushes the Web View alone. When
  its slide ends, the Web View puts the Terminal Screen under itself with a
  reset that keeps the top, so nothing moves. Two pushes, or one reset that
  adds both, slid in the terminal first.
- The Web View, not the Terminal Screen, takes `tabToRestore` and checks that
  the Host still lists the Tab. `showTab` no longer clears it.
- A Topic picked in the Web View's Title Sheet whose Place has a Tab replaces
  the page with that one.
- The swipe from the edge is off on a page in a Topic.
- A cold start still pushes the Terminal Screen, then the page once the
  Attach is up.

## Revision 4 (2026-11-16): the swipe back

Gleb wanted the swipe from the edge back. A page over the Terminal Screen
shows the terminal under it while the swipe moves. Changed:

- In a Topic, the Web View takes the Terminal Screen's place
  (`router.replace`), right over the Host Screen. Back and the swipe are the
  stack's own pop, and the Topic keeps the Tab. The Title Sheet's Window pick,
  or a Tab the Host lists no more, replaces the Web View with the Terminal
  Screen. No `usePreventRemove`, no terminal slipped under the page.
- A Session's page (no Topic) still goes over its Terminal Screen.
