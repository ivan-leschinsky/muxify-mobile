# The left edge always goes back

The Terminal Screen had no reliable Back Swipe. Its full-screen back swipe was
off, because a swipe right is the previous Pane (5cae908). Only UIKit's strict
edge pop was left. It raced the Surface's one-finger pan, which takes a drag
right from any point, also from x = 0. In the e2e suite, a drag from x = 2 did
not leave the Terminal Screen. Every other screen went back from anywhere, as
iOS 26 does. On the Host Screen, only a tap changed between Topics and
Sessions.

## Decision

One rule for the app: the left edge always goes back. Inside the content, a
sideways drag moves inside the screen when the screen has something to move
between. On other screens it goes back too.

- **The edge band** is 24 points at the left edge, `BACK_EDGE` in
  `src/navigation/back-swipe.ts`. It is the one number for every layer.
- **Three modes.** A screen picks `'anywhere'`, `'edge'` or `'off'` with
  `useBackSwipe`. `'anywhere'` is the default in the layout. The Terminal
  Screen is `'edge'`, and `'off'` while a Selection is open, because a handle
  can be at column 1. The Host Screen is `'edge'` while it shows two tabs and
  the tab swipe is live, and `'anywhere'` otherwise.
- **`'edge'`** keeps the iOS 26 content pop on, and limits where it begins
  with `gestureResponseDistance`. The stack measures where the finger is when
  the pop begins, after some travel, so the limit is the band plus that
  travel.
- **Each layer with its own sideways drag yields in the band.** A drag right
  that landed in the band is not the layer's. The Surface's pan says no to it
  (`backEdge`, a prop of the patched libghostty view). The Mouse Layer and the
  inactive Pane cover use `startsAtBackEdge`. The Host Screen's tab swipe (the
  local `TabSwipe` module) says no to it. The two pans never compete.
- **The Host Screen's tab swipe** starts only outside every row, so a Topic
  card keeps its swipe action. It has the Pane Swipe's numbers and tick, and
  the segmented control changes at the commit point.

## Considered

- **The Surface's pan waits for the system's edge pop.** A smaller patch, but
  the band is UIKit's narrow one, which the app cannot tune, and the Host
  Screen would need a different method. The app would then have two rules.
- **Full-screen back on the Terminal Screen, and the Pane Swipe on two
  fingers.** It breaks the Pane Swipe that the suites and the user's hands
  know, and two fingers is the iPad trackpad's gesture.
- **A pager over the whole Host Screen list, rows included.** A swipe left on
  a Topic card would mean two things, and a SwiftUI pager and swipe actions in
  one list are known to fight.

## Consequences

A new layer with a sideways drag on an `'edge'` screen must yield in the band
with `startsAtBackEdge`, or the two gestures race again. `e2e/back-swipe.sh`
drags from x = 2 on the Terminal Screen, the Host Screen and Settings.
