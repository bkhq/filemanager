import type { FmSidebarOptions } from "@/fm/react/file-manager";
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
import { markdownPlugin } from "@/fm/plugins/markdown";
import { sheetPlugin } from "@/fm/plugins/sheet";
import { FileManager } from "@/fm/react/file-manager";
import { FilePicker } from "@/fm/react/file-picker";
import { enLabels, zhLabels } from "@/fm/react/labels";

const plugins = [
  sheetPlugin(),
  markdownPlugin(),
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
    language: "Language",
    theme: "Theme",
    themes: { light: "Light", dark: "Dark", system: "System" },
  },
  zh: {
    title: "文件管理器",
    viewOnly: "只读",
    language: "语言",
    theme: "主题",
    themes: { light: "浅色", dark: "深色", system: "跟随系统" },
  },
} as const;

const langNames: Record<Lang, string> = { en: "English", zh: "中文" };
const themeIcon = { light: <SunIcon />, dark: <MoonIcon />, system: <MonitorIcon /> };

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
      <FileManager
        baseUrl="/api/fm"
        labels={lang === "zh"
          ? zhLabels
          : enLabels}
        className="flex-1"
        readOnly={readOnly}
        plugins={plugins}
        sidebar={sidebar}
      />
    </main>
  );
}

export function App() {
  return params.has("pick")
    ? <PickerDemo />
    : <ManagerDemo />;
}
