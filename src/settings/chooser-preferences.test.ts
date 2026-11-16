import { chooserListsFor, DEFAULT_SETTINGS, hiddenChooserLists, moveChooserLists, parseSettings, switchChooserList } from './settings';
import { createSettingsStore } from './settings-store';

it('defaults to Windows', () => {
  expect(chooserListsFor(parseSettings({}), 'first')).toEqual(['windows']);
});

it('keeps known chooser lists once and retains their order', () => {
  const settings = parseSettings({ chooserListPreferences: { first: ['topics', 'other', 'topics', 'windows'], empty: [] } });
  expect(chooserListsFor(settings, 'first')).toEqual(['topics', 'windows']);
  expect(chooserListsFor(settings, 'empty')).toEqual(['windows']);
  expect(chooserListsFor(settings, 'constructor')).toEqual(['windows']);
});

it('retains independent choices for each Host after restart', async () => {
  let contents = JSON.stringify(DEFAULT_SETTINGS);
  const file = { read: async () => contents, write: async (next: string) => { contents = next; } };
  const store = createSettingsStore(file);
  const settings = await store.load();
  await store.save({ ...settings, chooserListPreferences: { first: ['sessions', 'windows'], second: ['topics'] } });
  const restarted = await createSettingsStore(file).load();
  expect(chooserListsFor(restarted, 'first')).toEqual(['sessions', 'windows']);
  expect(chooserListsFor(restarted, 'second')).toEqual(['topics']);
});

it('does not disable the final chooser list', () => {
  expect(switchChooserList(['windows'], 'windows', false)).toEqual(['windows']);
  expect(switchChooserList(['windows'], 'sessions', true)).toEqual(['windows', 'sessions']);
  expect(switchChooserList(['windows', 'sessions'], 'windows', false)).toEqual(['sessions']);
});

it('reorders the shown lists', () => {
  expect(moveChooserLists(['windows', 'sessions', 'topics'], [2], 0)).toEqual(['topics', 'windows', 'sessions']);
  expect(moveChooserLists(['windows', 'sessions'], [0], 2)).toEqual(['sessions', 'windows']);
  expect(moveChooserLists(['windows'], [0], 1)).toEqual(['windows']);
});

it('offers the lists that are not shown as hidden', () => {
  expect(hiddenChooserLists(['topics'])).toEqual(['windows', 'sessions']);
  expect(hiddenChooserLists(['sessions', 'windows', 'topics'])).toEqual([]);
});
