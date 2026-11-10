import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const row = (page: Page, path: string) => page.locator(`[data-path="${path}"]`);
const tree = (page: Page) => page.getByRole("tree");
function treeItem(page: Page, name: string, level?: number) {
  return tree(page).locator(level === undefined
    ? `[role=treeitem][aria-label="${name}"]`
    : `[role=treeitem][aria-level="${level}"][aria-label="${name}"]`);
}
const DIR = "/drive-e2e";

async function put(page: Page, path: string, body: string) {
  expect((await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent(path)}`, { data: body })).ok()).toBe(true);
}

async function openDrive(page: Page, path = "/", mount = "local") {
  await page.addInitScript(([key, p, m]) => {
    localStorage.setItem(key!, JSON.stringify({ mount: m, path: p }));
  }, ["fm:last", path, mount]);
  await page.goto("/?variant=drive");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  expect((await request.post("/api/fm/m/local/mkdir", {
    data: { path: DIR },
  })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.post("/api/fm/m/local/ops", {
    data: {
      op: "delete",
      paths: [DIR],
      permanent: true,
    },
  });
});

test("lists the folder chosen in the tree; the tree holds folders only", async ({ page }) => {
  await openDrive(page);
  await expect(treeItem(page, "Local disk", 2)).toBeVisible();
  await expect(treeItem(page, "notes", 3)).toBeVisible();
  // Files appear on the right, never in the tree.
  await expect(row(page, "/README.md")).toBeVisible();
  await expect(treeItem(page, "README.md")).toHaveCount(0);

  await treeItem(page, "notes", 3).getByRole("button").click();
  await expect(row(page, "/notes/todo.txt")).toBeVisible();
  await expect(treeItem(page, "notes", 3)).toHaveAttribute("aria-selected", "true");
  await expect(treeItem(page, "todo.txt")).toHaveCount(0);
  // Once listed, a folder without subfolders is a leaf: no chevron, not expandable.
  await expect(treeItem(page, "notes", 3)).not.toHaveAttribute("aria-expanded");
  await expect(treeItem(page, "Local disk", 2)).toHaveAttribute("aria-expanded", "true");

  await treeItem(page, "Scratch (memory)", 2).getByRole("button").click();
  await expect(page.getByRole("region", { name: "Scratch (memory)" })).toBeVisible();
  await expect(row(page, DIR)).toHaveCount(0);
});

test("shows folders without subfolders as leaves before they are opened", async ({ page }) => {
  expect((await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: `${DIR}/inner` },
  })).ok()).toBe(true);
  await openDrive(page);
  await expect(treeItem(page, "docs", 3)).toBeVisible();
  await expect(treeItem(page, "docs", 3)).not.toHaveAttribute("aria-expanded");
  await expect(treeItem(page, "drive-e2e", 3)).toHaveAttribute("aria-expanded", "false");
});

test("grid by default, with a list toggle", async ({ page }) => {
  await openDrive(page);
  await expect(page.getByRole("button", { name: "List view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Size", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByRole("button", { name: "Size", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Grid view" }).click();
});

test("opens files in the preview dialog and steps through the folder", async ({ page }) => {
  await openDrive(page, "/notes");
  await row(page, "/notes/config.json").dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("config.json");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog).toContainText("todo.txt");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // The folder stays listed; no inline editor.
  await expect(row(page, "/notes/todo.txt")).toBeVisible();
  await expect(page.locator(".cm-editor")).toHaveCount(0);
});

test("opens starred and recent files in the preview dialog", async ({ page }) => {
  await openDrive(page, "/notes");
  await row(page, "/notes/todo.txt").dblclick();
  await page.keyboard.press("Escape");
  await row(page, "/notes/config.json").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to starred" }).click();

  const starred = treeItem(page, "config.json, Local disk/notes");
  await expect(starred).toBeVisible();
  await starred.getByRole("button").click();
  await expect(page.getByRole("dialog")).toContainText("config.json");
  await page.keyboard.press("Escape");

  await treeItem(page, "todo.txt, Local disk/notes").getByRole("button").click();
  await expect(page.getByRole("dialog")).toContainText("todo.txt");
});

test("shows no changes, even with pending git changes", async ({ page }) => {
  const root = ".tmp/e2e-root";
  const git = (...args: string[]) => execFileSync("git", [
    "-c",
    "user.name=e2e",
    "-c",
    "user.email=e2e@x",
    ...args,
  ], { cwd: root, stdio: "ignore" });
  await put(page, `${DIR}/tracked.txt`, "one\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  try {
    await put(page, `${DIR}/tracked.txt`, "two\n");
    expect((await (await page.request.get("/api/fm/m/local/changes")).json()).changes.length).toBeGreaterThan(0);
    await openDrive(page, DIR);
    await expect(row(page, `${DIR}/tracked.txt`)).toBeVisible();
    await expect(treeItem(page, "Changes")).toHaveCount(0);
    await expect(page.locator("[data-fm-change]")).toHaveCount(0);
  }
  finally {
    await rm(`${root}/.git`, { recursive: true, force: true });
  }
});

test("filters by type from the filter bar", async ({ page }) => {
  await put(page, "/images/drive-note.txt", "x");
  await openDrive(page, "/images");
  await expect(row(page, "/images/drive-note.txt")).toBeVisible();
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Images" }).click();
  await page.keyboard.press("Escape");
  await expect(row(page, "/images/dot.png")).toBeVisible();
  await expect(row(page, "/images/drive-note.txt")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(row(page, "/images/drive-note.txt")).toBeVisible();
  await page.request.post("/api/fm/m/local/ops", {
    data: {
      op: "delete",
      paths: ["/images/drive-note.txt"],
      permanent: true,
    },
  });
});

test("creates a folder from the New menu; the tree shows it", async ({ page }) => {
  await openDrive(page, DIR);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("made-here");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(row(page, `${DIR}/made-here`)).toBeVisible();
  await expect(treeItem(page, "made-here")).toBeVisible();
});

test("acts on several entries from the batch bar", async ({ page }) => {
  await put(page, `${DIR}/one.txt`, "1");
  await put(page, `${DIR}/two.txt`, "2");
  await openDrive(page, DIR);
  await row(page, `${DIR}/one.txt`).click();
  await row(page, `${DIR}/two.txt`).click({
    modifiers: ["ControlOrMeta"],
  });
  const bar = page.getByRole("toolbar", { name: "2 selected" });
  await expect(bar.getByRole("button", { name: "Download" })).toBeVisible();
  await bar.getByRole("button", { name: "Delete" }).click();
  await expect(row(page, `${DIR}/one.txt`)).toHaveCount(0);
  await expect(row(page, `${DIR}/two.txt`)).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, `${DIR}/one.txt`)).toBeVisible();
  await expect(row(page, `${DIR}/two.txt`)).toBeVisible();
});

test("opens the trash of a space from the tree", async ({ page }) => {
  await openDrive(page);
  await tree(page).locator("[role=treeitem][aria-label=Trash]").first().getByRole("button").click();
  await expect(page.getByRole("button", { name: "Empty trash" })).toBeVisible();
});

test("groups spaces in the tree and shows the quota of the current one", async ({ page }) => {
  await openDrive(page);
  await expect(treeItem(page, "Personal", 1)).toHaveAttribute("aria-expanded", "true");
  await expect(treeItem(page, "Local disk", 2)).toBeVisible();
  await expect(treeItem(page, "Scratch (memory)", 2)).toBeVisible();
  await expect(treeItem(page, "Shared with me", 1)).toBeVisible();
  await expect(treeItem(page, "Team plans", 2)).toBeVisible();
  await expect(treeItem(page, "Read-only view", 1)).toBeVisible();
  const quota = page.locator("[data-fm-quota]");
  await expect(quota).toContainText(/ of 10(\.0)? GB used/);
  await expect(quota.getByRole("progressbar")).toBeVisible();
  await treeItem(page, "Team plans", 2).getByRole("button").click();
  await expect(page.getByRole("region", { name: "Team plans" })).toBeVisible();
  await expect(quota).toHaveCount(0);
});

test("shows host columns and filters by their values", async ({ page }) => {
  await openDrive(page, "/", "shared");
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Owner" })).toBeVisible();
  await expect(row(page, "/roadmap.md").locator("[data-fm-column=owner]")).toHaveText("Ada");
  await expect(row(page, "/budget.csv").locator("[data-fm-column=owner]")).toHaveText("Bo");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Ada" }).click();
  await page.keyboard.press("Escape");
  await expect(row(page, "/roadmap.md")).toBeVisible();
  await expect(row(page, "/designs")).toBeVisible();
  await expect(row(page, "/budget.csv")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove filter: Owner: Ada" }).click();
  await expect(row(page, "/budget.csv")).toBeVisible();
  await page.getByRole("button", { name: "Grid view" }).click();
});

test("shows host tabs in the details panel", async ({ page }) => {
  await openDrive(page, "/", "shared");
  await row(page, "/roadmap.md").click();
  await page.getByRole("button", { name: "Details" }).click();
  const details = page.getByRole("complementary", { name: "Details" });
  await expect(details).toContainText("Ada");
  await details.getByRole("tab", { name: "Activity" }).click();
  await expect(details.getByRole("tabpanel", { name: "Activity" })).toContainText("roadmap.md");
  await page.getByRole("button", { name: "Details" }).click();
});

test("moves into another folder with Move to…, and undoes it", async ({ page }) => {
  await put(page, `${DIR}/moving.txt`, "m");
  expect((await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: `${DIR}/target` },
  })).ok()).toBe(true);
  await openDrive(page, DIR);
  await row(page, `${DIR}/moving.txt`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const dialog = page.getByRole("dialog", { name: "Move to…" });
  await dialog.getByRole("button", { name: "drive-e2e" }).click();
  // Moving back into its own folder is pointless.
  await expect(dialog.getByRole("button", { name: "Move here" })).toBeDisabled();
  await dialog.getByRole("button", { name: "target" }).click();
  await dialog.getByRole("button", { name: "Move here" }).click();
  await expect(row(page, `${DIR}/moving.txt`)).toHaveCount(0);
  expect((await page.request.get(`/api/fm/m/local/stat?path=${encodeURIComponent(`${DIR}/target/moving.txt`)}`)).ok()).toBe(true);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, `${DIR}/moving.txt`)).toBeVisible();
});

test("copies into another space with Copy to… from the batch bar", async ({ page }) => {
  await put(page, `${DIR}/copied.txt`, "c");
  await openDrive(page, DIR);
  await row(page, `${DIR}/copied.txt`).click();
  await page.getByRole("toolbar", { name: "1 selected" }).getByRole("button", { name: "Copy to…" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy to…" });
  await dialog.getByRole("button", { name: "Scratch (memory)" }).click();
  await dialog.getByRole("button", { name: "Copy here" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await page.request.get("/api/fm/m/scratch/stat?path=%2Fcopied.txt")).ok()).toBe(true);
  await expect(row(page, `${DIR}/copied.txt`)).toBeVisible();
  await page.request.post("/api/fm/m/scratch/ops", {
    data: {
      op: "delete",
      paths: ["/copied.txt"],
      permanent: true,
    },
  });
});

test("keeps deleted files in a database-style space's own trash, with its expiry", async ({ page }) => {
  await openDrive(page, "/", "team");
  await expect(page.getByRole("region", { name: "Team drive" })).toBeVisible();
  await row(page, "/brief.md").click();
  await page.getByRole("toolbar", { name: "1 selected" }).getByRole("button", { name: "Delete" }).click();
  await expect(row(page, "/brief.md")).toHaveCount(0);
  // The Trash row that follows the Team drive row.
  await treeItem(page, "Team drive", 2).locator("xpath=following-sibling::*[@role='treeitem'][@aria-label='Trash'][1]").getByRole("button").click();
  const trashRow = page.getByRole("row").filter({ hasText: "brief.md" });
  await expect(trashRow).toContainText("In 14 days");
  await trashRow.getByRole("button", { name: "Restore" }).click();
  await treeItem(page, "Team drive", 2).getByRole("button").click();
  await expect(row(page, "/brief.md")).toBeVisible();
});

test("keeps an entry's id across a rename", async ({ page }) => {
  await openDrive(page, "/", "team");
  await row(page, "/notes.txt").click();
  await page.getByRole("button", { name: "Details" }).click();
  const details = page.getByRole("complementary", { name: "Details" });
  await details.getByRole("tab", { name: "Activity" }).click();
  const id = (await details.locator("[data-demo-id]").textContent())!;
  expect(id).toMatch(/^id: e_/);
  await page.getByRole("toolbar", { name: "1 selected" }).getByRole("button", { name: "Rename" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("renamed-notes.txt");
  await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
  await row(page, "/renamed-notes.txt").click();
  await details.getByRole("tab", { name: "Activity" }).click();
  await expect(details.locator("[data-demo-id]")).toHaveText(id);
  await page.getByRole("button", { name: "Details" }).click();
});

test("shows the tree, then the folder, on narrow containers", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await openDrive(page);
  await expect(tree(page)).toBeVisible();
  await treeItem(page, "notes", 3).getByRole("button").click();
  await expect(row(page, "/notes/todo.txt")).toBeVisible();
  await expect(tree(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Back to folders" }).click();
  await expect(tree(page)).toBeVisible();
});

async function putPng(page: Page, path: string) {
  await page.goto("/");
  expect(await page.evaluate(async (path) => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 600, height: 300 });
    canvas.getContext("2d")!.fillRect(0, 0, 600, 300);
    const blob = await new Promise<Blob>(done => canvas.toBlob(b => done(b!), "image/png"));
    return (await fetch(`/api/fm/m/local/write?path=${encodeURIComponent(path)}&conflict=overwrite`, { method: "PUT", body: blob })).ok;
  }, path)).toBe(true);
}

test("keeps the toolbars in place and floats the bulk bar over the list", async ({ page }) => {
  await put(page, `${DIR}/float.txt`, "1");
  await openDrive(page, DIR);
  const filter = page.getByRole("button", { name: "Filter" });
  await expect(filter).toBeVisible();
  const before = await filter.boundingBox();
  await row(page, `${DIR}/float.txt`).click();
  const bar = page.getByRole("toolbar", { name: "1 selected" });
  await expect(bar).toBeVisible();
  await expect(filter).toBeVisible();
  expect(await filter.boundingBox()).toEqual(before);
  const box = (await bar.boundingBox())!;
  const list = (await page.getByRole("grid").boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(list.y + list.height - 40);
});

test("groups navigation and creation apart from the view controls", async ({ page }) => {
  await openDrive(page);
  const y = async (name: string) => (await page.getByRole("button", { name, exact: true }).boundingBox())!.y;
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  expect(await y("Upload")).toBeLessThan(await y("Filter") - 10);
  expect(await y("Details")).toBe(await y("Filter"));
  const search = (await page.getByRole("searchbox").boundingBox())!;
  expect(search.y).toBeGreaterThan(await y("Upload") + 10);
});

test("opens the entry menu from the row more button", async ({ page }) => {
  await put(page, `${DIR}/more.txt`, "1");
  await openDrive(page, DIR);
  const target = row(page, `${DIR}/more.txt`);
  for (const view of ["Grid", "List"]) {
    await target.hover();
    await target.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await expect(target).toHaveAttribute("aria-selected", "true");
    // Stays visible while its menu is open, even with the pointer inside the menu.
    await page.getByRole("menuitem", { name: "Rename" }).hover();
    await expect(target.locator("button[aria-label=More]")).toHaveCSS("opacity", "1");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
    if (view === "Grid")
      await page.getByRole("button", { name: "List view" }).click();
  }
});

test("shows thumbnails in the list and square tiles in the grid", async ({ page }) => {
  await putPng(page, `${DIR}/pic.png`);
  await openDrive(page, DIR);
  const target = row(page, `${DIR}/pic.png`);
  const face = target.locator("[data-fm-face]");
  await expect(face).toBeVisible();
  const box = (await face.boundingBox())!;
  expect(box.width).toBe(box.height);
  await page.getByRole("button", { name: "List view" }).click();
  const img = target.locator("img");
  await expect(img).toHaveAttribute("src", /\/thumb\?.*w=256/);
  expect((await img.boundingBox())!.width).toBe(24);
});

test("hides list columns by container width", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await openDrive(page);
  await treeItem(page, "notes", 3).getByRole("button").click();
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByRole("button", { name: "Name", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Size", exact: true })).toBeHidden();
});

test("each path step opens a picker; folders navigate", async ({ page }) => {
  await openDrive(page, DIR);
  const bar = page.getByRole("navigation", { name: "Path" });
  await bar.getByRole("button", { name: "drive-e2e" }).click();
  await page.getByRole("menuitem", { name: "notes" }).click();
  await expect(row(page, "/notes/todo.txt")).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(bar).toContainText("notes");
});

test("switches between the workspace and drive views from the demo header", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Drive" }).click();
  await expect(page).toHaveURL(/[?&]variant=drive/);
  await expect(page.getByRole("button", { name: "View", exact: true })).toContainText("Drive");
  await expect(treeItem(page, "Shared with me", 1)).toBeVisible();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Workspace" }).click();
  await expect(page).not.toHaveURL(/variant=drive/);
  await expect(page.getByRole("button", { name: "View", exact: true })).toContainText("Workspace");
});
