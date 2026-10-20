/**
 * How the API client tells the app that the session ended. The client never
 * imports the Redux store (each visitor gets their own store, see
 * store/index.ts); AuthInitializer listens here and clears the signed-in user.
 *
 * Reasons:
 *  - 'expired': a real call found the session dead (the refresh was refused).
 *    The API client also sends the browser to the sign-in page.
 *  - 'signed-out': the start-up "who am I" check found no live session.
 *  - 'deactivated': the account was banned while signed in (403
 *    ACCOUNT_DEACTIVATED); the cookies were cleared through the logout route.
 */
export type SessionEndReason = 'expired' | 'signed-out' | 'deactivated';

type Listener = (reason: SessionEndReason) => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe function (fits a useEffect cleanup). */
export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionEnded(reason: SessionEndReason): void {
  for (const listener of [...listeners]) listener(reason);
}
