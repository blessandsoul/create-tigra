/**
 * A full page load to `path`, used when the session is dead: it drops every
 * in-memory state (React Query cache, the API client's refresh state) at once.
 * Its own module so tests can replace it (jsdom cannot navigate).
 */
export function hardRedirect(path: string): void {
  window.location.href = path;
}
