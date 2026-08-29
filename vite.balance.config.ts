import { defineConfig } from 'vite';

export default defineConfig({
  root: 'balance-lab',
  base: './',
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: { outDir: '../.verify/balance-lab-dist', emptyOutDir: true },
});
