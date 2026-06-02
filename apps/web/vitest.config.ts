import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@kickstock/types':        resolve(__dirname, '../../packages/types/src/index.ts'),
      '@kickstock/game-engine':  resolve(__dirname, '../../packages/game-engine/src/index.ts'),
      '@kickstock/constants':    resolve(__dirname, '../../packages/constants/src/index.ts'),
      '@':                       resolve(__dirname, '.'),
    },
  },
});
