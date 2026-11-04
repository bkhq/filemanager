import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const row = (page: Page, path: string) => page.locator(`[data-path="${path}"]`);
const fileList = (page: Page) => page.locator("[role=grid]");

/** Switches mounts through the storage menu of the single layout. */
async function switchMount(page: Page, label: string) {
  await page.getByRole("button", { name: "Storage" }).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}

async function openTrash(page: Page) {
  await page.getByRole("button", { name: "Storage" }).click();
  await page.getByRole("menuitem", { name: "Trash" }).click();
}

/** Opens a mount in the list layout (the default for these tests). */
async function openMount(page: Page, label: string) {
  await page.goto("/");
  await switchMount(page, label);
}

/** Starts this test in the split layout: tree on the left, preview on the right. */
async function startWithTree(page: Page) {
  await page.addInitScript(() => localStorage.setItem("fm:layout", "split"));
}

async function openTreeMount(page: Page, label: string) {
  await startWithTree(page);
  await page.goto("/");
  const item = page.getByRole("tree").getByRole("treeitem", { name: label, exact: true });
  await item.getByRole("button").click();
  // A click toggles; the default mount starts expanded.
  if (await item.getAttribute("aria-expanded") === "false")
    await item.getByRole("button").click();
}

async function contextAction(page: Page, path: string, action: string) {
  await row(page, path).click({ button: "right" });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

// Most tests act on the file list, which the split layout replaces with the preview.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("fm:layout"))
      localStorage.setItem("fm:layout", "single");
  });
});

test("browses folders with the list and breadcrumb", async ({ page }) => {
  await openMount(page, "Local disk");
  for (const p of [
    "/docs",
    "/images",
    "/notes",
    "/README.md",
  ])
    await expect(row(page, p)).toBeVisible();
  await row(page, "/notes").dblclick();
  await expect(row(page, "/notes/config.json")).toBeVisible();
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await expect(row(page, "/README.md")).toBeVisible();
  await row(page, "/images").dblclick();
  await expect(row(page, "/images/dot.png")).toBeVisible();
});

test("creates a folder, uploads into it and renames", async ({ page }) => {
  await openMount(page, "Local disk");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("e2e");
  await page.getByRole("button", { name: "Create" }).click();
  await row(page, "/e2e").dblclick();
  await expect(page.getByText("This folder is empty")).toBeVisible();

  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles([
    {
      name: "hello.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello from e2e"),
    },
    {
      name: "hello2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("second"),
    },
  ]);
  await expect(row(page, "/e2e/hello.txt")).toBeVisible();
  await expect(row(page, "/e2e/hello2.txt")).toBeVisible();
  await expect(page.getByRole("status").locator("[data-status=done]")).toHaveCount(2);

  await contextAction(page, "/e2e/hello2.txt", "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("renamed.txt");
  await page.keyboard.press("Enter");
  await expect(row(page, "/e2e/renamed.txt")).toBeVisible();
  await expect(row(page, "/e2e/hello2.txt")).toHaveCount(0);
});

test("previews and edits a text file", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/e2e").dblclick();
  await row(page, "/e2e/hello.txt").dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".cm-content")).toContainText("hello from e2e");
  await dialog.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (edited)");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Saved")).toBeVisible();
  await page.keyboard.press("Escape");

  const res = await page.request.get("/api/fm/m/local/read?path=/e2e/hello.txt");
  expect(await res.text()).toBe("hello from e2e (edited)");
});

test("previews images and pdfs", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/images").dblclick();
  await row(page, "/images/dot.png").dblclick();
  await expect(page.getByRole("dialog").locator("img[alt='dot.png']")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await row(page, "/docs").dblclick();
  await row(page, "/docs/sample.pdf").dblclick();
  await expect(page.getByRole("dialog").locator("iframe[title='sample.pdf']")).toBeVisible();
});

