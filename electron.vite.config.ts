import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig(({ command }) => {
  const development = command === 'serve';
  const policy = [
    "default-src 'self'",
    `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    `style-src 'self'${development ? " 'unsafe-inline'" : ''}`,
    `connect-src ${development ? "'self' ws://127.0.0.1:5173" : "'none'"}`,
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');

  return {
    main: {
      build: {
        externalizeDeps: false,
        rollupOptions: {
          input: resolve('src/backend/electron/main.ts'),
          output: { format: 'cjs', entryFileNames: 'index.cjs' },
        },
      },
    },
    preload: {
      build: {
        // Sandboxed preloads cannot require application dependencies at runtime.
        externalizeDeps: false,
        rollupOptions: {
          input: resolve('src/backend/preload/preload.ts'),
          output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true },
        },
      },
    },
    renderer: {
      root: resolve('src/frontend/react'),
      base: './',
      plugins: [
        react(),
        {
          name: 'renderer-content-security-policy',
          transformIndexHtml: (html) => html.replace('__APP_CSP__', policy),
        },
      ],
      server: { host: '127.0.0.1', port: 5173, strictPort: true },
      build: { minify: 'esbuild', rollupOptions: { input: resolve('src/frontend/react/index.html') } },
    },
  };
});
