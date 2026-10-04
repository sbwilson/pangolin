import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // The server swaps this placeholder for a per-request CSP nonce (story 1.5). Vite puts it on
  // the elements it emits and on a <meta property="csp-nonce">.
  html: { cspNonce: "__CSP_NONCE__" },
  plugins: [
    react(),
    // Compiled to a hashed stylesheet at build time, so the CSP needs no inline styles.
    tailwindcss(),
    VitePWA({
      // No inline registration script (the CSP allows none); src/main.tsx registers the worker.
      injectRegister: false,
      registerType: "prompt",
      manifest: {
        name: "Pangolin Money",
        short_name: "Pangolin",
        description: "Household money, privately.",
        start_url: "/",
        display: "standalone",
        background_color: "#f6f4ef",
        theme_color: "#2f4b3a",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // The page shell is never precached: the server injects a per-request CSP nonce into
        // it, so a cached copy would carry a stale nonce.
        globPatterns: ["**/*.{js,css}"],
        globIgnores: ["**/index.html"],
        navigateFallback: null,
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