test("rotates, flips and zooms an image without changing it", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/images").dblclick();
  await row(page, "/images/dot.png").dblclick();
  const dialog = page.getByRole("dialog");
  const img = dialog.locator("img[alt='dot.png']");
  await expect(dialog.getByRole("button", { name: "100%" })).toBeVisible();
  await dialog.getByRole("button", { name: "Rotate right" }).click();
  await dialog.getByRole("button", { name: "Flip horizontally" }).click();
  await expect(img).toHaveAttribute("style", /rotate\(90deg\) scaleX\(-1\)/);
  await dialog.getByRole("button", { name: "Rotate left" }).click();
  await expect(img).toHaveAttribute("style", /rotate\(0deg\)/);
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect(dialog.getByRole("button", { name: "125%" })).toBeVisible();
  await dialog.getByRole("button", { name: "125%" }).click();
  await expect(dialog.getByRole("button", { name: "100%" })).toBeVisible();
});

test("previews spreadsheets with the sheet plugin", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/sheets").dblclick();
  await row(page, "/sheets/ports.csv").dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("table")).toContainText("Valletta, Grand Harbour");
  await dialog.getByRole("button", { name: "Previous" }).click();
  await expect(dialog.getByRole("table", { name: "Fleet" })).toContainText("Thalassa");
  await dialog.getByRole("button", { name: "Crew" }).click();
  await expect(dialog.getByRole("table", { name: "Crew" })).toContainText("Captain");
});

test("moves with cut and paste", async ({ page }) => {
  await openMount(page, "Local disk");
  await contextAction(page, "/README.md", "Cut");
  await row(page, "/e2e").dblclick();
  await fileList(page).click({
    button: "right",
    position: { x: 300, y: 300 },
  });
  await page.getByRole("menuitem", { name: "Paste" }).click();
  await expect(row(page, "/e2e/README.md")).toBeVisible();
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await expect(row(page, "/README.md")).toHaveCount(0);
});

test("drags entries onto a folder row to move them", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/e2e").dblclick();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("inner");
  await page.getByRole("button", { name: "Create" }).click();
  await row(page, "/e2e/renamed.txt").dragTo(row(page, "/e2e/inner"));
  await expect(row(page, "/e2e/renamed.txt")).toHaveCount(0);
  await row(page, "/e2e/inner").dblclick();
  await expect(row(page, "/e2e/inner/renamed.txt")).toBeVisible();
});

async function newFolderWithFile(page: Page, name: string, file: string) {
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await row(page, `/${name}`).dblclick();
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles([
    {
      name: file,
      mimeType: "text/plain",
      buffer: Buffer.from(`content of ${file}`),
    },
  ]);
  await expect(row(page, `/${name}/${file}`)).toBeVisible();
  await page.getByRole("button", { name: "Up", exact: true }).click();
}

test("copies a folder from Local disk to Scratch with paste", async ({ page }) => {
  await openMount(page, "Local disk");
  await newFolderWithFile(page, "xm-paste", "inside.txt");
  await contextAction(page, "/xm-paste", "Copy");
  await switchMount(page, "Scratch (memory)");
  await expect(row(page, "/README.md")).toBeVisible();
  await fileList(page).click({
    button: "right",
    position: { x: 300, y: 300 },
  });
  await page.getByRole("menuitem", { name: "Paste" }).click();
  await row(page, "/xm-paste").dblclick();
  await expect(row(page, "/xm-paste/inside.txt")).toBeVisible();
  await switchMount(page, "Local disk");
  await expect(row(page, "/xm-paste")).toBeVisible();
});

