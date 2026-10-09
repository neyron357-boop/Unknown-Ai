import { getSettings } from '@/state/settings';

/**
 * Vibration feedback. Works on Android browsers; iOS Safari does not expose
 * the Vibration API, so this is a silent no-op there.
 */
export function haptic(pattern: number | number[]): void {
  if (!getSettings().haptics) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
