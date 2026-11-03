import type { FmSidebarOptions } from "@/fm/react/file-manager";
import { useState } from "react";
import { sheetPlugin } from "@/fm/plugins/sheet";
import { FileManager } from "@/fm/react/file-manager";
import { FilePicker } from "@/fm/react/file-picker";
import { enLabels, zhLabels } from "@/fm/react/labels";

const plugins = [
  sheetPlugin(),
];

const labels = navigator.language.startsWith("zh")
  ? zhLabels
  : enLabels;

const params = new URLSearchParams(location.search);
const sidebar: FmSidebarOptions = {
  group: params.get("group") === "driver"
    ? "driver"
    : "none",
  hidden: params.get("hidden")?.split(",") ?? [],
};

const max = Number(params.get("max"));

function PickerDemo() {
  const [picked, setPicked] = useState("");
  return (
    <main className="flex h-svh flex-col gap-3 p-4">
      <h1 className="text-lg font-medium">File picker</h1>
      <FilePicker
        baseUrl="/api/fm"
        labels={labels}
        className="flex-1"
        accept={params.get("accept")?.split(",").filter(Boolean) ?? []}
        multiple={params.has("multiple")}
        {...(max > 0
          ? { maxTotalSize: max }
          : {})}
        onPick={entries => setPicked(entries.map(e => e.path).join("\n"))}
        onCancel={() => setPicked("cancelled")}
      />
      <output data-testid="fm-picked" className="text-sm whitespace-pre-line">{picked}</output>
    </main>
  );
}

function ManagerDemo() {
  const [readOnly, setReadOnly] = useState(() => new URLSearchParams(location.search).has("view"));
  return (
    <main className="flex h-svh flex-col gap-3 p-4">
      <header className="flex items-center gap-4">
        <h1 className="text-lg font-medium">File manager</h1>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} />
          View only
        </label>
      </header>
      <FileManager baseUrl="/api/fm" labels={labels} className="flex-1" readOnly={readOnly} plugins={plugins} sidebar={sidebar} />
    </main>
  );
}

export function App() {
  return params.has("pick")
    ? <PickerDemo />
    : <ManagerDemo />;
}
