import { describe, expect, it } from "bun:test";
import { createMermaidRenderer } from "./mermaid-render";

/** A fake mermaid whose renders finish only when the test releases them. */
function fakeMermaid() {
  const log: string[] = [];
  const pending: (() => void)[] = [];
  let theme = "";
  return {
    log,
    release: () => pending.shift()?.(),
    mermaid: {
      initialize: (config: { theme?: string }) => {
        theme = config.theme ?? "";
        log.push(`init ${theme}`);
      },
      render: (id: string, _code: string) => {
        log.push(`render ${id} start`);
        // The theme in effect when the render finishes is what the SVG gets.
        return new Promise<{ svg: string }>(resolve => pending.push(() => {
          log.push(`render ${id} end`);
          resolve({ svg: `${id}:${theme}` });
        }));
      },
    },
  };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe("createMermaidRenderer", () => {
  it("does not initialize again while another diagram is rendering", async () => {
    const fake = fakeMermaid();
    const render = createMermaidRenderer(async () => fake.mermaid);
    const a = render("a", "graph TD; A", false);
    const b = render("b", "graph TD; B", true);
    await tick();
    expect(fake.log).toEqual(["init default", "render a start"]);
    fake.release();
    expect(await a).toBe("a:default");
    await tick();
    expect(fake.log).toEqual([
      "init default",
      "render a start",
      "render a end",
      "init dark",
      "render b start",
    ]);
    fake.release();
    expect(await b).toBe("b:dark");
  });

  it("keeps rendering after a diagram fails", async () => {
    const fake = fakeMermaid();
    let calls = 0;
    const render = createMermaidRenderer(async () => ({
      initialize: fake.mermaid.initialize,
      render: (id: string, code: string) => ++calls === 1
        ? Promise.reject(new Error("Parse error"))
        : fake.mermaid.render(id, code),
    }));
    const bad = render("bad", "graph ???", false);
    const good = render("good", "graph TD; A", false);
    await expect(bad).rejects.toThrow("Parse error");
    await tick();
    fake.release();
    expect(await good).toBe("good:default");
  });
});
