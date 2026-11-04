import { describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

describe("localDriver multipart", () => {
  const fill = (size: number, k: number) => new Uint8Array(size).fill(k);

  it("keeps parts across driver instances on the same root", async () => {
    const t = await tempRoot();
    try {
      const a = localDriver({ root: t.root });
      const id = await a.multipart!.begin("/big.bin");
      await a.multipart!.uploadPart!("/big.bin", id, 1, fill(4, 1), 4);

      const b = localDriver({ root: t.root });
      expect((await b.multipart!.listParts("/big.bin", id)).map(p => [p.n, p.size])).toEqual([
        [1, 4],
      ]);
      await b.multipart!.uploadPart!("/big.bin", id, 2, new Response(fill(2, 2)).body!, 2);
      await b.multipart!.complete("/big.bin", id, await b.multipart!.listParts("/big.bin", id));
      expect(new Uint8Array(await Bun.file(join(t.root, "big.bin")).arrayBuffer())).toEqual(new Uint8Array([1, 1, 1, 1, 2, 2]));
      expect(await readdir(join(t.root, ".fm-uploads", "parts"))).toEqual([]);
    }
    finally {
      await t.cleanup();
    }
  });

  it("rejects malformed upload ids, foreign paths and short parts", async () => {
    const t = await tempRoot();
    try {
      const mp = localDriver({ root: t.root }).multipart!;
      expect(await code(mp.listParts("/x", "../x"))).toBe("NOT_FOUND");
      expect(await code(mp.uploadPart!("/x", "../x", 1, fill(1, 1), 1))).toBe("NOT_FOUND");
      expect(await code(mp.complete("/x", "../x", []))).toBe("NOT_FOUND");
      expect(await code(mp.abort("/x", "../x"))).toBe("NOT_FOUND");
      expect(await code(mp.listParts("/x", crypto.randomUUID()))).toBe("NOT_FOUND");
      const id = await mp.begin("/x");
      expect(await code(mp.listParts("/y", id))).toBe("NOT_FOUND");
      expect(await code(mp.uploadPart!("/x", id, 0, fill(1, 1), 1))).toBe("INVALID");
      expect(await code(mp.uploadPart!("/x", id, 1, fill(1, 1), 2))).toBe("INVALID");
      expect(await mp.listParts("/x", id)).toEqual([]);
    }
    finally {
      await t.cleanup();
    }
  });

  it("uses a custom uploadDir outside the root and cleans it up", async () => {
    const t = await tempRoot();
    try {
      const uploadDir = join(t.base, "uploads");
      const mp = localDriver({ root: t.root, uploadDir }).multipart!;
      const id = await mp.begin("/c.bin");
      await mp.uploadPart!("/c.bin", id, 1, fill(3, 7), 3);
      expect(await readdir(uploadDir)).toEqual([id]);
      await mp.complete("/c.bin", id, await mp.listParts("/c.bin", id));
      expect(await readdir(uploadDir)).toEqual([]);
      expect(await readdir(t.root)).toEqual(["c.bin"]);
    }
    finally {
      await t.cleanup();
    }
  });

  it("has no multipart on read-only mounts", () => {
    expect(localDriver({ root: "/tmp", readOnly: true }).multipart).toBeUndefined();
  });
});

describe("localDriver gitIgnore search", () => {
  const hasGit = Bun.which("git") !== null;
  if (!hasGit)
    console.warn("git is not on PATH; skipping gitIgnore search tests");

  const git = async (cwd: string, ...args: string[]) => {
    const proc = Bun.spawn([
      "git",
      "-c",
      "user.name=fm",
      "-c",
      "user.email=fm@example.invalid",
      ...args,
    ], {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await proc.exited).toBe(0);
  };

  it.skipIf(!hasGit)("lists committed and untracked files, never ignored ones", async () => {
    const t = await tempRoot();
    try {
      await git(t.root, "init", "-q");
      await writeFile(join(t.root, ".gitignore"), "ignored.txt\nbuild/\n");
      await writeFile(join(t.root, "committed.txt"), "c");
      await git(t.root, "add", ".");
      await git(t.root, "commit", "-q", "-m", "init");
      await mkdir(join(t.root, "src"));
      await writeFile(join(t.root, "src", "untracked.txt"), "u");
      await writeFile(join(t.root, "ignored.txt"), "i");
      await mkdir(join(t.root, "build"));
      await writeFile(join(t.root, "build", "out.txt"), "b");

      const driver = localDriver({ root: t.root, gitIgnore: true });
      const found = await driver.search!("/", "txt", { limit: 10 });
      expect(found?.map(e => e.path).sort()).toEqual(["/committed.txt", "/src/untracked.txt"]);
      expect(found?.find(e => e.path === "/committed.txt")).toMatchObject({ kind: "file", size: 1 });

      const fuzzy = await driver.search!("/", "srcuntr", { limit: 10, mode: "fuzzy" });
      expect(fuzzy?.map(e => e.path)).toEqual(["/src/untracked.txt"]);
      const below = await driver.search!("/src", "txt", { limit: 10 });
      expect(below?.map(e => e.path)).toEqual(["/src/untracked.txt"]);
      expect(await driver.search!("/", "txt", { limit: 1 })).toHaveLength(1);
    }
    finally {
      await t.cleanup();
    }
  });

  it.skipIf(!hasGit)("returns null outside a work tree", async () => {
    const t = await tempRoot();
    try {
      await writeFile(join(t.root, "a.txt"), "a");
      expect(await localDriver({ root: t.root, gitIgnore: true }).search!("/", "a", { limit: 10 })).toBeNull();
    }
    finally {
      await t.cleanup();
    }
  });

  it.skipIf(!hasGit)("does not run a core.fsmonitor command from the repo config", async () => {
    const t = await tempRoot();
    try {
      const marker = join(t.base, "pwned");
      const hook = join(t.base, "hook.sh");
      await writeFile(hook, `#!/bin/sh\ntouch "${marker}"\n`);
      await chmod(hook, 0o755);
      await git(t.root, "init", "-q");
      await writeFile(join(t.root, "a.txt"), "a");
      await git(t.root, "add", ".");
      await git(t.root, "commit", "-q", "-m", "init");
      await git(t.root, "config", "core.fsmonitor", hook);

      const found = await localDriver({ root: t.root, gitIgnore: true }).search!("/", "a", { limit: 10 });
      expect(found?.map(e => e.path)).toEqual(["/a.txt"]);
      expect(await Bun.file(marker).exists()).toBe(false);
    }
    finally {
      await t.cleanup();
    }
  });

  it.skipIf(!hasGit)("treats directory names as literal pathspecs", async () => {
    const t = await tempRoot();
    try {
      await git(t.root, "init", "-q");
      await mkdir(join(t.root, ":(top)"));
      await writeFile(join(t.root, ":(top)", "inner.txt"), "i");
      await writeFile(join(t.root, "outer.txt"), "o");

      const found = await localDriver({ root: t.root, gitIgnore: true }).search!("/:(top)", "txt", { limit: 10 });
      expect(found?.map(e => e.path)).toEqual(["/:(top)/inner.txt"]);
    }
    finally {
      await t.cleanup();
    }
  });

  it.skipIf(!hasGit)("makes .git paths read-only", async () => {
    const t = await tempRoot();
    try {
      await git(t.root, "init", "-q");
      await mkdir(join(t.root, "sub"));
      await writeFile(join(t.root, "a.txt"), "a");
      const driver = localDriver({ root: t.root, gitIgnore: true });
      const body = new TextEncoder().encode("x");

      expect(await code(driver.write("/.git/config", body))).toBe("FORBIDDEN");
      expect(await code(driver.write("/.GIT/hooks/pre-commit", body))).toBe("FORBIDDEN");
      expect(await code(driver.mkdir("/.git/hooks2"))).toBe("FORBIDDEN");
      expect(await code(driver.move("/a.txt", "/sub/.git/x"))).toBe("FORBIDDEN");
      expect(await code(driver.move("/.git", "/moved"))).toBe("FORBIDDEN");
      expect(await code(driver.copy("/a.txt", "/.git/x"))).toBe("FORBIDDEN");
      expect(await code(driver.copy("/.git", "/copied"))).toBe("FORBIDDEN");
      expect(await code(driver.remove("/.git"))).toBe("FORBIDDEN");
      expect(await Bun.file(join(t.root, ".git", "HEAD")).exists()).toBe(true);

      expect(await code(localDriver({ root: t.root }).write("/.git/config", body))).toBeUndefined();
    }
    finally {
      await t.cleanup();
    }
  });

  it("has no search without gitIgnore", () => {
    expect(localDriver({ root: "/tmp" }).search).toBeUndefined();
  });
});

describe("localDriver gitIgnore listing", () => {
  const hasGit = Bun.which("git") !== null;
  if (!hasGit)
    console.warn("git is not on PATH; skipping gitIgnore listing tests");

  const git = async (cwd: string, ...args: string[]) => {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
    expect(await proc.exited).toBe(0);
  };

  const fixture = async (root: string) => {
    await writeFile(join(root, ".gitignore"), "dist/\n*.log\n");
    await writeFile(join(root, "keep.txt"), "k");
    await writeFile(join(root, "a.log"), "l");
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "out.js"), "o");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "m");
    await writeFile(join(root, "src", "debug.log"), "d");
  };

  const marks = (entries: { path: string; ignored?: boolean }[]) =>
    Object.fromEntries(entries.map(e => [e.path, e.ignored === true]));

  it.skipIf(!hasGit)("marks entries git ignores", async () => {
    const t = await tempRoot();
    try {
      await git(t.root, "init", "-q");
      await fixture(t.root);
      const driver = localDriver({ root: t.root, gitIgnore: true });

      const top = marks(await driver.list("/"));
      expect(top).toMatchObject({
        "/dist": true,
        "/a.log": true,
        "/src": false,
        "/.gitignore": false,
        "/keep.txt": false,
      });
      expect(marks(await driver.list("/src"))).toEqual({ "/src/main.ts": false, "/src/debug.log": true });
      expect(marks(await driver.list("/dist"))).toEqual({ "/dist/out.js": true });
    }
    finally {
      await t.cleanup();
    }
  });

  it.skipIf(!hasGit)("treats entry names as literal paths", async () => {
    const t = await tempRoot();
    try {
      await git(t.root, "init", "-q");
      await writeFile(join(t.root, ".gitignore"), "/dist\n");
      await mkdir(join(t.root, ":(top)dist"));
      await mkdir(join(t.root, "dist"));
      const entries = await localDriver({ root: t.root, gitIgnore: true }).list("/");
      expect(marks(entries)).toMatchObject({ "/dist": true, "/:(top)dist": false });
    }
    finally {
      await t.cleanup();
    }
  });

  it.skipIf(!hasGit)("marks nothing outside a work tree", async () => {
    const t = await tempRoot();
    try {
      await fixture(t.root);
      const entries = await localDriver({ root: t.root, gitIgnore: true }).list("/");
      expect(entries.map(e => e.path).sort()).toEqual([
        "/.gitignore",
        "/a.log",
        "/dist",
        "/keep.txt",
        "/src",
      ]);
      expect(entries.some(e => e.ignored)).toBe(false);
    }
    finally {
      await t.cleanup();
    }
  });

  it.skipIf(!hasGit)("marks nothing without gitIgnore", async () => {
    const t = await tempRoot();
    try {
      await git(t.root, "init", "-q");
      await fixture(t.root);
      const entries = await localDriver({ root: t.root }).list("/");
      expect(entries).toHaveLength(6);
      expect(entries.some(e => "ignored" in e)).toBe(false);
    }
    finally {
      await t.cleanup();
    }
  });

  it.skipIf(!hasGit)("does not run a core.fsmonitor command from the repo config", async () => {
    const t = await tempRoot();
    try {
      const marker = join(t.base, "pwned");
      const hook = join(t.base, "hook.sh");
      await writeFile(hook, `#!/bin/sh\ntouch "${marker}"\n`);
      await chmod(hook, 0o755);
      await git(t.root, "init", "-q");
      await fixture(t.root);
      await git(t.root, "config", "core.fsmonitor", hook);

      const entries = await localDriver({ root: t.root, gitIgnore: true }).list("/");
      expect(marks(entries)["/a.log"]).toBe(true);
      expect(await Bun.file(marker).exists()).toBe(false);
    }
    finally {
      await t.cleanup();
    }
  });
});
