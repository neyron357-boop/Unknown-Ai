import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Note: no <StrictMode> — it double-mounts effects in development, which would
// create and destroy the Phaser game twice. Game objects own real GPU resources.
// The artifact host pads the page by the safe-area insets itself: size to the container, not the viewport.
if (import.meta.env.VITE_TARGET === 'artifact') document.documentElement.classList.add('artifact');

const root = document.getElementById('root');
if (import.meta.env.DEV && new URLSearchParams(location.search).has('gallery')) {
  void import('./game/scene/GalleryScene').then(async ({ GalleryScene }) => {
    const Phaser = (await import('phaser')).default;
    document.body.style.background = '#000';
    new Phaser.Game({ type: Phaser.AUTO, width: window.innerWidth * 2, height: window.innerHeight * 2, zoom: 0.5, parent: root, scene: [GalleryScene], banner: false });
  });
} else if (root) createRoot(root).render(<App />);

// Prevent iOS pinch-zoom inside the game (double-tap zoom is disabled via `touch-action: manipulation`).
document.addEventListener('gesturestart', (e) => e.preventDefault());
