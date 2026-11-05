import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mkdir, utimes, writeFile } from "node:fs/promises";
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
// The demo's starred / recent lists stay off unless a test turns them on (withMeta).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("fm:layout"))
      localStorage.setItem("fm:layout", "single");
    if (!localStorage.getItem("fm-demo:meta-off"))
      localStorage.setItem("fm-demo:meta-off", "1");
  });
});

/** Turns on the demo's localStorage starred / recent lists for this test. */
async function withMeta(page: Page) {
  await page.addInitScript(() => localStorage.setItem("fm-demo:meta-off", "0"));
}

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
  await expect(page.getByRole("dialog").locator("iframe[title='sample.pdf']")).toHaveAttribute("src", /#toolbar=0&navpanes=0$/);
});

test("sniffs extensionless files: text opens in the editor, binary offers download", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/samples").dblclick();
  await row(page, "/samples/hosts").dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".cm-content")).toContainText("localhost");
  await page.keyboard.press("Escape");
  await row(page, "/samples/blob").dblclick();
  await expect(dialog.getByText("No preview available")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
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

test("opens markdown in the editor and toggles the preview", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/samples").dblclick();
  await row(page, "/samples/guide.md").dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".cm-content")).toContainText("# Guide");
  await dialog.getByRole("button", { name: "Open preview", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Guide", exact: true })).toBeVisible();
  await expect(dialog.getByRole("table")).toContainText("Piraeus");
  await expect(dialog.locator("[data-streamdown='link']")).toContainText("project page");
  await expect(dialog.locator("[data-streamdown='code-block']")).toContainText("console.log(greeting)");
  await expect(dialog.locator(".cm-content")).toBeHidden();
  await dialog.getByRole("button", { name: "Reopen as source", exact: true }).click();
  await expect(dialog.locator(".cm-content")).toContainText("# Guide");
});

