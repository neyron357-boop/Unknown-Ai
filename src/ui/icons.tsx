import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

export const IconPause = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M8 5v14M16 5v14" />
  </svg>
);
export const IconChart = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 19h16M6 15l4-5 3 3 5-7" />
  </svg>
);
export const IconGear = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </svg>
);
export const IconBack = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconPlay = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconSpark = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
  </svg>
);
export const IconFlow = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M2 9c3-3 5-3 8 0s5 3 8 0 3-2 4-2M2 15c3-3 5-3 8 0s5 3 8 0 3-2 4-2" />
  </svg>
);
export const IconCalm = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </svg>
);
export const IconRestart = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
  </svg>
);
export const IconArrow = ({ size, dir = 'r', ...p }: P & { dir?: 'l' | 'r' }) => (
  <svg {...base(size)} {...p} style={{ transform: dir === 'l' ? 'scaleX(-1)' : undefined, ...p.style }}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);
export const IconShield = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 15a8 8 0 0 1 16 0" />
    <path d="M7.5 15a4.5 4.5 0 0 1 9 0" opacity="0.5" />
  </svg>
);
/** A katana drawn on the diagonal — the primary "fight" action. */
export const IconBlade = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M20.5 3.5L9 15" strokeWidth={2} />
    <path d="M7 13l4 4M8.6 15.4l-4.1 4.1" />
  </svg>
);
export const IconMenu = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
