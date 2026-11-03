#!/usr/bin/env bash
# Installs every registry item into a scratch app with non-default aliases
# (like a real host), then typechecks and builds it. Needs network access.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$ROOT/.tmp/registry-smoke
PORT=${SMOKE_PORT:-4318}

cd "$ROOT"
bun run registry:build >/dev/null
rm -rf "$WORK" && mkdir -p "$WORK/src"

bun -e "Bun.serve({ port: $PORT, fetch: r => new Response(Bun.file('$ROOT/public' + new URL(r.url).pathname)) })" &
SERVER=$!
trap 'kill $SERVER' EXIT

cd "$WORK"
cat > package.json <<'JSON'
{ "name": "smoke", "type": "module", "private": true }
JSON
cat > components.json <<JSON
{
  "\$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/index.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/shared/components",
    "utils": "@/shared/lib/utils",
    "ui": "@/shared/components/ui",
    "lib": "@/shared/lib",
    "hooks": "@/shared/hooks"
  },
  "registries": { "@bkhq": "http://localhost:$PORT/r/{name}.json" }
}
JSON
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client", "bun"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
JSON
cat > vite.config.ts <<'TS'
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
});
TS
cat > index.html <<'HTML'
<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
HTML
echo '@import "tailwindcss";' > src/index.css

bun add react react-dom >/dev/null
bun add -d vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react @types/react-dom @types/bun "typescript@npm:typescript@7" >/dev/null
bunx shadcn add -y @bkhq/fm-react @bkhq/fm-plugin-sheet @bkhq/fm-server @bkhq/fm-driver-memory @bkhq/fm-driver-local @bkhq/fm-driver-s3 @bkhq/fm-driver-contract

cat > src/main.tsx <<'TSX'
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { sheetPlugin } from "@/fm/plugins/sheet";
import { FileManager } from "@/fm/react/file-manager";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <FileManager baseUrl="/api/fm" plugins={[sheetPlugin()]} />
  </QueryClientProvider>,
);
TSX
cat > src/server.ts <<'TS'
import { Hono } from "hono";
import { localDriver } from "@/fm/drivers/local";
import { memoryDriver } from "@/fm/drivers/memory";
import { s3Driver } from "@/fm/drivers/s3";
import { createFmRouter } from "@/fm/server/router";

export const app = new Hono().route("/api/fm", createFmRouter({
  mounts: () => [
    { id: "mem", label: "Memory", driver: memoryDriver() },
    { id: "disk", label: "Disk", driver: localDriver({ root: "/tmp" }) },
    { id: "s3", label: "S3", driver: s3Driver({ endpoint: "http://s3", bucket: "b", accessKeyId: "a", secretAccessKey: "s" }) },
  ],
}));
TS

echo "== ui imports rewritten to host aliases:"
grep -h '^import .*@/shared' src/fm/react/*.tsx | sort -u
if grep -rq '@/components/ui\|@/lib/utils' src/fm; then
  echo "unrewritten shadcn imports left in src/fm" >&2
  exit 1
fi
bunx tsc --noEmit -p tsconfig.json
bunx vite build >/dev/null
echo "registry smoke: OK"
