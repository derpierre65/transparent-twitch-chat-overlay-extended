import { configDefaults } from 'vitest/config';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: { input: { main: 'index.html', token: 'token.html', generator: 'generator.html' } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // The worker is its own package with node:test.
    exclude: [...configDefaults.exclude, 'chat-approval/worker/**'],
  },
});
