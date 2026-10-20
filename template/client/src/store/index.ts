import { configureStore } from '@reduxjs/toolkit';

import authReducer, { initialAuthState } from '@/features/auth/store/authSlice';

/**
 * A new store per visitor: Providers makes one per page load in the browser and
 * one per request during server rendering, so no visitor's state can ever leak
 * into another's (Redux's guidance for the Next.js App Router: a module-level
 * store would be shared by every request the server renders).
 *
 * `hasSession`: the request carries the server's session marker (the root
 * layout reads it). Then who the visitor is stays unknown until the "who am I"
 * check answers (isInitializing). Without it the visitor is plainly signed out
 * from the first render, so the server already renders the signed-out header
 * instead of one that flips after loading.
 */
export function makeStore({ hasSession = false }: { hasSession?: boolean } = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
    },
    preloadedState: {
      auth: { ...initialAuthState, isInitializing: hasSession },
    },
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
