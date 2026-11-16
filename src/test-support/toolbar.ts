import type { ReactNode } from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

function Toolbar({ children }: { children?: ReactNode }) {
  return children;
}
function ToolbarButton() {
  return null;
}
function ToolbarMenu({ children }: { children?: ReactNode }) {
  return children;
}
function ToolbarMenuAction() {
  return null;
}
Toolbar.Button = ToolbarButton;
Toolbar.Menu = ToolbarMenu;
Toolbar.MenuAction = ToolbarMenuAction;
function Nothing() {
  return null;
}
Toolbar.Label = Nothing;
Toolbar.Spacer = Nothing;
Toolbar.SearchBarSlot = Nothing;

function SearchBar() {
  return null;
}

/** expo-router's `Stack` for a screen test: the toolbar keeps its buttons in the tree, so a test can press them by their words. */
export const mockStack = { Stack: { Screen: () => null, Toolbar, SearchBar } };

/** The top bar button with these words, or with this accessibility label. */
export function toolbarButton(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find((node) => node.type === ToolbarButton
    && (node.props.children === label || node.props.accessibilityLabel === label));
}

/** The one top bar button on this side, whatever its words. */
export function toolbarSide(renderer: ReactTestRenderer, placement: 'left' | 'right'): ReactTestInstance {
  return renderer.root.find((node) => node.type === Toolbar && node.props.placement === placement).findByType(ToolbarButton);
}

/** The menu items on show in every toolbar, by their words. An item that is hidden is not one. */
export function toolbarMenuActions(renderer: ReactTestRenderer): Map<string, ReactTestInstance> {
  return new Map(renderer.root.findAllByType(ToolbarMenuAction)
    .filter((node) => node.props.hidden !== true)
    .map((node) => [node.props.children as string, node]));
}

/** The search field of the screen, or undefined when the screen shows none. */
export function searchBar(renderer: ReactTestRenderer): ReactTestInstance | undefined {
  return renderer.root.findAllByType(SearchBar)[0];
}
