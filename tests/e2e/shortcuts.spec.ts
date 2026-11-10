import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fm:layout", "single");
    localStorage.setItem("fm-web:meta-off", "1");
  });
});

test("? opens the keyboard shortcuts and Escape closes them", async ({ page }) => {
  await page.goto("/");
  // The main column, where the manager's keys are handled.
  await page.locator("section[role=region]").first().focus();
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("row", { name: "Rename F2" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("? typed into the search box does not open the shortcuts", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "Search in this folder" });
  await search.click();
  await page.keyboard.press("?");
  await expect(search).toHaveValue("?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
