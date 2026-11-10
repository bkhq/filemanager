import { describe, expect, it } from "bun:test";
import { enLabels, zhLabels } from "./labels";
import { FM_SHORTCUT_GROUPS, FM_SHORTCUTS, formatKeys, opensShortcuts, shortcutText } from "./shortcuts";

describe("shortcut catalog", () => {
  it("has unique ids", () => {
    const ids = FM_SHORTCUTS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels every entry and group in English and Chinese", () => {
    for (const s of FM_SHORTCUTS) {
      expect(enLabels.shortcutLabels[s.label]).toBeTruthy();
      expect(zhLabels.shortcutLabels[s.label]).toBeTruthy();
      expect(FM_SHORTCUT_GROUPS).toContain(s.group);
    }
    for (const g of FM_SHORTCUT_GROUPS) {
      expect(enLabels.shortcutGroups[g]).toBeTruthy();
      expect(zhLabels.shortcutGroups[g]).toBeTruthy();
    }
    expect(enLabels.keyboardShortcuts).toBe("Keyboard shortcuts");
    expect(zhLabels.keyboardShortcuts).toBeTruthy();
  });
});

describe("shortcut formatting", () => {
  // The strings the context menus showed before the catalog.
  const old = {
    open: ["↩", "Enter"],
    copy: ["⌘C", "Ctrl+C"],
    cut: ["⌘X", "Ctrl+X"],
    paste: ["⌘V", "Ctrl+V"],
    copyPath: ["⌥⌘C", "Ctrl+Alt+C"],
    copyRelativePath: ["⇧⌥⌘C", "Ctrl+Shift+Alt+C"],
    rename: ["F2", "F2"],
    delete: ["⌦", "Del"],
  } as const;

  it("reproduces the menu shortcut strings on Mac and elsewhere", () => {
    for (const [id, [mac, other]] of Object.entries(old)) {
      expect(shortcutText(id as keyof typeof old, true)).toBe(mac);
      expect(shortcutText(id as keyof typeof old, false)).toBe(other);
    }
  });

  it("formats plain keys, arrows and a lone plus", () => {
    expect(formatKeys("Shift+ArrowUp", true)).toBe("⇧↑");
    expect(formatKeys("Shift+ArrowUp", false)).toBe("Shift+↑");
    expect(formatKeys("+", false)).toBe("+");
    expect(formatKeys("?", true)).toBe("?");
    expect(formatKeys("Mod+S", false)).toBe("Ctrl+S");
  });
});

describe("opensShortcuts", () => {
  const target = (inField: boolean) => ({
    closest: () => (inField
      ? {}
      : null),
  }) as unknown as EventTarget;
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; inField: boolean }> = {}) => ({
    key: k,
    ctrlKey: !!extra.ctrlKey,
    metaKey: !!extra.metaKey,
    altKey: !!extra.altKey,
    target: target(!!extra.inField),
  });

  it("opens on ? outside text fields when nothing else is open", () => {
    expect(opensShortcuts(key("?"), false)).toBe(true);
  });

  it("ignores other keys, modifiers, text fields and open overlays", () => {
    expect(opensShortcuts(key("/"), false)).toBe(false);
    expect(opensShortcuts(key("?", { ctrlKey: true }), false)).toBe(false);
    expect(opensShortcuts(key("?", { metaKey: true }), false)).toBe(false);
    expect(opensShortcuts(key("?", { altKey: true }), false)).toBe(false);
    expect(opensShortcuts(key("?", { inField: true }), false)).toBe(false);
    expect(opensShortcuts(key("?"), true)).toBe(false);
  });
});
