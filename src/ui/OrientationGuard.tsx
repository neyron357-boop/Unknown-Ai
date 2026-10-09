import { useEffect, useState } from 'react';
import { useT } from '@/i18n/strings';

/** The game is designed for one-handed portrait play; landscape phones get a gentle prompt. */
export function OrientationGuard() {
  const t = useT();
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
    const update = () => setLandscape(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (!landscape) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-void text-center">
      <div className="h-14 w-8 rounded-md border-2 border-volt/70 shadow-[0_0_16px_rgba(57,213,255,0.5)]" />
      <div className="text-[13px] uppercase tracking-[0.24em] text-bone/85">{t('orient.portrait')}</div>
    </div>
  );
}
