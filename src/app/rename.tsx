import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Form, Host, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  disabled,
  environment,
  font,
  foregroundColor,
  listRowBackground,
  scrollContentBackground,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { FieldError } from '@/components/field-error';
import { HostWriteRow } from '@/components/host-write-row';
import { SectionHeader } from '@/components/section-header';
import { useHostWrite } from '@/hooks/use-host-write';
import { useSettings } from '@/settings/settings-context';
import type { SessionId } from '@/topics/environment';
import { pushedListing } from '@/topics/host-writes';
import { sendTmuxOrder, type TmuxOrder } from '@/topics/tmux-order';

/** What the sheet renames: a Session or a Window, by tmux's id, with the name it had when the sheet opened. */
export type RenameParams = { hostId: string; kind: 'session' | 'window'; id: string; name: string };

/**
 * Rename Session and Rename Window, as the Mac's do: one name, sent as one
 * Host Write. The Host keeps a Topic's slug after a Session's name, and a name
 * another Session has gets +2. The Host Server pushes the new name to the
 * Listing and the Attach, which read nothing after a Save.
 */
export default function RenameScreen() {
  const router = useRouter();
  const { hostId, kind, id, name: was } = useLocalSearchParams<RenameParams>();
  const { appearance, palette } = useSettings();
  const { write, hostName, send, check } = useHostWrite(hostId);
  const locked = write.kind === 'running' || write.kind === 'unsure';
  const what = kind === 'window' ? 'Window' : 'Session';

  const name = useNativeState(was ?? '');
  const [nameError, setNameError] = useState<string | undefined>();
  const wanted = () => name.value.trim();
  const finished = (done: true | undefined) => { if (done) router.back(); };

  const save = () => {
    if (locked) return;
    const typed = wanted();
    if (typed === '') {
      setNameError(`Give the ${what} a name.`);
      return;
    }
    setNameError(undefined);
    if (typed === was) {
      router.back();
      return;
    }
    const order: TmuxOrder = kind === 'window'
      ? { kind: 'rename-window', window: id, name: typed }
      : { kind: 'rename-session', session: id as SessionId, name: typed };
    void send(async ({ host, step, refuse, unsure }) => {
      const sent = await sendTmuxOrder(host, order, () => step('sending'));
      if (sent.kind === 'failed') refuse(sent.error);
      if (sent.kind === 'unknown') unsure(sent.message);
      return true as const;
    }).then(finished);
  };

  // The Listing as the Host Server pushes it now: the Session or Window with its new name, or still with the old one.
  const checkRenamed = () => {
    const typed = wanted();
    void check(async ({ host, refuse }) => {
      const snapshot = await pushedListing(host);
      const now = kind === 'window'
        ? snapshot.sessions.flatMap((session) => session.windows ?? []).find((window) => window.id === id)?.name
        : snapshot.sessions.find((session) => session.id === id)?.name;
      if (now === undefined) refuse(`The ${what} is no longer on ${host.displayName}.`);
      const renamed = kind === 'window' ? now === typed : now !== was;
      if (!renamed) refuse(`${host.displayName} has the old name. Save sends the new one.`);
      return true as const;
    }).then(finished);
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: `Rename ${what}`, gestureEnabled: write.kind !== 'running' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button tintColor={palette.controlAccent} disabled={write.kind === 'running'} onPress={() => router.back()}>
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" tintColor={palette.controlAccent} disabled={locked} onPress={save}>
          Save
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <Host style={styles.fill} matchContents={false}>
        <Form
          modifiers={[
            environment('colorScheme', appearance),
            scrollContentBackground('hidden'),
            background(palette.background),
            tint(palette.controlAccent),
          ]}>
          <HostWriteRow
            write={write}
            words={{ host: hostName, sending: `Renaming ${was}`, mayHaveHappened: `The ${what} may have its new name.` }}
            palette={palette}
            onRetry={save}
            onCheck={checkRenamed}
          />
          <Section
            header={<SectionHeader palette={palette}>Name</SectionHeader>}
            footer={
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.sectionHeader)]}>
                {kind === 'window'
                  ? 'Every tmux client on the Host sees the new name.'
                  : "A Session in a Topic keeps the Topic's name after it, and a name that another Session has gets +2."}
              </Text>
            }
            modifiers={[listRowBackground(palette.rowSurface)]}>
            <TextField
              text={name}
              modifiers={[
                font({ design: 'monospaced' }),
                textInputAutocapitalization('never'),
                autocorrectionDisabled(),
                accessibilityLabel(`${what} name`),
                disabled(locked),
              ]}
            />
            <FieldError error={nameError} palette={palette} />
          </Section>
        </Form>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
