import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Bind IPv4 explicitly so Tauri's localhost:1420 probe does not miss an [::1]-only listener.
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // File Viewer assets under public/ are large; watching them floods HMR.
      ignored: [
        "**/src-tauri/**",
        "**/public/vendor/**",
        "**/public/wasm/**",
        "**/public/file-viewer/**",
        "**/public/flyfish-viewer-assets.json",
        "**/*.wasm",
        "**/*.bcmap",
        "**/*.pfb",
      ],
    },
  },
}));