test("drags tree rows onto folders: moves within a mount, copies to another", async ({ page }) => {
  await openMount(page, "Local disk");
  await newFolderWithFile(page, "xm-drop", "dropped.txt");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("xm-target");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(row(page, "/xm-target")).toBeVisible();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  const tree = page.getByRole("tree");
  const item = (name: string) => tree.getByRole("treeitem", { name, exact: true });
  await item("xm-drop").click();
  await item("dropped.txt").dragTo(item("xm-target"));
  await expect(item("dropped.txt")).toHaveCount(0);
  await item("xm-target").click();
  await expect(item("dropped.txt")).toBeVisible();

  await item("dropped.txt").dragTo(item("Scratch (memory)"));
  await item("Scratch (memory)").click();
  await expect(tree.getByRole("treeitem", { name: "dropped.txt", exact: true })).toHaveCount(2);
});

test("copies a text file's contents to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMount(page, "Local disk");
  await row(page, "/notes").dblclick();
  await contextAction(page, "/notes/todo.txt", "Copy contents");
  await expect(page.getByRole("status").filter({ hasText: "Contents copied to the clipboard" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("- try rename\n- try drag and drop\n");
  await row(page, "/notes/config.json").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Copy contents" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await row(page, "/images").dblclick();
  await row(page, "/images/dot.png").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Download" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy contents" })).toHaveCount(0);
});

