/**
 * What a hardware keyboard's ⌘ keys do in Muxify, and which keys the user
 * gave each of them.
 *
 * Every Keyboard Shortcut holds ⌘. tmux has no ⌘ to give a Pane, so a key
 * with ⌘ is never one a program in a Pane waits for, and taking it costs the
 * Pane nothing. A chord without ⌘ would take a key away from the Pane. The
 * List Keys are the one set without ⌘: they work only while a list of Go to
 * or Add a Session has the keys, where no Pane waits for them.
 */

export const KEYBOARD_ACTIONS = [
  'open-settings',
  'go-to',
  'new-topic',
  'switch-tab',
  'new-session-here',
  'split-right',
  'split-down',
  'pane-left',
  'pane-down',
  'pane-up',
  'pane-right',
  'copy-pane',
  'clear-pane',
] as const;
export type KeyboardAction = (typeof KEYBOARD_ACTIONS)[number];

export const KEYBOARD_ACTION_TITLES: Record<KeyboardAction, string> = {
  'open-settings': 'Open Settings',
  'go-to': 'Go to',
  'new-topic': 'New Topic',
  'switch-tab': 'Switch between Topics and Sessions',
  'new-session-here': 'New Session here',
  'split-right': 'Split right',
  'split-down': 'Split down',
  'pane-left': 'Pane to the left',
  'pane-down': 'Pane below',
  'pane-up': 'Pane above',
  'pane-right': 'Pane to the right',
  'copy-pane': 'Copy Pane text',
  'clear-pane': 'Clear Pane',
};

/**
 * A key and the modifiers held with ⌘. `key` is what UIKit's key command
 * takes as its input: a lowercase character, or one of the arrow names.
 */
export interface KeyChord {
  key: string;
  shift: boolean;
  option: boolean;
  control: boolean;
}

/** The chords the user has changed. An action not in it has its default. */
export type KeyboardShortcuts = Partial<Record<KeyboardAction, KeyChord>>;

const chord = (key: string, shift = false, option = false): KeyChord => ({ key, shift, option, control: false });

export const DEFAULT_CHORDS: Readonly<Record<KeyboardAction, KeyChord>> = {
  'open-settings': chord(','),
  'go-to': chord('p'),
  'new-topic': chord('n'),
  'switch-tab': chord('t', false, true),
  'new-session-here': chord('\r'),
  'split-right': chord('d'),
  'split-down': chord('d', true),
  'pane-left': chord('h', true),
  'pane-down': chord('j', true),
  'pane-up': chord('k', true),
  'pane-right': chord('l', true),
  'copy-pane': chord('c'),
  'clear-pane': chord('k'),
};

export function chordFor(shortcuts: KeyboardShortcuts | undefined, action: KeyboardAction): KeyChord {
  return shortcuts?.[action] ?? DEFAULT_CHORDS[action];
}

/** Every action's chord, the user's where there is one. */
export function chordsInForce(shortcuts: KeyboardShortcuts | undefined): Record<KeyboardAction, KeyChord> {
  return { ...DEFAULT_CHORDS, ...shortcuts };
}

export function sameChord(a: KeyChord, b: KeyChord): boolean {
  return a.key === b.key && a.shift === b.shift && a.option === b.option && a.control === b.control;
}

const KEY_NAMES: Record<string, string> = {
  UIKeyInputLeftArrow: '←',
  UIKeyInputRightArrow: '→',
  UIKeyInputUpArrow: '↑',
  UIKeyInputDownArrow: '↓',
  UIKeyInputEscape: '⎋',
  '\r': '↩',
  '\t': '⇥',
  ' ': 'Space',
  '\b': '⌫',
};

/** The chord as the system writes one, modifiers in Apple's order: ⌃⌥⇧⌘D. */
export function chordLabel(value: KeyChord): string {
  return keyLabel(value, true);
}

function keyLabel(value: KeyChord, command: boolean): string {
  const modifiers = `${value.control ? '⌃' : ''}${value.option ? '⌥' : ''}${value.shift ? '⇧' : ''}${command ? '⌘' : ''}`;
  return modifiers + (KEY_NAMES[value.key] ?? value.key.toUpperCase());
}

/**
 * The keys of a list in Go to and Add a Session, as the Mac's Command Palette
 * has them. They hold no ⌘ and the user cannot change them. A screen handles
 * them only while its list has the keys.
 */
export const LIST_KEYS = ['list-up', 'list-down', 'list-pick', 'list-close', 'list-worktree'] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export const LIST_KEY_TITLES: Record<ListKey, string> = {
  'list-up': 'Row above',
  'list-down': 'Row below',
  'list-pick': 'Pick the row',
  'list-close': 'Close the list',
  'list-worktree': 'Add a Session in a new Worktree',
};

export const LIST_KEY_CHORDS: Readonly<Record<ListKey, KeyChord>> = {
  'list-up': chord('UIKeyInputUpArrow'),
  'list-down': chord('UIKeyInputDownArrow'),
  'list-pick': chord('\r'),
  'list-close': chord('UIKeyInputEscape'),
  'list-worktree': chord('\r', false, true),
};

export function listKeyLabel(key: ListKey): string {
  return keyLabel(LIST_KEY_CHORDS[key], false);
}

/** A key the recorder took, with every modifier it saw, ⌘ included. */
export interface RecordedKey extends KeyChord {
  command: boolean;
}

export type Rebinding =
  | { kind: 'bound'; shortcuts: KeyboardShortcuts }
  | { kind: 'no-command' }
  | { kind: 'taken'; by: KeyboardAction };

/**
 * Gives an action the recorded key. Refused without ⌘, and refused when
 * another action has the key already, so one press never means two things.
 * A key equal to the default drops the override, so a later change of the
 * default reaches this action.
 */
export function rebind(
  shortcuts: KeyboardShortcuts | undefined,
  action: KeyboardAction,
  recorded: RecordedKey,
): Rebinding {
  if (!recorded.command) return { kind: 'no-command' };
  const { command: _, ...next } = recorded;
  const by = KEYBOARD_ACTIONS.find(
    (other) => other !== action && sameChord(chordFor(shortcuts, other), next),
  );
  if (by !== undefined) return { kind: 'taken', by };
  const { [action]: _old, ...rest } = shortcuts ?? {};
  return {
    kind: 'bound',
    shortcuts: sameChord(next, DEFAULT_CHORDS[action]) ? rest : { ...rest, [action]: next },
  };
}

/** The changed chords a saved value names. Anything unrecognised is dropped. */
export function parseKeyboardShortcuts(raw: unknown): KeyboardShortcuts | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const entries = KEYBOARD_ACTIONS.flatMap((action): [KeyboardAction, KeyChord][] => {
    const value = parseChord(record[action]);
    return value ? [[action, value]] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseChord(raw: unknown): KeyChord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { key, shift, option, control } = raw as Record<string, unknown>;
  if (typeof key !== 'string' || key === '') return undefined;
  return { key, shift: shift === true, option: option === true, control: control === true };
}