test("previews markdown to the side, following unsaved edits", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/samples").dblclick();
  await row(page, "/samples/guide.md").dblclick();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Open preview to the side" }).click();
  const preview = dialog.locator("[data-fm-markdown-preview]");
  await expect(preview.getByRole("heading", { name: "Guide", exact: true })).toBeVisible();
  await expect(dialog.locator(".cm-content")).toBeVisible();
  await dialog.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\n## Live heading\n");
  await expect(preview.getByRole("heading", { name: "Live heading" })).toBeVisible();
  await dialog.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Discard changes" }).click();
  await expect(preview.getByRole("heading", { name: "Live heading" })).toHaveCount(0);
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

test("restores and deletes several trash items at once", async ({ page }) => {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/trash-multi-e2e" },
  });
  for (const name of ["t1.txt", "t2.txt", "t3.txt"]) {
    await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`/trash-multi-e2e/${name}`)}&conflict=overwrite`, { data: name });
    await page.request.post("/api/fm/m/local/ops", {
      data: {
        op: "delete",
        paths: [`/trash-multi-e2e/${name}`],
      },
    });
  }
  await openMount(page, "Local disk");
  await openTrash(page);
  await expect(page.getByText("Items in the trash are deleted forever after 30 days.")).toBeVisible();
  const trashRow = (name: string) => page.locator("[data-trash-id]").filter({ hasText: name });
  await expect(trashRow("t1.txt")).toContainText("In 30 days");
  await trashRow("t1.txt").getByRole("checkbox").click();
  await trashRow("t2.txt").click({
    modifiers: ["ControlOrMeta"],
  });
  const bar = page.getByRole("toolbar", { name: "2 selected" });
  await bar.getByRole("button", { name: "Restore" }).click();
  await expect(trashRow("t1.txt")).toHaveCount(0);
  await expect(trashRow("t2.txt")).toHaveCount(0);

  await trashRow("t3.txt").click();
  await page.keyboard.press("Delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(trashRow("t3.txt")).toHaveCount(0);
  await switchMount(page, "Local disk");
  await row(page, "/trash-multi-e2e").dblclick();
  await expect(row(page, "/trash-multi-e2e/t1.txt")).toBeVisible();
  await expect(row(page, "/trash-multi-e2e/t2.txt")).toBeVisible();
  await expect(row(page, "/trash-multi-e2e/t3.txt")).toHaveCount(0);
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
  await page.getByRole("checkbox", { name: "View only" }).check();
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
  // Entry actions live in the context menu; save / more appear only with unsaved edits.
  const header = page.getByRole("toolbar", { name: "todo.txt" });
  for (const name of [
    "Rename",
    "Delete",
    "Download",
    "Save",
    "More",
  ])
    await expect(header.getByRole("button", { name, exact: true })).toHaveCount(0);
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
  await expect(page.locator("iframe[title='sample.pdf']")).toBeVisible();
  await expect(bar).toHaveText(/Local disk.*docs.*sample\.pdf/);
});

test("toggles hidden files in the tree", async ({ page }) => {
  expect((await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/dotted" },
  })).ok()).toBe(true);
  for (const name of [".secret", "plain.txt"])
    expect((await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`/dotted/${name}`)}`, { data: name })).ok()).toBe(true);
  await openTreeMount(page, "Local disk");
  const item = (name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
  const hiddenItem = async () => {
    await page.getByRole("toolbar", { name: "Folder actions" }).locator("..").getByRole("button", { name: "More" }).click();
    return page.getByRole("menuitemcheckbox", { name: "Show hidden files" });
  };
  const toggle = {
    click: async () => (await hiddenItem()).click(),
  };
  const expectHidden = async (shown: boolean) => {
    await expect(await hiddenItem()).toHaveAttribute("aria-checked", String(shown));
    await page.keyboard.press("Escape");
  };
  await item("dotted").click();
  await expect(item("plain.txt")).toBeVisible();
  await expect(item(".secret")).toHaveCount(0);
  await expectHidden(false);

  await toggle.click();
  await expectHidden(true);
  await expect(item(".secret")).toBeVisible();
  await toggle.click();
  await expectHidden(false);
  await expect(item(".secret")).toHaveCount(0);
  await expect(item("plain.txt")).toBeVisible();

  // The single layout's list follows the same preference.
  await toggle.click();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(row(page, "/dotted/.secret")).toBeVisible();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await toggle.click();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(row(page, "/dotted/plain.txt")).toBeVisible();
  await expect(row(page, "/dotted/.secret")).toHaveCount(0);
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

test("collapses every tree row at once", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  const item = (name: string) => tree.getByRole("treeitem", { name, exact: true });
  const expanded = tree.locator("[role=treeitem][aria-expanded=true]");
  await item("docs").getByRole("button").click();
  await item("images").getByRole("button").click();
  await expect(item("docs")).toHaveAttribute("aria-expanded", "true");
  await expect(item("images")).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(expanded).toHaveCount(0);
  await expect(item("Local disk")).toHaveAttribute("aria-expanded", "false");
  // The next location opens its path again.
  const bar = page.getByRole("navigation", { name: "Path" });
  await bar.getByRole("button", { name: "Local disk" }).click();
  await page.getByRole("menuitem", { name: "docs" }).click();
  await page.getByRole("menuitem", { name: "sample.pdf" }).click();
  await expect(page.locator("iframe[title='sample.pdf']")).toBeVisible();
  await expect(item("Local disk")).toHaveAttribute("aria-expanded", "true");
  await expect(item("docs")).toHaveAttribute("aria-selected", "true");
});

