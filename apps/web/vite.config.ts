/// <reference types="node" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const require = createRequire(import.meta.url);

// Every build has its own id, published as /version.json so a running app can tell it is out of date (src/lib/update.ts).
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 12) || new Date().toISOString().replace(/\D/g, "").slice(0, 14) + Math.random().toString(36).slice(2, 6);
function versionFile(): Plugin {
  return {
    name: "boekenwurm-version",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: BUILD_ID }) });
    },
  };
}

// "/" on Cloudflare Pages and in development; set VITE_BASE when hosting under a sub-path.
const base = process.env.VITE_BASE || "/";

/**
 * Free page reading runs Tesseract on the device. Its worker, engine and Dutch model are copied into the app
 * (under /tesseract/) instead of being fetched from a CDN, so the content-security policy can stay "self only".
 */
const TESSERACT_FILES: Array<[string, string]> = [
  [require.resolve("tesseract.js/dist/worker.min.js"), "worker.min.js"],
  ...["tesseract-core-lstm", "tesseract-core-simd-lstm", "tesseract-core-relaxedsimd-lstm"].map(
    (f): [string, string] => [join(dirname(require.resolve("tesseract.js-core/package.json")), `${f}.wasm.js`), `${f}.wasm.js`],
  ),
  [join(dirname(require.resolve("@tesseract.js-data/nld/package.json")), "4.0.0_best_int", "nld.traineddata.gz"), "nld.traineddata.gz"],
];
function tesseractAssets(): Plugin {
  let outDir = "dist";
  return {
    name: "boekenwurm-tesseract-assets",
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/tesseract\/([\w.-]+)$/);
        const hit = m && TESSERACT_FILES.find(([, name]) => name === m[1]);
        if (!hit) return next();
        res.setHeader("content-type", hit[1].endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(hit[0]));
      });
    },
    closeBundle() {
      mkdirSync(join(outDir, "tesseract"), { recursive: true });
      for (const [from, name] of TESSERACT_FILES) if (existsSync(from)) copyFileSync(from, join(outDir, "tesseract", name));
    },
  };
}

/**
 * Content-security policy for the built app (the dev server needs inline scripts, so only in builds). Scripts
 * only from this site; network only to Supabase, Anthropic (with the reader's own key) and the fonts. Book text
 * and photos can't be sent anywhere else.
 */
function contentSecurityPolicy(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://fonts.googleapis.com https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "boekenwurm-csp",
    apply: "build",
    transformIndexHtml: (html) => html.replace("<!--CSP-->", `<meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tesseractAssets(),
    contentSecurityPolicy(),
    versionFile(),
    VitePWA({
      registerType: "autoUpdate",
      // Registered in src/main.tsx, so a new version takes over as soon as it is downloaded.
      injectRegister: false,
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon.svg"],
      manifest: {
        id: base,
        name: "Boekenwurm",
        short_name: "Boekenwurm",
        description: "Read Dutch books you own, at your level.",
        lang: "en",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#f2f5ef",
        theme_color: "#2d7a4c",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app shell is precached; the big on-device reading files are cached the first time they are used.
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        globIgnores: ["tesseract/**", "dict/**"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // A new version takes over at once (with the reload in src/main.tsx), and old caches are cleared.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/tesseract/"),
            handler: "CacheFirst",
            options: { cacheName: "boekenwurm-reader-model", expiration: { maxEntries: 8 } },
          },
          {
            // The open dictionary: served from the cache at once, refreshed in the background after a new deploy.
            urlPattern: ({ url }) => url.pathname.endsWith("/dict/nl.json"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "boekenwurm-dictionary", expiration: { maxEntries: 2 } },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "boekenwurm-fonts", expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@boekenwurm/engine": join(repo, "packages", "engine", "src", "index.ts"),
      "@boekenwurm/dutch": join(repo, "packages", "dutch", "src", "lemma.ts"),
      "@boekenwurm/ai": join(repo, "packages", "ai", "src", "index.ts"),
      "@boekenwurm/books": join(repo, "packages", "books", "src", "index.ts"),
      "@data": join(repo, "data"),
    },
  },
  server: { fs: { allow: [repo] } },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 1200 },
});
