import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";
import { FileManager } from "@/fm/react/file-manager";
import { enLabels, zhLabels } from "@/fm/react/labels";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});
const labels = navigator.language.startsWith("zh")
  ? zhLabels
  : enLabels;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <main className="flex h-svh flex-col gap-3 p-4">
          <h1 className="text-lg font-medium">File manager demo</h1>
          <FileManager baseUrl="/api/fm" labels={labels} className="flex-1" />
        </main>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
