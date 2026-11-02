import { describe, expect, it } from "bun:test";
import { runDriverContract } from "../server/contract";
import { readAll } from "../server/driver";
import { memoryDriver } from "./memory";

runDriverContract("memory", async () => ({
  driver: memoryDriver(),
}));

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
