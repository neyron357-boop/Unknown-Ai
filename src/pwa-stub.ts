/** Used instead of `virtual:pwa-register` in the single-file artifact build (no service worker there). */
export function registerSW(): (reload?: boolean) => Promise<void> {
  return async () => undefined;
}
