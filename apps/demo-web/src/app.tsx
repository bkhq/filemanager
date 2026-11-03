import { useState } from "react";
import { FileManager } from "@/fm/react/file-manager";
import { enLabels, zhLabels } from "@/fm/react/labels";

const labels = navigator.language.startsWith("zh")
  ? zhLabels
  : enLabels;

export function App() {
  const [readOnly, setReadOnly] = useState(() => new URLSearchParams(location.search).has("view"));
  return (
    <main className="flex h-svh flex-col gap-3 p-4">
      <header className="flex items-center gap-4">
        <h1 className="text-lg font-medium">File manager demo</h1>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} />
          View only
        </label>
      </header>
      <FileManager baseUrl="/api/fm" labels={labels} className="flex-1" readOnly={readOnly} />
    </main>
  );
}
