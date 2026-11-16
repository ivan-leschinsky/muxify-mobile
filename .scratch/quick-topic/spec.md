# Quick Topic from a Session Path — phone part

Status: ready

Read `design.html` next to this file first: it is the agreed design, with mock screens, and section 7 has the decisions. Summary of what to build on the phone:

1. **Host Screen: Topics and Sessions tabs**, the Mac Sidebar's two views (Topics: Pinned, In Play, Guests, Bench row, No Topic; Sessions: every running Session in tmux order, its Topic as subtitle, no Bench). They replace the stacked lists of Configure panels. Which tabs show comes from `environment show` `sidebar` (both tabs when absent; only Sessions when the Host CLI has no Topics). Remember the last tab per Host. Switch by tap or ⌥⌘T; no swipe (Topic cards already have swipe actions).
2. **Bench peek**: while the Bench row is closed, show the card of the Attach's Topic under it, or the Attach's Session when it is in No Topic (the Mac's rule, `Sources/Muxify/Topics/TopicsModel.swift` ~676-698 in the desktop repo). Today `src/domain/host-screen.ts` ~303-307 hides every Bench card.
3. **Liquid Glass bottom bar** on the Host Screen: `<Stack.Toolbar placement="bottom">` with `Stack.Toolbar.SearchBarSlot` (field from `<Stack.SearchBar>`) for **Go to**, a `Spacer`, and a `Menu` **＋** with New Topic and New Session at a folder. iOS 26+ only (decided), so no fallback. Not on Home or the Terminal; hidden in Edit mode and the Fill Place sheet. New Session / New Topic leave the Options menu. Read the v57 Expo docs for these first (AGENTS.md).
4. **Go to**: tapping the field shows one ranked list in place of the tab — running Sessions (from the tmux Listing joined with `environment show`), Session Paths and Worktrees from `session-paths --query`, a typed `~` path last. Tap a running Session: switch the Attach (Title Sheet membership rules). Tap a path: go to its No Topic Session, or `session new <dir> --name …` and attach. Long press a path: "New Session here" with a `+2` name. Empty field ranks by Recent Sessions + last visit. Recent Sessions stops being a Host Screen list. Cache the last list per Host and show it at once; refresh in the background.
5. **New Topic**: one sheet — title + Tags, Return sends `topic new` (empty title refused, as today), then the same sheet becomes Add a Session with the list already loaded and the keyboard up; a tap sends `topic add-session --name` and opens the Session. A running Session row moves into the Topic. Add later keeps the Empty Topic. Replaces today's topic-form → topic-add-session pair.
6. **New Session at a folder** (＋ menu): the Go to list with paths only, making a No Topic Session. Today's New Session (name, no folder) goes.
7. **iPad keys**: ⌘P Go to, ⌘N New Topic, ⌥⌘T switch tabs, ↑↓↩Esc in lists, ⌘↩ +2 Session, ⌥↩ new Worktree first (via `topic add-session --worktree`). Through the key-commands module (ADR 0022); list them in Keyboard Shortcuts.
8. **Old Host CLI** (no `session-paths` capability): today's sheets.
9. **CONTEXT.md and ADRs**: Go to, the tabs, the Bench peek; New Session (name only) goes; Configure panels goes.
10. **Unchanged (decided)**: the Terminal's Title Sheet keeps its Windows / Sessions / Topics switch.

The Host CLI additions are built at the same time by another agent in the Session `muxify/muxify-mobile-start-a-topic` (`/Users/glebglazov/.local/state/muxify/worktrees/muxify/muxify-mobile-start-a-topic`). Build against the contract below with fixtures; read that agent's `.scratch/quick-topic/spec.md` `## Comments` (or `muxify agent conversation <pane>`) for the final verb names before you wire the real calls. Use `e2e/sandbox.sh` for anything that touches tmux (AGENTS.md).

## Host CLI contract (shared by both specs — change it only together)

The phone talks to the Mac only through the `muxify` Host CLI over SSH (`--json`, `--request <uuid>` for writes). These are the additions:

1. **`muxify session-paths [--query <text>] --json`** — no Topic, Window or Pane target. Today `topic session-paths` refuses to run without one (`Sources/MuxifyCLI/CLIVerbs.swift` ~468-471 on the old master; find it on fresh master).
   - Answer: `{"rows":[{"kind":"session_path"|"worktree","name":…,"label":…,"directory":…,"worktree":{"path":…,"branch":…|null}|null,"also_in":[{"id":…,"label":…}],"last_visit":"<ISO-8601>"|null}]}` — the same row shape as `topic session-paths`, without `in_this_topic`, plus `last_visit`.
   - Rows come **ranked**: with `--query`, the Mac's fuzzy match and tie-breaks (`PickList`, ADR 0045); with no query, by `last_visit`, newest first.
   - Answer from the Session Path discovery cache (`~/.local/state/muxify/session-paths/<env>.json`) and refresh it after, so a slow `git worktree list` does not hold the answer.
2. **Last visit in `muxify.db`** — move the visit log out of UserDefaults (`VisitLog.swift`) into the state database, so the Mac app and the Host CLI read one record. Add a write the phone calls when it opens a Session at a path, e.g. `muxify session-paths visit <dir>` (desktop agent: pick the verb, then tell the phone side; it takes `--request`).
3. **`environment show --json`** gets `"sidebar":{"topics":<bool>,"sessions":<bool>}` from the Config keys `sidebar.topics` / `sidebar.sessions`, next to where the Tags are.
4. **`capabilities`** in `environment show --json` gets `"session-paths"` next to `"request"` (`Sources/MuxifyCLI/RequestInvocation.swift` ~687). The phone uses it to choose the new flow or today's sheets.
5. **`session new <dir> [--name <n>]`** must take `--request` and apply once. Check; add it if missing.
6. **New Topic refuses an empty title** on the Mac (⌘N, today it makes "Untitled", `PaletteFlow.swift` ~157). `topic new` on the CLI already refuses a blank title.

Existing verbs the phone uses as they are: `topic new`, `topic add-session --name`, `topic session-paths --topic`, `environment show`.

## Done when

- Each part has tests in this repo's style; typecheck, lint and unit tests pass; the e2e suites that cover the Host Screen pass through `e2e/sandbox.sh`.
- CONTEXT.md and docs/adr say what changed.

Do not commit or push unless the user asks. Follow AGENTS.md.
