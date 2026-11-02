import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isFmError } from "../core/errors";
import { runDriverContract } from "../server/contract";
import { localDriver } from "./local";

async function tempRoot() {
  const base = await mkdtemp(join(tmpdir(), "fm-local-"));
  const root = join(base, "root");
  await mkdir(root);
  return {
    base,
    root,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  }
  catch (err) {
    return isFmError(err)
      ? err.code
      : String(err);
  }
}

runDriverContract("local", async () => {
  const t = await tempRoot();
  return {
    driver: localDriver({ root: t.root }),
    cleanup: t.cleanup,
  };
});

describe("localDriver jail", () => {
  it("hides symlinks that escape the root and refuses to follow them", async () => {
    const t = await tempRoot();
    try {
      await writeFile(join(t.base, "secret.txt"), "secret");
      await mkdir(join(t.base, "outside"));
      await symlink(join(t.base, "secret.txt"), join(t.root, "leak.txt"));
      await symlink(join(t.base, "outside"), join(t.root, "leakdir"));
      await writeFile(join(t.root, "ok.txt"), "ok");
      await symlink(join(t.root, "ok.txt"), join(t.root, "alias.txt"));
      const d = localDriver({ root: t.root });

      expect((await d.list("/")).map(e => e.name).sort()).toEqual(["alias.txt", "ok.txt"]);
      expect(await code(d.read("/leak.txt"))).toBe("NOT_FOUND");
      expect(await code(d.stat("/leakdir"))).toBe("NOT_FOUND");
      expect(await code(d.write("/leakdir/new.txt", new TextEncoder().encode("x")))).toBe("NOT_FOUND");
      expect(await code(d.list("/leakdir"))).toBe("NOT_FOUND");
      expect((await d.stat("/alias.txt")).size).toBe(2);
    }
    finally {
      await t.cleanup();
    }
  });

  it("enforces read-only mounts", async () => {
    const t = await tempRoot();
    try {
      const d = localDriver({ root: t.root, readOnly: true });
      expect(d.caps.write).toBe(false);
      expect(await code(d.mkdir("/x"))).toBe("UNSUPPORTED");
      expect(await code(d.remove("/x"))).toBe("UNSUPPORTED");
    }
    finally {
      await t.cleanup();
    }
  });

  it("can hide dotfiles", async () => {
    const t = await tempRoot();
    try {
      await writeFile(join(t.root, ".env"), "x");
      await writeFile(join(t.root, "a.txt"), "x");
      expect((await localDriver({ root: t.root, showHidden: false }).list("/")).map(e => e.name)).toEqual(["a.txt"]);
    }
    finally {
      await t.cleanup();
    }
  });

  it("leaves no temp files behind and refuses to remove the root", async () => {
    const t = await tempRoot();
    try {
      const d = localDriver({ root: t.root });
      await d.write("/a.txt", new TextEncoder().encode("1"));
      await d.write("/a.txt", new TextEncoder().encode("2"));
      expect((await d.list("/")).map(e => e.name)).toEqual(["a.txt"]);
      expect(await code(d.remove("/"))).toBe("INVALID");
    }
    finally {
      await t.cleanup();
    }
  });
});
