import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { GEO_SLUGS, geoPlugin } from "./geo";

const ENGINE = process.env.YTDOWN_ENGINE ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [
    react(),
    geoPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "SnagOtter",
        short_name: "SnagOtter",
        description: "Free video and audio downloader for YouTube, Instagram, TikTok, Facebook and X.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        orientation: "any",
        background_color: "#F4F5F8",
        theme_color: "#F4F5F8",
        categories: ["utilities", "productivity"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
        share_target: { action: "/", method: "GET", params: { title: "title", text: "text", url: "url" } },
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/(llms\.txt|sitemap\.xml|robots\.txt)$/, ...GEO_SLUGS.map((s) => new RegExp(`^/${s}/?$`))],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [],
      },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy: { "/api": { target: ENGINE, changeOrigin: false } } },
  build: { target: "es2022", sourcemap: false },
});
