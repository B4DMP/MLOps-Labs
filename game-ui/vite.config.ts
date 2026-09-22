import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: process.env.VITE_BASE_PATH || env.VITE_BASE_PATH || '/',
    server: {
      watch: {
        usePolling: true,
      },
    },
    optimizeDeps: {
      // lottie-web is an *optional* peer dependency of @lordicon/react (the results screen's
      // medal animation), so esbuild's dependency scan does not always discover it as a
      // pre-bundle target on its own, which surfaces as "Could not resolve lottie-web" the first
      // time the page loads after install. Listing it explicitly makes the pre-bundle
      // deterministic instead of depending on scan timing/cache state.
      include: ['lottie-web'],
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/setupTests.ts'],
    },
  }
})
