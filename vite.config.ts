import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // It is also disabled in any hosted/proxied preview (where the platform
      // injects PORT/DEV_PORT): behind a single-origin proxy Vite's HMR client
      // cannot reach its WebSocket (it targets Vite's default dev port), which
      // produces repeated "WebSocket closed without opened" errors. Local dev
      // (no PORT/DEV_PORT, no DISABLE_HMR) keeps HMR enabled.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr:
        process.env.DISABLE_HMR !== 'true' &&
        !process.env.PORT &&
        !process.env.DEV_PORT,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
