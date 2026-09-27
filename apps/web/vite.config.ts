import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // No inline registration script, ready for the CSP that story 1.5 adds;
      // src/main.tsx registers the worker itself.
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
        // The page shell is never precached. From story 1.5 the server will inject a per-request
        // CSP nonce into it, so a cached copy would carry a stale nonce.
        globPatterns: ["**/*.{js,css}"],
        globIgnores: ["**/index.html"],
        navigateFallback: null,
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
