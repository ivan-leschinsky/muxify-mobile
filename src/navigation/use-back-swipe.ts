import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useLayoutEffect } from 'react';
import { Platform } from 'react-native';

import { backSwipeOptions, type BackSwipe } from './back-swipe';

/** Whether the system has a back swipe from anywhere: iOS 26 and later. */
export const CONTENT_POP = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

/** A screen picks its back swipe, and can change it while it is on top. */
export function useBackSwipe(mode: BackSwipe): void {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  useLayoutEffect(() => {
    navigation.setOptions(backSwipeOptions(mode, CONTENT_POP));
  }, [navigation, mode]);
}
