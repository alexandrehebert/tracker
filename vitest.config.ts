import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'lib/utils/empty-module.ts'),
    },
  },
});
