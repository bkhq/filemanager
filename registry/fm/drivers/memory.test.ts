import { describe, expect, it } from "bun:test";
import { runDriverContract } from "../server/contract";
import { readAll } from "../server/driver";
import { memoryDriver } from "./memory";

runDriverContract("memory", async () => ({
  driver: memoryDriver(),
}));

runDriverContract("memory, native trash", async () => ({
  driver: memoryDriver({ nativeTrash: true }),
}));

// The options a flat, seeded storage (e.g. a skill that always holds SKILL.md) needs.
runDriverContract("memory, seeded root and no empty / copied folders", async () => ({
  driver: memoryDriver({
    files: { "/SKILL.md": "# Skill" },
  }),
}), {
  seeded: ["/SKILL.md"],
  emptyDirs: false,
  copyDirs: false,
});

describe("memoryDriver subfolder hints", () => {
  it("tells folders with subfolders from those without", async () => {
    const d = memoryDriver({
      files: { "/files/a.txt": "a", "/nested/deep/b.txt": "b" },
    });
    await d.mkdir("/empty");
    const by = Object.fromEntries((await d.list("/")).map(e => [e.name, e.hasSubfolders]));
    expect(by).toEqual({ files: false, nested: true, empty: false });
    expect((await d.stat("/nested")).hasSubfolders).toBe(true);
    expect((await d.stat("/files/a.txt")).hasSubfolders).toBeUndefined();
  });
});

describe("memoryDriver seed", () => {
  it("creates seeded files with parents", async () => {
    const d = memoryDriver({
      files: { "/docs/a.md": "# A" },
    });
    expect((await d.stat("/docs")).kind).toBe("dir");
    const res = await d.read("/docs/a.md");
    expect(new TextDecoder().decode(await readAll(res.body))).toBe("# A");
  });
});
