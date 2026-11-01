import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@terra-os/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3001,
    watch: {
      usePolling: true,
      interval: 1000,
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/__pycache__/**',
        '../../apps/api/dist/**',
        '../../packages/types/dist/**',
      ],
    },
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