test("reopens the last folder and file after a reload", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const item = (name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
  const bar = page.getByRole("navigation", { name: "Path" });
  await item("notes").click();
  await item("todo.txt").click();
  await expect(page.locator(".cm-content")).toContainText("try rename");
  await page.reload();
  await expect(page.getByRole("toolbar", { name: "todo.txt" })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("try rename");
  await expect(bar).toHaveText(/Local disk.*notes.*todo\.txt/);
  await expect(item("notes")).toHaveAttribute("aria-selected", "true");
});

test("ignores a stale remembered location", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("fm:last", JSON.stringify({ mount: "local", path: "/gone-folder", file: "/gone-folder/gone.txt" }));
    }
  });
  await startWithTree(page);
  await page.goto("/");
  const tree = page.getByRole("tree");
  await expect(tree.getByRole("treeitem", { name: "Local disk", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Select a file in the tree to preview it")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Path" })).toHaveText("Local disk");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("restores only the folder in the list layout after a reload", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/notes").dblclick();
  await row(page, "/notes/todo.txt").dblclick();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "todo.txt" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fm:last") ?? "{}").file)).toBe("/notes/todo.txt");
  // Reload with the preview still open: the remembered file must not pop a dialog.
  await page.reload();
  await expect(row(page, "/notes/todo.txt")).toBeVisible();
  await expect(row(page, "/notes/config.json")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  // Driver sections are level-1 rows with their drives below at level 2.
  const levels = await tree.getByRole("treeitem").evaluateAll(rows => rows.filter(r => Number(r.getAttribute("aria-level")) <= 2).map(r => `${r.getAttribute("aria-level")} ${r.getAttribute("aria-label")}`));
  expect(levels).toEqual([
    "1 Local",
    "2 Local disk",
    "2 Read-only view",
    "1 Memory",
    "2 Scratch (memory)",
  ]);
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

  test("shows the tree or the open file with a back button in the tree layout", async ({ page }) => {
    await openTreeMount(page, "Local disk");
    const tree = page.getByRole("tree");
    const item = (name: string) => tree.getByRole("treeitem", { name, exact: true });
    await expect(row(page, "/notes")).toHaveCount(0);
    await item("notes").tap();
    await expect(tree).toBeVisible();
    await item("todo.txt").tap();
    await expect(page.getByRole("toolbar", { name: "todo.txt" })).toBeVisible();
    await expect(tree).toHaveCount(0);
    await page.getByRole("button", { name: "Back to folders" }).tap();
    await expect(item("todo.txt")).toBeVisible();
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

test("opens a large text file read-only", async ({ page }) => {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/large-e2e" },
  });
  const body = `first line of big log\n${"lorem ipsum dolor sit amet, consectetur adipiscing\n".repeat(52_000)}`;
  const put = await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent("/large-e2e/big.log")}&conflict=overwrite`, { data: body });
  expect(put.ok()).toBe(true);

  await openMount(page, "Local disk");
  await row(page, "/large-e2e").dblclick();
  await row(page, "/large-e2e/big.log").dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Large file: showing the first 2 MB, read-only.")).toBeVisible();
  await expect(dialog.locator(".cm-content")).toContainText("first line of big log");
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
});

/** Creates `dir/name` with `body` through the API and opens it in the preview dialog. */
async function openEditorFile(page: Page, dir: string, name: string, body: string) {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: dir },
  });
  const put = await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`${dir}/${name}`)}&conflict=overwrite`, { data: body });
  expect(put.ok()).toBe(true);
  return reopenEditorFile(page, dir, name);
}

async function reopenEditorFile(page: Page, dir: string, name: string) {
  await openMount(page, "Local disk");
  await row(page, dir).dblclick();
  await row(page, `${dir}/${name}`).dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".cm-content")).toBeVisible();
  return dialog;
}

const readFile = async (page: Page, path: string) => (await page.request.get(`/api/fm/m/local/read?path=${encodeURIComponent(path)}`)).text();

async function typeAtEnd(page: Page, text: string) {
  await page.getByRole("dialog").locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

test("saves with Ctrl+S", async ({ page }) => {
  await openEditorFile(page, "/editor-e2e-save", "note.txt", "save me");
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".cm-content")).toContainText("save me");
  await typeAtEnd(page, " now");
  await expect(dialog.getByText("Unsaved")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(dialog.getByText("Saved")).toBeVisible();
  expect(await readFile(page, "/editor-e2e-save/note.txt")).toBe("save me now");
});

test("keeps the word wrap choice", async ({ page }) => {
  const dialog = await openEditorFile(page, "/editor-e2e-wrap", "note.txt", "wrap me");
  const wrap = dialog.getByRole("button", { name: "Word wrap" });
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  const again = await reopenEditorFile(page, "/editor-e2e-wrap", "note.txt");
  await expect(again.getByRole("button", { name: "Word wrap" })).toHaveAttribute("aria-pressed", "false");
});

