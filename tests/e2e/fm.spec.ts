import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const row = (page: Page, path: string) => page.locator(`[data-path="${path}"]`);
const fileList = (page: Page) => page.locator("[role=grid]");

async function openMount(page: Page, label: string) {
  await page.goto("/");
  await page.getByRole("tree").getByText(label, { exact: true }).click();
}

async function contextAction(page: Page, path: string, action: string) {
  await row(page, path).click({ button: "right" });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test("browses folders with the list, tree and breadcrumb", async ({ page }) => {
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
  await page.getByRole("navigation").getByText("Local disk").click();
  await expect(row(page, "/README.md")).toBeVisible();
  await page.getByRole("tree").getByText("images", { exact: true }).click();
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
  await page.getByRole("tree").getByText("docs", { exact: true }).click();
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

  await page.getByRole("tree").getByText("Trash", { exact: true }).first().click();
  const trashRow = (name: string) => page.locator("[data-trash-id]").filter({ hasText: name });
  await expect(trashRow("hello.txt")).toBeVisible();
  await trashRow("hello.txt").getByRole("button", { name: "Restore" }).click();
  await expect(trashRow("hello.txt")).toHaveCount(0);
  await trashRow("README.md").getByRole("button", { name: "Delete forever" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Trash is empty")).toBeVisible();

  await page.getByRole("tree").getByText("e2e", { exact: true }).click();
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
  await expect(page.getByRole("tree").getByText("Trash", { exact: true })).toHaveCount(0);
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
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.getByRole("tree")).toHaveCount(0);
  await page.getByRole("button", { name: "Storage" }).click();
  await page.getByRole("menuitemradio", { name: "Scratch (memory)" }).click();
  await expect(page.getByRole("navigation")).toContainText("Scratch (memory)");
  await page.getByRole("button", { name: "Storage" }).click();
  await page.getByRole("menuitem", { name: "Trash" }).click();
  await expect(page.getByRole("navigation")).toContainText("Trash");
  await page.reload();
  await expect(page.getByRole("tree")).toHaveCount(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(page.getByRole("tree")).toBeVisible();
});

test("hides a drive via Manage drives and remembers it", async ({ page }) => {
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
  await page.goto("/?group=driver");
  const tree = page.getByRole("tree");
  await expect(tree.getByRole("treeitem", { name: "toggle Local", exact: true })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "toggle Memory", exact: true })).toBeVisible();
  await expect(tree.getByRole("group", { name: "Local" })).toContainText("Local disk");
  await expect(tree.getByRole("group", { name: "Local" })).toContainText("Read-only view");
  await expect(tree.getByRole("group", { name: "Memory" })).toContainText("Scratch (memory)");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.getByRole("button", { name: "Storage" }).click();
  await expect(page.getByRole("menu").getByRole("group", { name: "Memory" }).getByRole("menuitemradio", { name: "Scratch (memory)" })).toBeVisible();
});

test("leaves host-hidden drives out of the tree, menu and Manage drives", async ({ page }) => {
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
