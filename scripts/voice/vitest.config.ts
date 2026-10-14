// Tests for the browser voice code (src/voice) — kept out of the main vitest config.
// Run: npm run test:voice
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/voice/**/*.test.ts'],
  },
});
