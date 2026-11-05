import { describe, expect, it } from "bun:test";
import { zipSync } from "fflate";
import { memoryDriver } from "../drivers/memory";
import { readAll } from "./driver";
import { openZipEntry, readZipEntries } from "./zip";

const text = (s: string) => new TextEncoder().encode(s);
const mtime = new Date(2026, 0, 2, 3, 4, 6);

function fixture() {
  return zipSync({
    "readme.txt": [
      text("hello zip"),
      { level: 0, mtime },
    ],
    "docs/": new Uint8Array(),
    "docs/long.txt": [
      text("lorem ipsum ".repeat(200)),
      { level: 9, mtime },
    ],
  });
}

/** Rewrites the EOCD of a zip into the Zip64 form (record + locator + EOCD with 0xFFFF markers). */
function toZip64(zip: Uint8Array) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  const entries = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  const rec = new DataView(new ArrayBuffer(56));
  rec.setUint32(0, 0x06064B50, true);
  rec.setBigUint64(4, 44n, true);
  rec.setBigUint64(24, BigInt(entries), true);
  rec.setBigUint64(32, BigInt(entries), true);
  rec.setBigUint64(40, BigInt(cdSize), true);
  rec.setBigUint64(48, BigInt(cdOffset), true);
  const loc = new DataView(new ArrayBuffer(20));
  loc.setUint32(0, 0x07064B50, true);
  loc.setBigUint64(8, BigInt(eocd), true);
  loc.setUint32(16, 1, true);
  const end = new Uint8Array(zip.slice(eocd));
  const ev = new DataView(end.buffer);
  ev.setUint16(8, 0xFFFF, true);
  ev.setUint16(10, 0xFFFF, true);
  ev.setUint32(12, 0xFFFFFFFF, true);
  ev.setUint32(16, 0xFFFFFFFF, true);
  return new Uint8Array([
    ...zip.slice(0, eocd),
    ...new Uint8Array(rec.buffer),
    ...new Uint8Array(loc.buffer),
    ...end,
  ]);
}

async function setup(bytes: Uint8Array) {
  const d = memoryDriver({ files: {} });
  await d.write("/a.zip", bytes);
  return d;
}

describe("readZipEntries", () => {
  it("lists entries from the central directory", async () => {
    const d = await setup(fixture());
    const { entries, truncated } = await readZipEntries(d, "/a.zip", 100);
    expect(truncated).toBe(false);
    expect(entries.map(e => [e.path, e.dir, e.size])).toEqual([
      ["readme.txt", false, 9],
      ["docs/", true, 0],
      ["docs/long.txt", false, 2400],
    ]);
    expect(entries[2]!.compressedSize).toBeLessThan(2400);
    expect(new Date(entries[0]!.mtime).getMinutes()).toBe(4);
    expect(entries[0]!.encrypted).toBe(false);
  });

  it("reads Zip64 end records and caps the entry count", async () => {
    const d = await setup(toZip64(fixture()));
    expect((await readZipEntries(d, "/a.zip", 100)).entries).toHaveLength(3);
    const capped = await readZipEntries(d, "/a.zip", 2);
    expect(capped).toMatchObject({ truncated: true });
    expect(capped.entries).toHaveLength(2);
  });

  it("flags encrypted entries and rejects non-zips", async () => {
    const zip = fixture();
    const v = new DataView(zip.buffer);
    // Set the encrypted flag on the first central directory header.
    let i = 0;
    while (v.getUint32(i, true) !== 0x02014B50) i++;
    v.setUint16(i + 8, v.getUint16(i + 8, true) | 1, true);
    const d = await setup(zip);
    expect((await readZipEntries(d, "/a.zip", 100)).entries.some(e => e.encrypted)).toBe(true);
    await d.write("/b.zip", text("not a zip at all"));
    await expect(readZipEntries(d, "/b.zip", 100)).rejects.toThrow();
  });
});

describe("openZipEntry", () => {
  it("streams stored and deflated entries", async () => {
    const d = await setup(fixture());
    const stored = await openZipEntry(d, "/a.zip", "readme.txt");
    expect(stored.size).toBe(9);
    expect(new TextDecoder().decode(await readAll(stored.body))).toBe("hello zip");
    const deflated = await openZipEntry(d, "/a.zip", "docs/long.txt");
    expect(new TextDecoder().decode(await readAll(deflated.body))).toBe("lorem ipsum ".repeat(200));
  });

  it("rejects folders and missing entries", async () => {
    const d = await setup(fixture());
    await expect(openZipEntry(d, "/a.zip", "docs/")).rejects.toThrow();
    await expect(openZipEntry(d, "/a.zip", "nope.txt")).rejects.toThrow();
  });
});