test("restores an unsaved draft after a reload", async ({ page }) => {
  const dialog = await openEditorFile(page, "/editor-e2e-draft", "note.txt", "server text");
  await expect(dialog.locator(".cm-content")).toContainText("server text");
  await typeAtEnd(page, " draft42");
  await expect(dialog.getByText("Unsaved")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fm:drafts") ?? "")).toContain("server text draft42");
  await page.reload();
  const again = await reopenEditorFile(page, "/editor-e2e-draft", "note.txt");
  await expect(again.locator(".cm-content")).toContainText("server text draft42");
  await expect(again.getByText("Unsaved")).toBeVisible();
  await again.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Discard changes" }).click();
  await expect(again.locator(".cm-content")).toHaveText("server text");
  await expect(again.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("resolves a save conflict by overwriting", async ({ page }) => {
  const dialog = await openEditorFile(page, "/editor-e2e-overwrite", "note.txt", "original");
  await expect(dialog.locator(".cm-content")).toContainText("original");
  await typeAtEnd(page, " mine");
  await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent("/editor-e2e-overwrite/note.txt")}&conflict=overwrite`, { data: "theirs" });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("The file changed on disk since you opened it.")).toBeVisible();
  await dialog.getByRole("button", { name: "Overwrite" }).click();
  await expect(dialog.getByText("Saved")).toBeVisible();
  expect(await readFile(page, "/editor-e2e-overwrite/note.txt")).toBe("original mine");
});

test("resolves a save conflict by reloading from disk", async ({ page }) => {
  const dialog = await openEditorFile(page, "/editor-e2e-reload", "note.txt", "original");
  await expect(dialog.locator(".cm-content")).toContainText("original");
  await typeAtEnd(page, " mine");
  await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent("/editor-e2e-reload/note.txt")}&conflict=overwrite`, { data: "theirs" });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("The file changed on disk since you opened it.")).toBeVisible();
  await dialog.getByRole("button", { name: "Reload from disk" }).click();
  await expect(dialog.locator(".cm-content")).toHaveText("theirs");
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("discarding through the guard drops the draft", async ({ page }) => {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/guard-e2e" },
  });
  for (const [name, text] of [
    ["a.txt", "alpha original"],
    ["b.txt", "beta"],
  ])
    await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`/guard-e2e/${name}`)}&conflict=overwrite`, { data: text });
  await openTreeMount(page, "Local disk");
  const item = (name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
  await item("guard-e2e").click();
  await item("a.txt").click();
  await expect(page.locator(".cm-content")).toContainText("alpha original");
  await page.locator(".cm-content").click();
  await page.keyboard.type("zz-guard-draft");
  await item("b.txt").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".cm-content")).toContainText("beta");
  await page.waitForTimeout(500);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fm:drafts") ?? "")).not.toContain("zz-guard-draft");
  await item("a.txt").click();
  await expect(page.locator(".cm-content")).toHaveText("alpha original");
  await expect(page.getByText("Unsaved")).toHaveCount(0);
});

test("deleting a file drops its draft", async ({ page }) => {
  const dialog = await openEditorFile(page, "/drafts-del-e2e", "n.txt", "server text");
  await expect(dialog.locator(".cm-content")).toContainText("server text");
  await typeAtEnd(page, " unsaved draft");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fm:drafts") ?? "")).toContain("unsaved draft");
  await page.reload();
  await openMount(page, "Local disk");
  await row(page, "/drafts-del-e2e").dblclick();
  await row(page, "/drafts-del-e2e/n.txt").click();
  await page.keyboard.press("Delete");
  await expect(row(page, "/drafts-del-e2e/n.txt")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fm:drafts") ?? "")).not.toContain("unsaved draft");
  const put = await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent("/drafts-del-e2e/n.txt")}&conflict=overwrite`, { data: "" });
  expect(put.ok()).toBe(true);
  const again = await reopenEditorFile(page, "/drafts-del-e2e", "n.txt");
  await expect(again.locator(".cm-content")).not.toContainText("unsaved draft");
  await expect(again.getByText("Unsaved")).toHaveCount(0);
});

test("uploads files dropped from the OS", async ({ page }) => {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/dz-drop-e2e" },
  });
  await openMount(page, "Local disk");
  await row(page, "/dz-drop-e2e").dblclick();
  await expect(page.getByText("This folder is empty")).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["dropped"], "dropped.txt", { type: "text/plain" }));
    return dt;
  });
  const section = page.locator("section").first();
  await section.dispatchEvent("dragenter", { dataTransfer });
  await section.dispatchEvent("drop", { dataTransfer });
  await expect(row(page, "/dz-drop-e2e/dropped.txt")).toBeVisible();
});

test("uploads from the empty preview by clicking the drop area", async ({ page }) => {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/dz-click-e2e" },
  });
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  await tree.getByRole("treeitem", { name: "dz-click-e2e", exact: true }).getByRole("button").first().click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Drop files here or click to upload" }).click();
  await (await chooser).setFiles({
    name: "picked.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("picked"),
  });
  await expect(tree.getByRole("treeitem", { name: "picked.txt", exact: true })).toBeVisible();
});

