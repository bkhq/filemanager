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

test("deletes the selection with the keyboard after confirming", async ({ page }) => {
  await openMount(page, "Local disk");
  await row(page, "/e2e").dblclick();
  await row(page, "/e2e/README.md").click();
  await row(page, "/e2e/hello.txt").click({
    modifiers: ["Shift"],
  });
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog")).toContainText("Delete 2 items?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(row(page, "/e2e/README.md")).toHaveCount(0);
  await expect(row(page, "/e2e/hello.txt")).toHaveCount(0);
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
