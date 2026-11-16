import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { NativeStackNavigationProp } from 'expo-router/native-stack';
import { CommonActions, usePreventRemove, type ParamListBase } from 'expo-router/react-navigation';

import { placeTabRoute } from '@/browser/place-tab-route';
import { readBrowserTabs } from '@/browser/read-browser-tabs';
import { tabRestoreOf, type BrowserTab } from '@/browser/tabs';
import { HeaderTitleButton, type HeaderTitle } from '@/components/terminal-header';
import { TitleSheet } from '@/components/title-sheet';
import { deviceLog } from '@/diagnostics/device-log';
import { speakingAs } from '@/diagnostics/log';
import { useTitleSheet } from '@/hooks/use-title-sheet';
import { useSettings } from '@/settings/settings-context';
import type { PlaceTab } from '@/storage/records';
import { useAttachState, useCurrentAttach } from '@/tmux/attach-context';

const say = speakingAs(deviceLog(), 'browser');

/** How long the page rests before where it is goes into the Topic Place. */
const SCROLL_SETTLE_MS = 400;

interface ShownPage {
  /** The Host Tab's URL. */
  url: string;
  /** What to load: the Tab's URL, or the page a restore goes back to. */
  page: string;
  scrollY: number;
  title: string;
}

/**
 * One Browser Tab's page, loaded on the phone.
 *
 * The page is loaded again here, from its address: the phone shows what the
 * address serves, and not the Tab on the Host, so a form filled in on the Mac
 * is empty here. The Terminal Screen is under this screen and its Attach
 * stays up, so Back finds the Session as it was. See ADR 0007.
 *
 * It has the Terminal Header's title and the same Title Sheet. While it is on
 * top, the Attach keeps its Tab in the Topic Place. Back goes to the Host
 * Screen and leaves the Tab there, so opening the Topic again opens the page
 * again. A pick in the Title Sheet goes to the Terminal Screen. See ADR 0020.
 */
