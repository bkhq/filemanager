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
  server: { host: "0.0.0.0" },
});
