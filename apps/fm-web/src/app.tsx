import type { FmSidebarOptions } from "@/fm/react/file-manager";
import type { FmMeta, FmRef } from "@/fm/react/meta";
import { LanguagesIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { archivePlugin } from "@/fm/plugins/archive";
import { markdownPlugin } from "@/fm/plugins/markdown";
import { reviewPlugin } from "@/fm/plugins/review";
import { sheetPlugin } from "@/fm/plugins/sheet";
import { FileManager } from "@/fm/react/file-manager";
import { FilePicker } from "@/fm/react/file-picker";
import { enLabels, zhLabels } from "@/fm/react/labels";

const plugins = [
  sheetPlugin(),
  markdownPlugin(),
  archivePlugin(),
  reviewPlugin(),
];

type Lang = "en" | "zh";
const LANG_KEY = "fm-demo:lang";
const initialLang: Lang = (localStorage.getItem(LANG_KEY) ?? navigator.language).startsWith("zh")
  ? "zh"
  : "en";
const labels = initialLang === "zh"
  ? zhLabels
  : enLabels;

const demoText = {
  en: {
    title: "File manager",
    viewOnly: "View only",
    askMessage: "Ask for change notes",
    mounted: "Mounted",
    language: "Language",
    theme: "Theme",
    themes: { light: "Light", dark: "Dark", system: "System" },
  },
  zh: {
    title: "文件管理器",
    viewOnly: "只读",
    askMessage: "询问修改说明",
    mounted: "已挂载",
    language: "语言",
    theme: "主题",
    themes: { light: "浅色", dark: "深色", system: "跟随系统" },
  },
} as const;

const langNames: Record<Lang, string> = { en: "English", zh: "中文" };
const themeIcon = { light: <SunIcon />, dark: <MoonIcon />, system: <MonitorIcon /> };

/** Demo switch: ask for a change note before every change. */
const ASK_KEY = "fm-demo:ask-message";

/** Starred / recent kept in localStorage; a real host would use its own database. */
const META_KEY = "fm-demo:meta";
interface DemoMeta { starred: FmRef[]; recent: FmRef[] }
function readMeta(): DemoMeta {
  try {
    const v = JSON.parse(localStorage.getItem(META_KEY) ?? "null") as Partial<DemoMeta> | null;
    return { starred: v?.starred ?? [], recent: v?.recent ?? [] };
  }
  catch {
    return { starred: [], recent: [] };
  }
}
function writeMeta(update: (m: DemoMeta) => DemoMeta) {
  localStorage.setItem(META_KEY, JSON.stringify(update(readMeta())));
}
const same = (a: FmRef) => (b: FmRef) => a.mount === b.mount && a.path === b.path;
const demoMeta: FmMeta = {
  starred: async () => readMeta().starred,
  setStarred: async (ref, on) => writeMeta(m => ({
    ...m,
    starred: on
      ? [
          ref,
          ...m.starred.filter(r => !same(ref)(r)),
        ]
      : m.starred.filter(r => !same(ref)(r)),
  })),
  recent: async () => readMeta().recent,
  touch: ref => writeMeta(m => ({
    ...m,
    recent: [
      ref,
      ...m.recent.filter(r => !same(ref)(r)),
    ].slice(0, 20),
  })),
};

// e2e turns the lists off (`fm-demo:meta-off` = "1") so they do not duplicate tree rows.
const meta = localStorage.getItem("fm-demo:meta-off") === "1"
  ? undefined
  : demoMeta;

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
  const [askMessage, setAskMessage] = useState(() => localStorage.getItem(ASK_KEY) === "1");
  const changeAskMessage = (on: boolean) => {
    localStorage.setItem(ASK_KEY, on ? "1" : "0");
    setAskMessage(on);
  };
  // Unmounting and mounting again keeps the query cache, as a host switching tabs would.
  const [mounted, setMounted] = useState(true);
  const [lang, setLang] = useState<Lang>(initialLang);
  const { theme, setTheme } = useTheme();
  const text = demoText[lang];
  const changeLang = (next: Lang) => {
    localStorage.setItem(LANG_KEY, next);
    setLang(next);
  };
  return (
    <main className="flex h-svh flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <h1 className="text-lg font-medium">{text.title}</h1>
        <span className="flex-1" />
        <label className="mr-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={mounted} onCheckedChange={setMounted} />
          {text.mounted}
        </label>
        <label className="mr-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={askMessage} onCheckedChange={changeAskMessage} />
          {text.askMessage}
        </label>
        <label className="mr-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={readOnly} onCheckedChange={setReadOnly} />
          {text.viewOnly}
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={text.language} />}>
            <LanguagesIcon />
            {langNames[lang]}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuRadioGroup value={lang} onValueChange={changeLang}>
              {(["en", "zh"] as const).map(l => <DropdownMenuRadioItem closeOnClick key={l} value={l}>{langNames[l]}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title={text.theme} aria-label={text.theme} />}>
            {themeIcon[theme]}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              {(["light", "dark", "system"] as const).map(t => (
                <DropdownMenuRadioItem closeOnClick key={t} value={t}>
                  {themeIcon[t]}
                  {text.themes[t]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {mounted && (
        <FileManager
          baseUrl="/api/fm"
          labels={lang === "zh"
            ? zhLabels
            : enLabels}
          className="flex-1"
          readOnly={readOnly}
          plugins={plugins}
          sidebar={sidebar}
          meta={meta}
          changeMessage={askMessage
            ? {
                mode: params.get("ask") === "required"
                  ? "required"
                  : "optional",
              }
            : undefined}
        />
      )}
    </main>
  );
}

export function App() {
  return params.has("pick")
    ? <PickerDemo />
    : <ManagerDemo />;
}
