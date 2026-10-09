import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Note: no <StrictMode> — it double-mounts effects in development, which would
// create and destroy the Phaser game twice. Game objects own real GPU resources.
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

// Prevent iOS pinch-zoom inside the game (double-tap zoom is disabled via `touch-action: manipulation`).
document.addEventListener('gesturestart', (e) => e.preventDefault());
