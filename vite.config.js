import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    watch: { ignored: ['**/tools/**', '**/dist/**'] },
  },
  build: { target: 'es2022', outDir: 'dist' },
});
