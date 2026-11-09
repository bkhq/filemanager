import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const DIR = "/image-e2e";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1
      ? 0xEDB88320 ^ (c >>> 1)
      : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Buffer) {
  let c = 0xFFFFFFFF;
  for (const b of bytes)
    c = CRC_TABLE[(c ^ b) & 0xFF]! ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([
    Buffer.from(type),
    data,
  ]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** An RGB PNG with a 100 px grid, so zoomed views have something to show. */
function gridPng(width: number, height: number) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 3;
      const line = x % 100 < 3 || y % 100 < 3;
      raw[o] = line
        ? 0
        : (x * 255 / width) | 0;
      raw[o + 1] = line
        ? 0
        : (y * 255 / height) | 0;
      raw[o + 2] = line ? 0 : 160;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An RGBA PNG whose left half is fully transparent. */
function halfClearPng(width: number, height: number) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = width / 2; x < width; x++)
      raw.writeUInt32BE(0x3366CCFF, y * stride + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function openImage(page: Page, name: string) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(dir => localStorage.setItem("fm:last", JSON.stringify({ mount: "local", path: dir })), DIR);
  await page.goto("/?variant=drive");
  await page.locator(`[data-path="${DIR}/${name}"]`).dblclick();
  const dialog = page.getByRole("dialog");
  const img = dialog.locator(`img[alt="${name}"]`);
  await expect(img).toBeVisible();
  const zoom = dialog.getByRole("button", { name: /^\d+%$/ });
  return {
    dialog,
    img,
    zoom,
    percent: async () => Number((await zoom.textContent())!.replace("%", "")),
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  for (const [name, w, h] of [
    ["huge.png", 6000, 4000],
    ["tall.png", 1000, 3000],
  ] as const) {
    expect((await request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`${DIR}/${name}`)}`, {
      data: gridPng(w, h),
    })).ok()).toBe(true);
  }
  expect((await request.put(`/api/fm/m/local/write?path=${encodeURIComponent(`${DIR}/clear.png`)}`, {
    data: halfClearPng(400, 300),
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

test("zooms a large image to its real size and beyond, and pans it", async ({ page }) => {
  const { dialog, img, zoom, percent } = await openImage(page, "huge.png");
  await expect.poll(percent).toBeLessThan(30);
  const fit = await percent();
  await expect(img).toHaveClass(/cursor-zoom-in/);

  // The percentage toggles between fit and real size.
  await zoom.click();
  await expect(zoom).toHaveText("100%");
  await expect(img).toHaveClass(/cursor-grab/);
  for (let i = 0; i < 3; i++)
    await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(percent).toBeGreaterThan(150);

  const before = (await img.boundingBox())!;
  const stage = (await dialog.locator(".react-transform-wrapper").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 - 200, stage.y + stage.height / 2 - 150, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await img.boundingBox())!.x).toBeLessThan(before.x - 100);

  await zoom.click();
  await expect.poll(percent).toBe(fit);
});

test("zooms over the whole stage, whatever the image's shape", async ({ page }) => {
  const { dialog, img } = await openImage(page, "tall.png");
  const fitted = (await img.boundingBox())!;
  for (let i = 0; i < 4; i++)
    await dialog.getByRole("button", { name: "Zoom in" }).click();
  const view = (await dialog.locator(".react-transform-wrapper").boundingBox())!;
  // The zoomed view spans the stage, not the column the fitted image took.
  expect(view.width).toBeGreaterThan(fitted.width * 3);
  await expect.poll(async () => (await img.boundingBox())!.width).toBeGreaterThan(fitted.width * 1.5);
});

test("shows a minimap while zoomed that moves the view", async ({ page }) => {
  const { dialog, img, zoom } = await openImage(page, "huge.png");
  const minimap = dialog.locator("[data-fm-minimap]");
  await expect(minimap).toHaveCount(0);
  await zoom.click();
  await expect(minimap).toBeVisible();
  const before = (await img.boundingBox())!;
  const map = (await minimap.boundingBox())!;
  // Its bottom-right corner shows the image's bottom-right part.
  await page.mouse.click(map.x + map.width - 4, map.y + map.height - 4);
  await expect.poll(async () => (await img.boundingBox())!.x).toBeLessThan(before.x - 100);
  await page.keyboard.press("0");
  await expect(minimap).toHaveCount(0);
});

test("shows the image's pixel size", async ({ page }) => {
  const { dialog } = await openImage(page, "huge.png");
  await expect(dialog.getByText("6000 × 4000")).toBeVisible();
});

test("draws a checkerboard behind transparent images", async ({ page }) => {
  const { dialog } = await openImage(page, "clear.png");
  await expect(dialog.locator("[data-fm-image-box]")).toHaveCSS("background-image", /linear-gradient/);
});

test("keeps the image over the view when moving with the minimap or zooming out", async ({ page }) => {
  const { dialog, img, zoom } = await openImage(page, "huge.png");
  await zoom.click();
  const minimap = dialog.locator("[data-fm-minimap]");
  await expect(minimap).toBeVisible();
  const stage = (await dialog.locator(".react-transform-wrapper").boundingBox())!;
  const covered = async () => {
    const b = (await img.boundingBox())!;
    return b.x <= stage.x + 1 && b.y <= stage.y + 1
      && b.x + b.width >= stage.x + stage.width - 1 && b.y + b.height >= stage.y + stage.height - 1;
  };
  const map = (await minimap.boundingBox())!;
  // Drag past each corner of the minimap.
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await page.mouse.down();
  await page.mouse.move(map.x - 300, map.y - 300, { steps: 6 });
  await expect.poll(covered).toBe(true);
  await page.mouse.move(1390, 890, { steps: 6 });
  await expect.poll(covered).toBe(true);
  const corner = (await img.boundingBox())!;
  expect(corner.x + corner.width).toBeLessThan(stage.x + stage.width + 2);
  await page.mouse.up();
  // Zooming out at the corner keeps the view on the image.
  await dialog.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(400);
  expect(await covered()).toBe(true);
});
