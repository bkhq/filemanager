import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const row = (page: Page, path: string) => page.locator(`[data-path="${path}"]`);

test.describe.configure({ mode: "serial" });
// Other specs fill the root; the folder sorts first so it stays inside the first screen of the virtual list.
test.use({
  viewport: { width: 1280, height: 1200 },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("fm:layout"))
      localStorage.setItem("fm:layout", "single");
    localStorage.setItem("fm-web:meta-off", "1");
  });
});

async function mkdirs(page: Page, ...paths: string[]) {
  for (const path of paths) {
    await page.request.post("/api/fm/m/local/mkdir", {
      data: { path },
    });
  }
}

/** Opens a folder of the local disk in the list layout. */
async function openLocal(page: Page, folder: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Storage" }).click();
  await page.getByRole("menuitemradio", { name: "Local disk", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await row(page, folder).dblclick();
}

/** A drag of a file from the OS, as the browser hands it to the page. */
function osFiles(page: Page) {
  return page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
    return dt;
  });
}

test("a drag of OS files resting on a folder row opens it", async ({ page }) => {
  await mkdirs(page, "/0-spring-e2e", "/0-spring-e2e/inner", "/0-spring-e2e/inner/deep");
  await openLocal(page, "/0-spring-e2e");
  const target = row(page, "/0-spring-e2e/inner");
  const dataTransfer = await osFiles(page);
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await page.waitForTimeout(1000);
  await expect(row(page, "/0-spring-e2e/inner/deep")).toBeVisible();
});

test("a short hover that leaves does not open the folder", async ({ page }) => {
  await openLocal(page, "/0-spring-e2e");
  const target = row(page, "/0-spring-e2e/inner");
  const dataTransfer = await osFiles(page);
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await page.waitForTimeout(200);
  await target.dispatchEvent("dragleave", { dataTransfer });
  await page.waitForTimeout(1000);
  await expect(target).toBeVisible();
  await expect(row(page, "/0-spring-e2e/inner/deep")).toHaveCount(0);
});

test("dragging an entry onto a folder row and holding opens it", async ({ page }) => {
  await mkdirs(page, "/0-spring-e2e/moved");
  await openLocal(page, "/0-spring-e2e");
  await row(page, "/0-spring-e2e/moved").hover();
  await page.mouse.down();
  const box = (await row(page, "/0-spring-e2e/inner").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(box.x + box.width / 2 + (i % 2), box.y + box.height / 2);
    await page.waitForTimeout(100);
  }
  await expect(row(page, "/0-spring-e2e/inner/deep")).toBeVisible();
  await page.mouse.up();
});

test("a drag resting on a path crumb opens that folder", async ({ page }) => {
  await openLocal(page, "/0-spring-e2e");
  await row(page, "/0-spring-e2e/inner").dblclick();
  await expect(row(page, "/0-spring-e2e/inner/deep")).toBeVisible();
  const crumb = page.getByRole("navigation", { name: "Path" }).getByRole("button", { name: "0-spring-e2e", exact: true });
  const dataTransfer = await osFiles(page);
  await crumb.dispatchEvent("dragenter", { dataTransfer });
  await crumb.dispatchEvent("dragover", { dataTransfer });
  await page.waitForTimeout(1000);
  await expect(row(page, "/0-spring-e2e/inner")).toBeVisible();
});

test("a drag resting on a tree folder expands and opens it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fm:layout", "split"));
  await page.goto("/");
  const tree = page.getByRole("tree");
  const local = tree.getByRole("treeitem", { name: "Local disk", exact: true });
  await local.getByRole("button").click();
  if (await local.getAttribute("aria-expanded") === "false")
    await local.getByRole("button").click();
  const folder = tree.locator("[data-tree-path=\"/0-spring-e2e\"]");
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  const dataTransfer = await osFiles(page);
  await folder.dispatchEvent("dragenter", { dataTransfer });
  await folder.dispatchEvent("dragover", { dataTransfer });
  await page.waitForTimeout(1000);
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await expect(tree.locator("[data-tree-path=\"/0-spring-e2e/inner\"]")).toBeVisible();
});
