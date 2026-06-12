/**
 * Duration parsing — LEAF MODULE.
 *
 * This file must have ZERO imports. It exists to break the circular import
 * between cookies.ts and auth.ts: cookies.ts calls parseDurationMs at module
 * top-level, so if it imported the function from auth.ts (which imports
 * clearAuthCookies from cookies.ts), the cycle left auth.ts partially
 * initialized and crashed module evaluation with
 * "parseDurationMs is not a function" (TDZ). Keep this module dependency-free.
 */

/**
 * Parse a duration string like "15m", "7d", "30s", "12h" into milliseconds.
 * Returns `fallbackMs` when the string doesn't match the expected format.
 */
export function parseDurationMs(duration: string, fallbackMs: number): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return fallbackMs;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}
