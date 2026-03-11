'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const useLocalStorage = <T,>(key: string, initialValue: T): readonly [T, (value: T | ((val: T) => T)) => void] => {
  const subscribe = useCallback(
    (callback: () => void): (() => void) => {
      const handler = (e: StorageEvent): void => {
        if (e.key === key) callback();
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
    [key],
  );

  const getSnapshot = useCallback((): string | null => {
    return window.localStorage.getItem(key);
  }, [key]);

  const getServerSnapshot = useCallback((): string | null => {
    return null;
  }, []);

  const rawValue = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const storedValue: T = rawValue !== null
    ? (() => {
        try { return JSON.parse(rawValue) as T; }
        catch { return initialValue; }
      })()
    : initialValue;

  const setValue = useCallback(
    (value: T | ((val: T) => T)): void => {
      try {
        const currentRaw = window.localStorage.getItem(key);
        const current: T = currentRaw !== null
          ? (JSON.parse(currentRaw) as T)
          : initialValue;
        const valueToStore = value instanceof Function ? value(current) : value;
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
        // Dispatch a storage event so useSyncExternalStore picks up the change
        window.dispatchEvent(new StorageEvent('storage', { key }));
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[useLocalStorage] Failed to write key "${key}":`, error);
        }
      }
    },
    [key, initialValue],
  );

  return [storedValue, setValue] as const;
};