test("switches language and theme in the demo, the open editor follows", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  expect((await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/theme-e2e" },
  })).ok()).toBe(true);
  expect((await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent("/theme-e2e/note.txt")}&conflict=overwrite`, { data: "themed" })).ok()).toBe(true);
  await openTreeMount(page, "Local disk");
  const item = (name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
  await item("theme-e2e").click();
  await item("note.txt").click();
  const editor = page.locator(".cm-editor");
  await expect(editor).toContainText("themed");
  const background = () => editor.evaluate(el => getComputedStyle(el).backgroundColor);
  const light = await background();
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(background).not.toBe(light);

  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "中文" }).click();
  await expect(page.getByRole("heading", { name: "文件管理器" })).toBeVisible();
  await expect(page.getByText("资源管理器")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "文件管理器" })).toBeVisible();
});

test("explorer refresh reveals the selected file after collapse all", async ({ page }) => {
  await openTreeMount(page, "Local disk");
  const item = (name: string) => page.getByRole("tree").getByRole("treeitem", { name, exact: true });
  await item("samples").click();
  await item("guide.md").click();
  await expect(item("guide.md")).toHaveAttribute("aria-selected", "true");
  const header = page.getByRole("toolbar", { name: "Folder actions" });
  await header.getByRole("button", { name: "Collapse all" }).click();
  await expect(item("guide.md")).toBeHidden();
  await header.getByRole("button", { name: "Refresh" }).click();
  await expect(item("guide.md")).toBeInViewport();
  await expect(item("guide.md")).toHaveAttribute("aria-selected", "true");
});

test("image keys zoom, fit, rotate and flip", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/images").dblclick();
  await row(page, "/images/dot.png").dblclick();
  const dialog = page.getByRole("dialog");
  const img = dialog.locator("img[alt='dot.png']");
  await expect(dialog.getByRole("button", { name: "100%" })).toBeVisible();
  await page.keyboard.press("+");
  await expect(dialog.getByRole("button", { name: "125%" })).toBeVisible();
  await page.keyboard.press("0");
  await expect(dialog.getByRole("button", { name: "100%" })).toBeVisible();
  await page.keyboard.press("r");
  await page.keyboard.press("f");
  await expect(img).toHaveAttribute("style", /rotate\(90deg\) scaleX\(-1\)/);
  await page.keyboard.press("Shift+R");
  await expect(img).toHaveAttribute("style", /rotate\(0deg\)/);
});

test("selects rows with a marquee", async ({ page }) => {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/marquee-e2e" },
  });
  for (const n of [1, 2, 3, 4, 5])
    await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`/marquee-e2e/m${n}.txt`)}&conflict=overwrite`, { data: "m" });
  await openMount(page, "Local disk");
  await row(page, "/marquee-e2e").dblclick();
  const last = await row(page, "/marquee-e2e/m5.txt").boundingBox();
  const third = await row(page, "/marquee-e2e/m3.txt").boundingBox();
  await page.mouse.move(last!.x + 40, last!.y + last!.height + 40);
  await page.mouse.down();
  await page.mouse.move(third!.x + 40, third!.y + third!.height / 2, { steps: 5 });
  await expect(page.locator("[data-fm-marquee]")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText("3 selected")).toBeVisible();
  await expect(page.locator("[data-fm-marquee]")).toHaveCount(0);
  await expect(row(page, "/marquee-e2e/m3.txt")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "/marquee-e2e/m2.txt")).toHaveAttribute("aria-selected", "false");
});

test("uploads files pasted from the OS clipboard", async ({ page }) => {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/paste-e2e" },
  });
  await openMount(page, "Local disk");
  await row(page, "/paste-e2e").dblclick();
  await expect(page.getByText("This folder is empty")).toBeVisible();
  await page.locator("section").first().evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File(["shot"], "screenshot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(row(page, "/paste-e2e/screenshot.png")).toBeVisible();
});

test("dragging a file row offers it as a desktop download", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/notes").dblclick();
  const data = await row(page, "/notes/todo.txt").evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    return dt.getData("DownloadURL");
  });
  expect(data).toMatch(/^text\/plain[^:]*:todo\.txt:http:\/\/.+\/read\?.*download=1/);
});