test("copies an entry's path and name to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMount(page, "Local disk");
  await row(page, "/notes").dblclick();
  await contextAction(page, "/notes/todo.txt", "Copy path");
  await expect(page.getByRole("status").filter({ hasText: "Path copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("/notes/todo.txt");
  await contextAction(page, "/notes/todo.txt", "Copy name");
  await expect(page.getByRole("status").filter({ hasText: "Name copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("todo.txt");
});

test("creates a folder inside a collapsed tree folder without opening it", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  const item = (name: string) => tree.getByRole("treeitem", { name, exact: true });
  const bar = page.getByRole("navigation", { name: "Path" });
  await page.getByRole("toolbar", { name: "Folder actions" }).getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("xm-here-tree");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(item("xm-here-tree")).toHaveAttribute("aria-expanded", "false");
  await item("xm-here-tree").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New folder here", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("inner-here");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(bar).not.toContainText("xm-here-tree");
  await expect(item("xm-here-tree")).toHaveAttribute("aria-expanded", "false");
  await item("xm-here-tree").getByRole("button").click();
  await expect(item("inner-here")).toBeVisible();
});

test("creates a file inside a list folder row without opening it", async ({ page }) => {
  await openMount(page, "Local disk");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("xm-here-list");
  await page.getByRole("button", { name: "Create" }).click();
  await contextAction(page, "/xm-here-list", "New file here");
  await page.getByRole("dialog").getByRole("textbox").fill("made-here.txt");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "made-here.txt" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row(page, "/made-here.txt")).toHaveCount(0);
  await row(page, "/xm-here-list").dblclick();
  await expect(row(page, "/xm-here-list/made-here.txt")).toBeVisible();
});

test("moves the selection to the trash, undoes, restores and purges", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/e2e").dblclick();
  await row(page, "/e2e/README.md").click();
  await row(page, "/e2e/hello.txt").click({
    modifiers: ["Shift"],
  });
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(row(page, "/e2e/README.md")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "2 items moved to trash" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "/e2e/README.md")).toBeVisible();
  await expect(row(page, "/e2e/hello.txt")).toBeVisible();

  await row(page, "/e2e/README.md").click();
  await row(page, "/e2e/hello.txt").click({
    modifiers: ["Shift"],
  });
  await page.keyboard.press("Delete");
  await expect(row(page, "/e2e/hello.txt")).toHaveCount(0);

  await openTrash(page);
  const trashRow = (name: string) => page.locator("[data-trash-id]").filter({ hasText: name });
  await expect(trashRow("hello.txt")).toBeVisible();
  await trashRow("hello.txt").getByRole("button", { name: "Restore" }).click();
  await expect(trashRow("hello.txt")).toHaveCount(0);
  await trashRow("README.md").getByRole("button", { name: "Delete forever" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Trash is empty")).toBeVisible();

  await switchMount(page, "Local disk");
  await row(page, "/e2e").dblclick();
  await expect(row(page, "/e2e/hello.txt")).toBeVisible();
});

test("filters the current folder by name", async ({ page }) => {
  await openMount(page, "Local disk");
  await page.getByRole("searchbox", { name: "Search in this folder" }).fill("NOT");
  await expect(row(page, "/notes")).toBeVisible();
  await expect(row(page, "/docs")).toHaveCount(0);
  await page.getByRole("searchbox").fill("zzz");
  await expect(page.getByText("No matching items")).toBeVisible();
});

test("searches everywhere below the current folder", async ({ page }) => {
  await openMount(page, "Local disk");
  await page.getByRole("searchbox", { name: "Search in this folder" }).fill("todo");
  await page.getByRole("button", { name: "Everywhere below" }).click();
  const hit = row(page, "/notes/todo.txt");
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("/notes");
  await hit.dblclick();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Everywhere below" })).toHaveCount(0);
  await expect(page.getByRole("navigation").getByText("notes", { exact: true })).toBeVisible();
  await expect(row(page, "/notes/config.json")).toBeVisible();
  await expect(row(page, "/notes/todo.txt")).toHaveAttribute("aria-selected", "true");
});

test("quick open finds a nested file with Ctrl+P", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/sheets").click();
  await page.keyboard.press("Control+P");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Quick open" }).fill("ports");
  await expect(dialog.getByRole("option", { name: /ports\.csv/ }).first()).toBeVisible();
  await expect(dialog.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("heading", { name: "ports.csv" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("navigation").getByText("sheets", { exact: true })).toBeVisible();
});

test("asks what to do with uploads that already exist", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/e2e").dblclick();
  const pick = (text: string) => page.locator("input[type=file]:not([webkitdirectory])").setInputFiles([
    {
      name: "hello.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    },
  ]);
  await pick("replaced");
  await expect(page.getByRole("alertdialog")).toContainText("1 item already exists");
  await page.getByRole("button", { name: "Replace" }).click();
  await expect.poll(async () => (await page.request.get("/api/fm/m/local/read?path=/e2e/hello.txt")).text()).toBe("replaced");

  await pick("both");
  await page.getByRole("button", { name: "Keep both" }).click();
  await expect(row(page, "/e2e/hello (1).txt")).toBeVisible();

  await pick("skipped");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(row(page, "/e2e/hello (2).txt")).toHaveCount(0);
});

test("shows details with the folder size", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/images").click();
  await page.getByRole("button", { name: "Details" }).click();
  const panel = page.getByRole("complementary", { name: "Details" });
  await expect(panel).toContainText("Folder");
  await expect(panel).toContainText("1 files, 0 folders");
  await row(page, "/notes").click();
  await expect(panel).toContainText("2 files, 0 folders");
});

test("creates a text file, duplicates it and undoes the copy", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/e2e").dblclick();
  await page.getByRole("button", { name: "New text file" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("note.txt");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "note.txt" })).toBeVisible();
  await page.keyboard.press("Escape");
  await contextAction(page, "/e2e/note.txt", "Make a copy");
  await expect(row(page, "/e2e/note (1).txt")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "/e2e/note (1).txt")).toHaveCount(0);

  await contextAction(page, "/e2e/note.txt", "Rename");
  await page.getByRole("dialog").getByRole("textbox").fill("memo.txt");
  await page.keyboard.press("Enter");
  await expect(row(page, "/e2e/memo.txt")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "/e2e/note.txt")).toBeVisible();
});

test("steps through previews and guards unsaved edits", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/notes").dblclick();
  await row(page, "/notes/config.json").dblclick();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("heading", { name: "todo.txt" })).toBeVisible();
  await dialog.locator(".cm-content").click();
  await page.keyboard.type("draft");
  await dialog.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Discard unsaved changes?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByRole("heading", { name: "todo.txt" })).toBeVisible();
  await dialog.getByRole("button", { name: "Previous" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(dialog.getByRole("heading", { name: "config.json" })).toBeVisible();
});

