import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const registry = resolve(import.meta.dirname, "../../registry/fm");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    // `@/fm` mirrors where `shadcn add` places the registry files in a host app.
    alias: [
      { find: /^@\/fm\//, replacement: `${registry}/` },
      { find: /^@\//, replacement: `${resolve(import.meta.dirname, "src")}/` },
    ],
  },
  build: {
    // Measured 2026-11-04: the entry chunk is the runtime (react-dom, Base UI, TanStack, panels;
    // ~672 kB, 217 kB gzip), the Markdown plugin chunk is streamdown's pipeline (~708 kB) and the
    // largest lazy chunks are single shiki grammars (~790 kB). All are already split or loaded on demand.
    chunkSizeWarningLimit: 800,
  },
  // The app is reached through nsl / reverse-proxy hostnames that vary per machine.
  server: { host: "0.0.0.0", allowedHosts: true },
});