export default function WebViewScreen() {
  const params = useLocalSearchParams<{ url: string; title?: string; page?: string; scrollY?: string; restored?: string }>();
  const router = useRouter();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const focused = useIsFocused();
  const { palette } = useSettings();
  const attach = useCurrentAttach();
  const state = useAttachState(attach);
  const webView = useRef<WebView>(null);
  const [shown, setShown] = useState<ShownPage>(() => ({
    url: params.url,
    page: params.page || params.url,
    scrollY: Number(params.scrollY) || 0,
    title: params.title ?? '',
  }));
  const [title, setTitle] = useState(shown.title);
  /** Why the last load failed; null while the page loads or shows. */
  const [failure, setFailure] = useState<string | null>(null);

  // The Attach's token for this Tab. Going away gives it back, which clears
  // the Tab from the Topic Place, unless the Topic changed first or Back kept it.
  const token = useRef<number | null>(null);
  const keepTab = useRef(false);
  const where = useRef({ page: shown.page, scrollY: shown.scrollY });
  const scrolled = useRef(false);
  useEffect(() => {
    if (!attach) return;
    const mine = attach.showTab({ url: shown.url, page: shown.page, scrollY: shown.scrollY });
    token.current = mine;
    where.current = { page: shown.page, scrollY: shown.scrollY };
    scrolled.current = shown.scrollY === 0;
    return () => {
      if (!keepTab.current) attach.leaveTab(mine);
      if (token.current === mine) token.current = null;
    };
  }, [attach, shown]);

  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);
  const report = useCallback(() => {
    if (token.current !== null) attach?.updateTab(token.current, where.current);
  }, [attach]);

  // In a Topic, Back leaves the Topic as Back on the Terminal Screen does, and the Topic keeps this page. Without a Topic
  // nothing keeps it, so Back goes to the Session under it, as the native
  // stack does. The screen's own ways out (a pick in the Title Sheet) lift
  // the block first, then go to the Terminal Screen.
  const hostId = attach?.hostId;
  const inTopic = state?.topic != null;
  const [release, setRelease] = useState<(() => void) | null>(null);
  // A page that a Topic Place opened from the Host Screen slid in alone, over
  // the Host Screen. Once it is in, the Terminal Screen goes under it, with no
  // move to see: the top of the stack stays this page. Then a Window pick, or
  // a Tab the Host lists no more, finds the Session under the page.
  useEffect(() => navigation.addListener('transitionEnd', (event) => {
    if (event.data.closing) return;
    const stack = navigation.getState();
    if (!stack || stack.index < 1 || stack.routes[stack.index - 1]?.name === 'terminal') return;
    const page = stack.routes[stack.index];
    navigation.dispatch(CommonActions.reset({
      ...stack,
      index: stack.index + 1,
      routes: [...stack.routes.slice(0, stack.index), { key: `terminal-${page.key}`, name: 'terminal' }, page],
    }));
  }), [navigation]);

  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current || !navigation.isFocused()) return;
    leaving.current = true;
    // The Terminal Screen goes under a page from the Host Screen only once the
    // page is in: before that, the page gives its place to it.
    const stack = navigation.getState();
    const underIsTerminal = stack !== undefined && stack.routes[stack.index - 1]?.name === 'terminal';
    setRelease(() => () => (underIsTerminal ? router.back() : router.replace('/terminal')));
  }, [navigation, router]);
  usePreventRemove(release === null && inTopic && hostId !== undefined, () => {
    if (leaving.current || !hostId) return;
    leaving.current = true;
    if (settle.current) clearTimeout(settle.current);
    report();
    keepTab.current = true;
    say('Back: to the Host Screen, and the Topic keeps its page');
    setRelease(() => () => router.dismissTo({ pathname: '/hosts/[id]', params: { id: hostId } }));
  });
  useEffect(() => release?.(), [release]);

  const showTab = useCallback((tab: BrowserTab) => {
    setFailure(null);
    setTitle(tab.title);
    setShown({ url: tab.url, page: tab.url, scrollY: 0, title: tab.title });
  }, []);
  /**
   * A pick in the Title Sheet. A Topic whose Topic Place has a Tab shows that
   * page in place of this one, in one move; any other pick goes to the
   * Terminal Screen under it.
   */
  const moved = useCallback((tab: PlaceTab | null) => {
    if (!tab) {
      leave();
      return;
    }
    if (leaving.current) return;
    leaving.current = true;
    setRelease(() => () => router.replace(placeTabRoute(tab)));
  }, [leave, router]);
  const chooser = useTitleSheet({ attach, state, hostId, onOpenTab: showTab, onMoved: moved });

  // A page that a Topic Place opened: once the Attach is back in the Place's
  // Window, the Host must still list the Tab. A Tab closed on the Mac sends the
  // user to the Pane, and the Place forgets it. A read that fails says nothing,
  // and the page stays.
  const restored = params.restored === '1';
  const tabToRestore = state?.tabToRestore ?? null;
  useEffect(() => {
    if (!restored || !attach || !tabToRestore || !focused || !hostId) return;
    const wanted = attach.takeTabToRestore();
    if (!wanted || wanted.tab.url !== shown.url) return;
    const window = attach.state().topology.activeWindow?.id;
    void (async () => {
      const read = window ? await readBrowserTabs(hostId, window) : { kind: 'failed' as const, error: 'no active Window' };
      const restore = tabRestoreOf(read, wanted.tab.url);
      if (restore.kind === 'gone') {
        say(`the Topic Place's Tab ${wanted.tab.url} is no longer listed; going to the Pane`);
        if (token.current !== null) attach.leaveTab(token.current);
        leave();
      } else if (restore.unread !== null) {
        say(`the Tabs of ${window} did not read (${restore.unread}); keeping ${wanted.tab.url}`);
      }
    })();
  }, [restored, attach, tabToRestore, focused, hostId, shown.url, leave]);

  // A new Attach, or a Topic that the Attach went to from elsewhere, is
  // somewhere else: the Terminal Screen shows it. A Topic picked in this
  // screen's Title Sheet waits for the pick, which says where to go.
  const [arrivedIn] = useState(() => ({ attach, topicId: state?.topic?.id ?? null }));
  const topicId = state?.topic?.id ?? null;
  const openingTopic = chooser.openingTopic;
  useEffect(() => {
    if (focused && !openingTopic && (attach !== arrivedIn.attach || topicId !== arrivedIn.topicId)) leave();
  }, [focused, openingTopic, attach, topicId, arrivedIn, leave]);

  const pageTitle = title || shown.page;
  const headerTitle = useMemo((): HeaderTitle | null => {
    if (!state) return null;
    return chooser.topic
      ? { kind: 'topic', topic: chooser.topic.label, program: `🌐 ${pageTitle}`, session: state.sessionName }
      : { kind: 'session', session: state.sessionName, program: pageTitle };
  }, [state, chooser.topic, pageTitle]);

  const reload = () => {
    setFailure(null);
    webView.current?.reload();
  };

  return (
    <View style={[styles.fill, { backgroundColor: palette.background }]}>
      {/* A swipe from the edge would show the terminal under the page on its
          way to the Host Screen, so in a Topic, Back is the way out. */}
      <Stack.Screen options={{ title: pageTitle, gestureEnabled: !inTopic }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="arrow.clockwise" accessibilityLabel="Reload" onPress={reload} />
      </Stack.Toolbar>
      {headerTitle === null ? null : (
        <HeaderTitleButton
          title={headerTitle}
          colors={{ foreground: palette.toolbarTint, dim: palette.secondaryLabel }}
          onTitle={chooser.openTitleSheet}
          testID="web-view-title"
          detailTestID="page-title"
        />
      )}
      <WebView
        ref={webView}
        source={{ uri: shown.page }}
        style={styles.fill}
        pullToRefreshEnabled
        onNavigationStateChange={(navigation) => {
          if (navigation.title) setTitle(navigation.title);
          if (!navigation.loading && navigation.url && navigation.url !== where.current.page) {
            where.current = { page: navigation.url, scrollY: 0 };
            report();
          }
        }}
        onLoadEnd={({ nativeEvent }) => {
          // Back where the page was left, once, and only on the page it was
          // left on: a link followed since makes the old offset meaningless.
          if (scrolled.current) return;
          scrolled.current = true;
          if (nativeEvent.url !== shown.page) return;
          say(`scrolling ${shown.page} back to ${Math.round(shown.scrollY)}`);
          webView.current?.injectJavaScript(`window.scrollTo(0, ${shown.scrollY}); true;`);
        }}
        onScroll={({ nativeEvent }) => {
          where.current = { ...where.current, scrollY: nativeEvent.contentOffset.y };
          if (settle.current) clearTimeout(settle.current);
          settle.current = setTimeout(report, SCROLL_SETTLE_MS);
        }}
        onLoadStart={() => setFailure(null)}
        onError={({ nativeEvent }) => {
          say(`could not load ${nativeEvent.url}: ${nativeEvent.description}`);
          setFailure(nativeEvent.description);
        }}
        onHttpError={({ nativeEvent }) => say(`${nativeEvent.url} answered ${nativeEvent.statusCode}`)}
        // The reason is drawn below, over the page, where Reload is.
        renderError={() => <View />}
      />
      {failure === null ? null : (
        <View style={[styles.failure, { backgroundColor: palette.background }]}>
          <Text style={[styles.reason, { color: palette.destructive }]}>{failure}</Text>
          <Text style={[styles.address, { color: palette.secondaryLabel }]}>{shown.page}</Text>
          <Pressable accessibilityRole="button" onPress={reload}>
            <Text style={[styles.retry, { color: palette.controlAccent }]}>Try again</Text>
          </Pressable>
        </View>
      )}
      <TitleSheet {...chooser.sheet} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  failure: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  reason: { fontSize: 17, textAlign: 'center' },
  address: { fontSize: 13, textAlign: 'center' },
  retry: { fontSize: 17, fontWeight: '600' },
});