test("the tree renders only a window of a large folder", async ({ page }) => {
  const dir = ".tmp/e2e-root/big-tree-e2e";
  await mkdir(dir, { recursive: true });
  await Promise.all(Array.from({ length: 2000 }, (_, i) => writeFile(`${dir}/f${String(i).padStart(4, "0")}.txt`, "")));
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  await tree.getByRole("treeitem", { name: "big-tree-e2e", exact: true }).click();
  await expect(tree.getByRole("treeitem", { name: "f0000.txt", exact: true })).toBeVisible();
  expect(await tree.getByRole("treeitem").count()).toBeLessThan(200);
  // Every page (500 entries each) is in: 2 000 rows of 28 px.
  await expect.poll(() => tree.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(2000 * 28);
  await tree.getByRole("treeitem", { name: "f0000.txt", exact: true }).getByRole("button").focus();
  await page.keyboard.press("End");
  await expect(tree.getByRole("treeitem", { name: "Read-only view", exact: true }).getByRole("button")).toBeFocused();
  await expect(tree.getByRole("treeitem", { name: "f0000.txt", exact: true })).toHaveCount(0);
});

test("shows an error with retry when the server is unreachable", async ({ page }) => {
  await page.route("**/api/fm/mounts", route => route.abort());
  await page.goto("/");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Cannot reach the file server");
  await page.unroute("**/api/fm/mounts");
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(row(page, "/notes")).toBeVisible();
  await expect(alert).toHaveCount(0);
});

async function seedFilterFolder(page: Page) {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/filter-e2e" },
  });
  for (const name of [
    "pic.png",
    "main.ts",
    "data.csv",
    "old.ts",
  ])
    await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`/filter-e2e/${name}`)}&conflict=overwrite`, { data: name });
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/filter-e2e/sub" },
  });
  const old = new Date("2020-01-01T00:00:00Z");
  await utimes(".tmp/e2e-root/filter-e2e/old.ts", old, old);
}

test("filters the list by type and modified date", async ({ page }) => {
  await seedFilterFolder(page);
  await openMount(page, "Local disk");
  await row(page, "/filter-e2e").dblclick();
  await expect(row(page, "/filter-e2e/old.ts")).toBeVisible();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Code and text" }).click();
  await page.keyboard.press("Escape");
  await expect(row(page, "/filter-e2e/main.ts")).toBeVisible();
  await expect(row(page, "/filter-e2e/old.ts")).toBeVisible();
  await expect(row(page, "/filter-e2e/pic.png")).toHaveCount(0);
  await expect(row(page, "/filter-e2e/sub")).toHaveCount(0);

  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Last 30 days" }).click();
  await page.keyboard.press("Escape");
  await expect(row(page, "/filter-e2e/old.ts")).toHaveCount(0);
  const chips = page.getByRole("group", { name: "Filter" });
  await expect(chips).toContainText("Code and text");
  await chips.getByRole("button", { name: "Remove filter: Code and text" }).click();
  await expect(row(page, "/filter-e2e/pic.png")).toBeVisible();
  await expect(row(page, "/filter-e2e/sub")).toBeVisible();

  // Remembered per mount across reloads.
  await page.reload();
  await expect(chips).toContainText("Last 30 days");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Archives" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("No items match the filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(chips).toHaveCount(0);
  await expect(row(page, "/filter-e2e/old.ts")).toBeVisible();
});

test("filters tree file rows and keeps folders", async ({ page }) => {
  await seedFilterFolder(page);
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  const item = (name: string) => tree.getByRole("treeitem", { name, exact: true });
  await item("filter-e2e").click();
  await expect(item("main.ts")).toBeVisible();
  await page.getByRole("toolbar", { name: "Folder actions" }).locator("..").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Filter" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Images" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(item("pic.png")).toBeVisible();
  await expect(item("main.ts")).toHaveCount(0);
  await expect(item("sub")).toBeVisible();
  await page.getByRole("group", { name: "Filter" }).getByRole("button", { name: "Clear filters" }).click();
  await expect(item("main.ts")).toBeVisible();
});

test("stars files and lists recent ones through host meta", async ({ page }) => {
  await withMeta(page);
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  const item = (name: string) => tree.getByRole("treeitem", { name, exact: true });
  // The drive row itself (host lists repeat drive and folder names one level down).
  const drive = tree.locator("[role=treeitem][aria-level='1'][aria-label='Local disk']");
  const listed = tree.locator("[role=treeitem][aria-label='todo.txt, Local disk/notes']");
  await expect(item("Starred")).toBeVisible();
  await item("notes").click();
  await item("todo.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to starred" }).click();
  // Collapse the drive so the host lists stay inside the rendered window.
  await drive.getByRole("button").click();
  await expect(drive).toHaveAttribute("aria-expanded", "false");
  // Starred and Recent each list todo.txt now (recent from opening it via the right-click),
  // as a tree: section, drive, folder, file.
  await expect(listed).toHaveCount(2);
  await expect(listed.first()).toHaveAttribute("aria-level", "4");
  const levels = await tree.getByRole("treeitem").evaluateAll(rows => rows.slice(0, 4).map(r => `${r.getAttribute("aria-level")} ${r.getAttribute("aria-label")}`));
  expect(levels).toEqual([
    "1 Starred",
    "2 Local disk",
    "3 notes",
    "4 todo.txt, Local disk/notes",
  ]);
  await listed.first().click();
  await expect(page.locator(".cm-content")).toContainText("try rename");
  await drive.getByRole("button").click();
  await drive.getByRole("button").click();
  await expect(drive).toHaveAttribute("aria-expanded", "false");
  await listed.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from starred" }).click();
  await expect(listed).toHaveCount(1);
});

test("hides the starred and recent sections from the explorer menu", async ({ page }) => {
  await withMeta(page);
  await openTreeMount(page, "Local disk");
  const tree = page.getByRole("tree");
  const more = page.getByRole("toolbar", { name: "Folder actions" }).locator("..").getByRole("button", { name: "More" });
  await expect(tree.getByRole("treeitem", { name: "Starred", exact: true })).toBeVisible();
  await more.click();
  await page.getByRole("menuitemcheckbox", { name: "Show starred" }).click();
  await expect(tree.getByRole("treeitem", { name: "Starred", exact: true })).toHaveCount(0);
  await expect(tree.getByRole("treeitem", { name: "Recent", exact: true })).toBeVisible();
  await page.reload();
  await expect(tree.getByRole("treeitem", { name: "Recent", exact: true })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Starred", exact: true })).toHaveCount(0);
  await more.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Show starred" })).toHaveAttribute("aria-checked", "false");
});

/** Uploads a solid `w`×`h` PNG drawn in the page. */
async function putPng(page: Page, path: string, w: number, h: number) {
  await page.goto("/");
  await page.request.post("/api/fm/m/local/mkdir", {
    data: {
      path: path.slice(0, path.lastIndexOf("/")),
    },
  });
  const ok = await page.evaluate(async ({ path, w, h }) => {
    const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(0, 0, w / 4, h / 4);
    const blob = await new Promise<Blob>(done => canvas.toBlob(b => done(b!), "image/png"));
    const res = await fetch(`/api/fm/m/local/write?path=${encodeURIComponent(path)}&conflict=overwrite`, { method: "PUT", body: blob });
    return res.ok;
  }, { path, w, h });
  expect(ok).toBe(true);
}

test("the grid shows server thumbnails", async ({ page }) => {
  await putPng(page, "/thumbs-e2e/wide.png", 600, 300);
  await openMount(page, "Local disk");
  await row(page, "/thumbs-e2e").dblclick();
  await page.getByRole("button", { name: "Grid view" }).click();
  const img = row(page, "/thumbs-e2e/wide.png").locator("img");
  await expect(img).toHaveAttribute("src", /\/thumb\?.*w=256/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(256);
  await page.getByRole("button", { name: "List view" }).click();
});

test("saves a rotated image", async ({ page }) => {
  await putPng(page, "/rotate-e2e/wide.png", 60, 30);
  await openMount(page, "Local disk");
  await row(page, "/rotate-e2e").dblclick();
  await row(page, "/rotate-e2e/wide.png").dblclick();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Rotate right" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
  const size = await page.evaluate(async () => {
    const img = new Image();
    img.src = `/api/fm/m/local/read?path=${encodeURIComponent("/rotate-e2e/wide.png")}&t=${Date.now()}`;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  });
  expect(size).toEqual([30, 60]);
  await expect(dialog.locator("img[alt='wide.png']")).toHaveAttribute("style", /rotate\(0deg\)/);
});
