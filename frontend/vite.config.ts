import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const proxy = {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: ['localhost', '127.0.0.1'], proxy },
  preview: { allowedHosts: ['localhost', '127.0.0.1'], proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
