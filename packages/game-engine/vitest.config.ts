import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@kickstock/types':     resolve(__dirname, '../types/src/index.ts'),
      '@kickstock/constants': resolve(__dirname, '../constants/src/index.ts'),
    },
  },
});
