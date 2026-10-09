import { useEffect, useState } from 'react';
import { useT } from '@/i18n/strings';
import { useApp } from '@/state/app';

/**
 * Registers the service worker (production only) and offers a quiet,
 * non-blocking update chip — never during a mission, never a modal.
 */
export function UpdatePrompt() {
  const t = useT();
  const screen = useApp((s) => s.screen);
  const [update, setUpdate] = useState<null | (() => void)>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      const updateSW = registerSW({
        onNeedRefresh() {
          setUpdate(() => () => void updateSW(true));
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || screen === 'mission') return null;
  return (
    <div className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pb-24">
      <button
        type="button"
        onClick={update}
        className="pointer-events-auto flex h-11 items-center gap-3 rounded-full border border-volt/40 bg-black/80 px-5 text-[12px] uppercase tracking-[0.2em] text-bone backdrop-blur"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-volt" />
        {t('update.ready')} · {t('update.apply')}
      </button>
    </div>
  );
}
