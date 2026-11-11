import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// A folder sorts before files, and "0-" before other folders: it stays on the tree's first screen
// even after the serial specs filled the shared root.
const DIR = "0-header-actions";
const FILE = "note.txt";
const hostAction = (page: Page) => page.getByRole("button", { name: "Host action" });

test.beforeEach(async ({ page }) => {
  const res = await page.request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`/${DIR}/${FILE}`)}&conflict=overwrite`, { data: "x" });
  expect(res.ok()).toBe(true);
  await page.addInitScript(() => localStorage.setItem("fm-web:meta-off", "1"));
});

test("sits after Empty trash in the trash view", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fm:layout", "single"));
  await page.goto("/?actions");
  await page.getByRole("button", { name: "Storage" }).click();
  await page.getByRole("menuitem", { name: "Trash" }).click();
  const header = page.locator("header").filter({
    has: page.getByRole("button", { name: "Empty trash" }),
  });
  await expect(header.getByRole("button", { name: "Host action" })).toBeVisible();
  await expect(hostAction(page)).toHaveCount(1);
  const empty = (await header.getByRole("button", { name: "Empty trash" }).boundingBox())!;
  const host = (await hostAction(page).boundingBox())!;
  expect(host.x).toBeGreaterThan(empty.x);
});

test.describe("narrow manager", () => {
  // The manager is narrower than 640px: it shows the tree or the main pane, one at a time.
  test.use({
    viewport: { width: 560, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("fm:layout", "split"));
    await page.goto("/?actions");
    const mount = page.getByRole("tree").getByRole("treeitem", { name: "Local disk", exact: true });
    await expect(mount).toBeVisible();
    if (await mount.getAttribute("aria-expanded") === "false")
      await mount.getByRole("button").click();
  });

  test("stays visible in the explorer row while its hover toolbar is collapsed", async ({ page }) => {
    await page.mouse.move(5, 890);
    await expect(hostAction(page)).toHaveCount(1);
    await expect(hostAction(page)).toBeVisible();
    const toolbar = page.getByRole("toolbar", { name: "Folder actions" });
    await expect.poll(async () => (await toolbar.boundingBox())?.width ?? 0).toBe(0);
    const more = (await page.getByRole("button", { name: "More" }).boundingBox())!;
    expect((await hostAction(page).boundingBox())!.x).toBeGreaterThan(more.x);
  });

  test("moves to the main header when a file opens", async ({ page }) => {
    const tree = page.getByRole("tree");
    await tree.getByRole("treeitem", { name: DIR, exact: true }).click();
    await tree.getByRole("treeitem", { name: FILE, exact: true }).click();
    await expect(page.getByRole("button", { name: "Back to folders" })).toBeVisible();
    await expect(hostAction(page)).toHaveCount(1);
    await expect(page.locator("header").getByRole("button", { name: "Host action" })).toBeVisible();
    await page.getByRole("button", { name: "Back to folders" }).click();
    await expect(page.getByRole("tree")).toBeVisible();
    await expect(hostAction(page)).toHaveCount(1);
    await expect(page.locator("header").getByRole("button", { name: "Host action" })).toHaveCount(0);
  });
});

test("the demo's Header actions switch shows the control and remembers it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fm:layout", "single"));
  await page.goto("/");
  await expect(hostAction(page)).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Header actions" }).click();
  await expect(hostAction(page)).toHaveCount(1);
  await page.reload();
  await expect(hostAction(page)).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Header actions" }).click();
  await expect(hostAction(page)).toHaveCount(0);
});
