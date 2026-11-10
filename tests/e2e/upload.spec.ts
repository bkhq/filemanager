import type { Route } from "@playwright/test";
import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1280, height: 1200 },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fm:layout", "single");
    localStorage.setItem("fm-web:meta-off", "1");
  });
});

test("pauses and resumes a large upload", async ({ page }) => {
  await page.request.post("/api/fm/m/local/mkdir", {
    data: { path: "/pause-e2e" },
  });

  // Hold part uploads until the test lets them through.
  let hold = true;
  const held: Route[] = [];
  await page.route(/\/api\/fm\/m\/local\/uploads\/[^/]+\/parts\/\d+/, async (route) => {
    if (hold)
      held.push(route);
    else
      await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Storage" }).click();
  await page.getByRole("menuitemradio", { name: "Local disk", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.locator(`[data-path="/pause-e2e"]`).dblclick();
  await expect(page.getByText("This folder is empty")).toBeVisible();

  // 18 MiB in 4 MiB parts: five parts, at most three in flight.
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "paused.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(18 * 1024 * 1024, 3),
  });
  await expect.poll(() => held.length).toBe(3);

  const panel = page.getByRole("status", { name: "Uploads" });
  await panel.getByRole("button", { name: "Pause" }).click();
  await expect(panel.locator("[data-status=paused]")).toHaveCount(1);
  await expect(panel.getByText("Paused", { exact: true })).toBeVisible();

  // The paused requests were aborted by the page; let later ones through.
  hold = false;
  for (const route of held.splice(0))
    await route.continue().catch(() => {});

  await panel.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator(`[data-path="/pause-e2e/paused.bin"]`)).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator("[data-status=done]")).toHaveCount(1);
  const stat = await page.request.get("/api/fm/m/local/stat?path=/pause-e2e/paused.bin");
  expect((await stat.json()).size).toBe(18 * 1024 * 1024);
});
