import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { localApiPlugin } from './src/server/local-api';

export default defineConfig({
  plugins: [
    react(),
    localApiPlugin(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
  },
});
