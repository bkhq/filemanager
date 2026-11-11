import type { FmEntry } from "@/fm/core/schema";
import type { FmSidebarOptions } from "@/fm/react/file-manager";
import type { FmMeta, FmRef } from "@/fm/react/meta";
import { LanguagesIcon, LayoutPanelLeftIcon, Maximize2Icon, MonitorIcon, MoonIcon, SlidersHorizontalIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { archivePlugin } from "@/fm/plugins/archive";
import { markdownPlugin } from "@/fm/plugins/markdown";
import { reviewPlugin } from "@/fm/plugins/review";
import { sheetPlugin } from "@/fm/plugins/sheet";
import { DriveManager } from "@/fm/react/drive-manager";
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
const LANG_KEY = "fm-web:lang";
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
    headerActions: "Header actions",
    options: "Options",
    language: "Language",
    view: "View",
    views: { workspace: "Workspace", drive: "Drive" },
    theme: "Theme",
    themes: { light: "Light", dark: "Dark", system: "System" },
  },
  zh: {
    title: "文件管理器",
    viewOnly: "只读",
    askMessage: "询问修改说明",
    mounted: "已挂载",
    headerActions: "标题栏按钮",
    options: "选项",
    language: "语言",
    view: "视图",
    views: { workspace: "工作区", drive: "网盘" },
    theme: "主题",
    themes: { light: "浅色", dark: "深色", system: "跟随系统" },
  },
} as const;

const langNames: Record<Lang, string> = { en: "English", zh: "中文" };

/** The view is read once at load, so switching rewrites `?variant` and reloads. */
function switchView(view: "workspace" | "drive") {
  const params = new URLSearchParams(location.search);
  if (view === "drive")
    params.set("variant", "drive");
  else
    params.delete("variant");
  location.search = params.toString();
}
const themeIcon = { light: <SunIcon />, dark: <MoonIcon />, system: <MonitorIcon /> };

/** Demo switch: ask for a change note before every change. */
const ASK_KEY = "fm-web:ask-message";

/** Starred / recent kept in localStorage; a real host would use its own database. */
const META_KEY = "fm-web:meta";
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

// e2e turns the lists off (`fm-web:meta-off` = "1") so they do not duplicate tree rows.
const meta = localStorage.getItem("fm-web:meta-off") === "1"
  ? undefined
  : demoMeta;

const params = new URLSearchParams(location.search);
const sidebar: FmSidebarOptions = {
  group: params.get("group") === "driver"
    ? "driver"
    : "none",
  hidden: [
    ...params.get("hidden")?.split(",") ?? [],
    // The shared space only serves the drive demo.
    ...(params.get("variant") === "drive"
      ? []
      : ["shared", "team"]),
  ],
  // `?review`: the tree shows changes only.
  drives: !params.has("review"),
};
// `?variant=drive`: the optional drive view (fm-drive item).
const drive = params.get("variant") === "drive";
const Manager = drive
  ? DriveManager
  : FileManager;
// Drive demo: an owner column from `entry.extra` and a host details tab.
function driveExtras(lang: Lang) {
  return drive
    ? {
        columns: [
          {
            id: "owner",
            label: lang === "zh"
              ? "所有者"
              : "Owner",
            filter: true,
          },
        ],
        detailTabs: [
          {
            id: "activity",
            label: lang === "zh"
              ? "动态"
              : "Activity",
            render: (e: FmEntry) => (
              <div className="grid gap-1 text-muted-foreground">
                <p>{`${e.name} · ${new Date(e.mtime).toLocaleString()}`}</p>
                {e.id && <p data-demo-id="">{`id: ${e.id}`}</p>}
              </div>
            ),
          },
        ],
      }
    : {};
}
const features = params.has("review")
  ? { starred: false, recent: false }
  : {};

const max = Number(params.get("max"));

/** Demo switch: a host control in the manager's top bar, as a panel's maximize button would be (`?actions` forces it on). */
const ACTIONS_KEY = "fm-web:header-actions";
const hostAction = <Button variant="ghost" size="icon-sm" aria-label="Host action" title="Host action"><Maximize2Icon /></Button>;

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
  const [headerActions, setHeaderActions] = useState(() => params.has("actions") || localStorage.getItem(ACTIONS_KEY) === "1");
  const changeHeaderActions = (on: boolean) => {
    localStorage.setItem(ACTIONS_KEY, on ? "1" : "0");
    setHeaderActions(on);
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
      {/* Below `sm` the toggles fold into one menu and the buttons keep only their icons. */}
      <header className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-lg font-medium">{text.title}</h1>
        <label className="mr-2 flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground max-sm:hidden">
          <Checkbox checked={mounted} onCheckedChange={setMounted} />
          {text.mounted}
        </label>
        <label className="mr-2 flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground max-sm:hidden">
          <Checkbox checked={askMessage} onCheckedChange={changeAskMessage} />
          {text.askMessage}
        </label>
        <label className="mr-2 flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground max-sm:hidden">
          <Checkbox checked={readOnly} onCheckedChange={setReadOnly} />
          {text.viewOnly}
        </label>
        {!drive && (
          <label className="mr-2 flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground max-sm:hidden">
            <Checkbox checked={headerActions} onCheckedChange={changeHeaderActions} />
            {text.headerActions}
          </label>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title={text.options} aria-label={text.options} className="sm:hidden" />}>
            <SlidersHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuCheckboxItem closeOnClick={false} checked={mounted} onCheckedChange={setMounted}>{text.mounted}</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem closeOnClick={false} checked={askMessage} onCheckedChange={changeAskMessage}>{text.askMessage}</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem closeOnClick={false} checked={readOnly} onCheckedChange={setReadOnly}>{text.viewOnly}</DropdownMenuCheckboxItem>
            {!drive && <DropdownMenuCheckboxItem closeOnClick={false} checked={headerActions} onCheckedChange={changeHeaderActions}>{text.headerActions}</DropdownMenuCheckboxItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={text.view} />}>
            <LayoutPanelLeftIcon />
            <span className="max-sm:hidden">
              {text.views[drive
                ? "drive"
                : "workspace"]}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuRadioGroup
              value={drive
                ? "drive"
                : "workspace"}
              onValueChange={switchView}
            >
              {(["workspace", "drive"] as const).map(v => <DropdownMenuRadioItem closeOnClick key={v} value={v}>{text.views[v]}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={text.language} />}>
            <LanguagesIcon />
            <span className="max-sm:hidden">{langNames[lang]}</span>
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
        <Manager
          baseUrl="/api/fm"
          labels={lang === "zh"
            ? zhLabels
            : enLabels}
          className="flex-1"
          readOnly={readOnly}
          plugins={plugins}
          sidebar={sidebar}
          features={features}
          {...driveExtras(lang)}
          {...(headerActions && !drive
            ? { headerActions: hostAction }
            : {})}
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
