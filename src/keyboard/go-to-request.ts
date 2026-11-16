/**
 * Go to asked for from a screen that has no Go to field: ⌘P in the Terminal.
 * The Terminal names the Host and goes to its Host Screen, which takes the
 * request when it has the focus and puts the keys in its Go to field.
 */
let requested: string | null = null;

export function requestGoTo(hostId: string): void {
  requested = hostId;
}

/** Whether Go to was asked for on this Host. A request is taken one time. */
export function takeGoToRequest(hostId: string): boolean {
  if (requested !== hostId) return false;
  requested = null;
  return true;
}
