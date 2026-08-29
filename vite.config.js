import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    rollupOptions: {
      input: {
        // Al declarar `input`, Vite deja de autodetectar index.html: hay que
        // listar `main` explícitamente o dist/index.html desaparece.
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        overlay: fileURLToPath(new URL('./overlay.html', import.meta.url))
      }
    }
  }
});