test("view-only mode hides every changing action", async ({ page }) => {
  await openMount(page, "Local disk");
  await page.getByLabel("View only").check();
  await expect(page.getByRole("searchbox")).toBeVisible();
  for (const name of ["New folder", "New text file", "Upload files"])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  await page.getByRole("button", { name: "Storage" }).click();
  await expect(page.getByRole("menuitem", { name: "Manage drives" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Trash" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await row(page, "/notes").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Download" })).toBeVisible();
  for (const name of [
    "Rename",
    "Delete",
    "Copy",
    "Cut",
    "Make a copy",
  ])
    await expect(page.getByRole("menuitem", { name, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  await expect(row(page, "/notes")).toBeVisible();
  await row(page, "/notes").dblclick();
  await row(page, "/notes/todo.txt").dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Read-only")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("hides write actions on a read-only mount", async ({ page }) => {
  await openMount(page, "Read-only view");
  await expect(row(page, "/docs")).toBeVisible();
  await expect(page.getByRole("button", { name: "New folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload files" })).toHaveCount(0);
  await row(page, "/docs").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Download" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
});

test("downloads a folder as zip", async ({ page }) => {
  await openMount(page, "Local disk");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await row(page, "/images").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Download" }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toBe("images.zip");
});

test("toggles between split and single layouts", async ({ page }) => {
  await openMount(page, "Local disk");
  await expect(page.getByRole("tree")).toHaveCount(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(page.getByRole("tree")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tree")).toBeVisible();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.getByRole("tree")).toHaveCount(0);
  await switchMount(page, "Scratch (memory)");
  await expect(page.getByRole("navigation")).toContainText("Scratch (memory)");
  await openTrash(page);
  await expect(page.getByRole("navigation")).toContainText("Trash");
  await page.reload();
  await expect(page.getByRole("tree")).toHaveCount(0);
});

test("navigates the folder tree with the keyboard", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  const button = (name: string) => tree.getByRole("treeitem", { name, exact: true }).getByRole("button");
  const docs = tree.getByRole("treeitem", { name: "docs", exact: true });
  await button("Local disk").focus();
  await page.keyboard.press("ArrowDown");
  await expect(button("docs")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(docs).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation")).not.toContainText("docs");
  await expect(button("sample.pdf")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(button("sample.pdf")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(button("docs")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(docs).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowLeft");
  await expect(button("Local disk")).toBeFocused();
  await page.keyboard.press("End");
  await expect(button("Read-only view")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(button("Local disk")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation")).toContainText("docs");
});

test("opens context menus on tree rows", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  const item = (name: string) => tree.getByRole("treeitem", { name, exact: true });
  await item("docs").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await item("Local disk").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "New folder here", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await item("Trash").click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("previews the selected tree file on the right", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const item = (name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
  await expect(fileList(page)).toHaveCount(0);
  await item("notes").click();
  await expect(page.getByText("Select a file in the tree to preview it")).toBeVisible();
  await item("todo.txt").click();
  await expect(page.locator(".cm-content")).toContainText("try rename");
  await expect(page.getByRole("toolbar", { name: "todo.txt" }).getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Folders only move the tree's focus; the open file stays.
  await item("docs").click();
  await expect(page.locator(".cm-content")).toContainText("try rename");
  await expect(page.getByRole("navigation", { name: "Path" })).toContainText("todo.txt");
});

test("jumps between files from the path bar", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const item = (name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
  const bar = page.getByRole("navigation", { name: "Path" });
  await item("notes").click();
  await item("todo.txt").click();
  await expect(bar).toContainText("todo.txt");
  await bar.getByRole("button", { name: "todo.txt" }).click();
  await page.getByRole("menuitem", { name: "config.json" }).click();
  await expect(page.getByRole("toolbar", { name: "config.json" })).toBeVisible();
  await bar.getByRole("button", { name: "Local disk" }).click();
  await page.getByRole("menuitem", { name: "docs" }).click();
  await page.getByRole("menuitem", { name: "sample.pdf" }).click();
  await expect(page.getByRole("toolbar", { name: "sample.pdf" })).toBeVisible();
  await expect(bar).toHaveText(/Local disk.*docs.*sample\.pdf/);
});

test("guards unsaved inline edits when switching files", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const item = (name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
  await item("notes").click();
  await item("todo.txt").click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("draft");
  await item("config.json").click();
  await expect(page.getByRole("alertdialog")).toContainText("Discard unsaved changes?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".cm-content")).toContainText("draft");
  await item("config.json").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("toolbar", { name: "config.json" })).toBeVisible();
});

test("resizes the folder tree by dragging and keeps the width", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  const width = async () => (await tree.boundingBox())!.width;
  const before = await width();
  const handle = page.getByRole("separator", { name: "Resize folder tree" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(width).toBeGreaterThan(before + 80);
  const dragged = await width();
  await page.reload();
  await expect.poll(width).toBeCloseTo(dragged, -1);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(width).toBeLessThan(dragged - 5);
});

test("hides a drive via Manage drives and remembers it", async ({ page }) => {
  await startWithTree(page);
  await page.goto("/");
  const tree = page.getByRole("tree");
  await expect(tree.getByText("Scratch (memory)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage drives" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Local disk" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Scratch (memory)" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(tree.getByText("Scratch (memory)", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(tree.getByText("Local disk", { exact: true })).toBeVisible();
  await expect(tree.getByText("Scratch (memory)", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Storage" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Read-only view" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Scratch (memory)" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Manage drives" }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: "Scratch (memory)" }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Storage" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Scratch (memory)" })).toBeVisible();
});

test("groups drives by driver kind", async ({ page }) => {
  await startWithTree(page);
  await page.goto("/?group=driver");
  const tree = page.getByRole("tree");
  await expect(tree.getByRole("treeitem", { name: "Local", exact: true })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Memory", exact: true })).toBeVisible();
  await expect(tree.getByRole("group", { name: "Local" })).toContainText("Local disk");
  await expect(tree.getByRole("group", { name: "Local" })).toContainText("Read-only view");
  await expect(tree.getByRole("group", { name: "Memory" })).toContainText("Scratch (memory)");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Storage" }).click();
  await expect(page.getByRole("menu").getByRole("group", { name: "Memory" }).getByRole("menuitemradio", { name: "Scratch (memory)" })).toBeVisible();
});

test("leaves host-hidden drives out of the tree, menu and Manage drives", async ({ page }) => {
  await startWithTree(page);
  await page.goto("/?hidden=readonly");
  const tree = page.getByRole("tree");
  await expect(tree.getByText("Local disk", { exact: true })).toBeVisible();
  await expect(tree.getByText("Read-only view", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Manage drives" }).click();
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(2);
  await expect(page.getByRole("dialog").getByText("Read-only view")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Storage" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Local disk" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Read-only view" })).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("uses the single layout and opens entries with a tap", async ({ page }) => {
    await page.goto("/");
    await expect(row(page, "/notes")).toBeVisible();
    await expect(page.getByRole("tree")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sidebar/ })).toHaveCount(0);
    await row(page, "/notes").tap();
    await expect(row(page, "/notes/todo.txt")).toBeVisible();
    await row(page, "/notes/todo.txt").tap();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "todo.txt" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("complementary", { name: "Details" })).toContainText("2 files, 0 folders");
  });
});

test.describe("file picker", () => {
  const output = (page: Page) => page.getByTestId("fm-picked");
  const pickBar = (page: Page) => page.locator("[data-fm-pick-bar]");

  // Earlier tests move /README.md away; put it back.
  test.beforeEach(async ({ page }) => {
    const res = await page.request.put("/api/fm/m/local/write?path=%2FREADME.md&conflict=overwrite", { data: "# Local root\n" });
    expect(res.ok()).toBe(true);
  });

  test("picks one file with a double-click", async ({ page }) => {
    await page.goto("/?pick");
    await row(page, "/README.md").dblclick();
    await expect(output(page)).toHaveText("/README.md");
  });

  test("picks several files with multiple", async ({ page }) => {
    await page.goto("/?pick&multiple");
    await row(page, "/notes").dblclick();
    await row(page, "/notes/todo.txt").click();
    await row(page, "/notes/config.json").click();
    await expect(pickBar(page)).toContainText("2 selected");
    await pickBar(page).getByRole("button", { name: "Confirm" }).click();
    await expect(output(page)).toContainText("/notes/todo.txt");
    await expect(output(page)).toContainText("/notes/config.json");
  });

  test("disables files outside accept", async ({ page }) => {
    await page.goto("/?pick&accept=.png");
    await expect(row(page, "/README.md")).toHaveAttribute("aria-disabled", "true");
    // Playwright waits for aria-disabled elements to become enabled; force the click.
    await row(page, "/README.md").click({ force: true });
    await expect(row(page, "/README.md")).toHaveAttribute("aria-selected", "false");
    await expect(pickBar(page).getByRole("button", { name: "Confirm" })).toBeDisabled();
    await row(page, "/images").dblclick();
    await row(page, "/images/dot.png").click();
    await expect(row(page, "/images/dot.png")).toHaveAttribute("aria-selected", "true");
    await pickBar(page).getByRole("button", { name: "Confirm" }).click();
    await expect(output(page)).toHaveText("/images/dot.png");
  });

  test("blocks confirm over the size cap", async ({ page }) => {
    await page.goto("/?pick&multiple&max=10");
    await row(page, "/README.md").click();
    await expect(pickBar(page)).toContainText("Selection exceeds the 10 B limit");
    await expect(pickBar(page).getByRole("button", { name: "Confirm" })).toBeDisabled();
    await pickBar(page).getByRole("button", { name: "Cancel" }).click();
    await expect(output(page)).toHaveText("cancelled");
  });
});

test("uploads a large file in parts", async ({ page }) => {
  const size = 18 * 1024 * 1024;
  const requests: { method: string; path: string }[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/fm/m/local/")) {
      requests.push({
        method: r.method(),
        path: `${u.pathname}?${u.searchParams.get("path") ?? ""}`,
      });
    }
  });

  await openMount(page, "Local disk");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("big");
  await page.getByRole("button", { name: "Create" }).click();
  await row(page, "/big").dblclick();
  await expect(page.getByText("This folder is empty")).toBeVisible();

  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "large.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(size, 7),
  });
  await expect(row(page, "/big/large.bin")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").locator("[data-status=done]")).toHaveCount(1);

  const count = (method: string, re: RegExp) => requests.filter(r => r.method === method && re.test(r.path)).length;
  expect(count("POST", /\/uploads\?$/)).toBe(1);
  expect(count("PUT", /\/uploads\/[^/]+\/parts\/\d+\?$/)).toBeGreaterThanOrEqual(5);
  expect(count("POST", /\/uploads\/[^/]+\/complete\?$/)).toBe(1);
  expect(count("PUT", /\/write\?\/big\/large\.bin$/)).toBe(0);

  const stat = await page.request.get("/api/fm/m/local/stat?path=/big/large.bin");
  expect((await stat.json()).size).toBe(size);

  const list = await page.request.get("/api/fm/m/local/list?path=/");
  const names = (await list.json()).items.map((e: { name: string }) => e.name);
  expect(names).not.toContain(".fm-uploads");
  await page.getByRole("button", { name: "Up", exact: true }).click();
  await expect(row(page, "/big")).toBeVisible();
  await expect(row(page, "/.fm-uploads")).toHaveCount(0);
});
