import { describe, expect, it } from "bun:test";
import { createSpringDrag, createSpringLoader, FM_SPRING_DELAY, springKey } from "./spring-load";

/** Manual clock: timers run only when `advance` passes their due time. */
function fakeTimers() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    schedule: (fn: () => void, ms: number) => {
      timers.set(++next, { at: now + ms, fn });
      return next;
    },
    cancel: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

function setup() {
  const clock = fakeTimers();
  const loader = createSpringLoader({ schedule: clock.schedule, cancel: clock.cancel });
  const opened: string[] = [];
  const open = (key: string) => () => opened.push(key);
  return { clock, loader, opened, open };
}

describe("createSpringLoader", () => {
  it("defaults to a delay of about 700 ms", () => {
    expect(FM_SPRING_DELAY).toBe(700);
  });

  it("opens the target after the delay", () => {
    const { clock, loader, opened, open } = setup();
    loader.enter("a", open("a"));
    clock.advance(FM_SPRING_DELAY - 1);
    expect(opened).toEqual([]);
    clock.advance(1);
    expect(opened).toEqual(["a"]);
  });

  it("cancels when the drag leaves the target", () => {
    const { clock, loader, opened, open } = setup();
    loader.enter("a", open("a"));
    clock.advance(300);
    loader.leave("a");
    clock.advance(FM_SPRING_DELAY);
    expect(opened).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it("ignores a leave of another target", () => {
    const { clock, loader, opened, open } = setup();
    loader.enter("a", open("a"));
    loader.enter("b", open("b"));
    loader.leave("a");
    clock.advance(FM_SPRING_DELAY);
    expect(opened).toEqual(["b"]);
  });

  it("cancels on cancel (drop, drag end)", () => {
    const { clock, loader, opened, open } = setup();
    loader.enter("a", open("a"));
    loader.cancel();
    clock.advance(FM_SPRING_DELAY);
    expect(opened).toEqual([]);
  });

  it("does not restart on repeated enters of the same target", () => {
    const { clock, loader, opened, open } = setup();
    loader.enter("a", open("a"));
    clock.advance(400);
    loader.enter("a", open("a"));
    clock.advance(300);
    expect(opened).toEqual(["a"]);
  });

  it("restarts for a new target", () => {
    const { clock, loader, opened, open } = setup();
    loader.enter("a", open("a"));
    clock.advance(400);
    loader.enter("b", open("b"));
    clock.advance(400);
    expect(opened).toEqual([]);
    clock.advance(300);
    expect(opened).toEqual(["b"]);
  });

  it("fires once while the drag keeps resting on the target", () => {
    const { clock, loader, opened, open } = setup();
    loader.enter("a", open("a"));
    clock.advance(FM_SPRING_DELAY);
    loader.enter("a", open("a"));
    clock.advance(FM_SPRING_DELAY * 3);
    expect(opened).toEqual(["a"]);
  });

  it("opens the same target again after leaving and coming back", () => {
    const { clock, loader, opened, open } = setup();
    loader.enter("a", open("a"));
    clock.advance(FM_SPRING_DELAY);
    loader.leave("a");
    loader.enter("a", open("a"));
    clock.advance(FM_SPRING_DELAY);
    expect(opened).toEqual(["a", "a"]);
  });

  it("honours a custom delay", () => {
    const clock = fakeTimers();
    const loader = createSpringLoader({ delay: 100, schedule: clock.schedule, cancel: clock.cancel });
    let fired = 0;
    loader.enter("a", () => fired++);
    clock.advance(100);
    expect(fired).toBe(1);
  });
});

describe("createSpringDrag", () => {
  const INTERNAL = "application/x-test";

  function drag() {
    const clock = fakeTimers();
    const spring = createSpringDrag(createSpringLoader({ schedule: clock.schedule, cancel: clock.cancel }));
    const opened: string[] = [];
    return { clock, spring, opened };
  }

  it("springs open for manager entries and OS files, not other drags", () => {
    for (const [types, fires] of [
      [
        [INTERNAL],
        true,
      ],
      [
        ["Files"],
        true,
      ],
      [
        ["text/plain"],
        false,
      ],
    ] as const) {
      const { clock, spring, opened } = drag();
      spring.over(types, INTERNAL, "m:/a", () => opened.push("a"));
      clock.advance(FM_SPRING_DELAY);
      expect(opened.length).toBe(fires
        ? 1
        : 0);
    }
  });

  it("does not open a folder under itself", () => {
    const { clock, spring, opened } = drag();
    spring.start([
      springKey("m", "/a"),
    ]);
    spring.over([INTERNAL], INTERNAL, springKey("m", "/a"), () => opened.push("a"));
    spring.over([INTERNAL], INTERNAL, springKey("other", "/a"), () => opened.push("other"));
    clock.advance(FM_SPRING_DELAY);
    expect(opened).toEqual(["other"]);
  });

  it("forgets the dragged entries and cancels on end", () => {
    const { clock, spring, opened } = drag();
    spring.start(["m:/a"]);
    spring.over([INTERNAL], INTERNAL, "m:/b", () => opened.push("b"));
    spring.end();
    clock.advance(FM_SPRING_DELAY);
    expect(opened).toEqual([]);
    spring.over([INTERNAL], INTERNAL, "m:/a", () => opened.push("a"));
    clock.advance(FM_SPRING_DELAY);
    expect(opened).toEqual(["a"]);
  });

  it("cancels on leave", () => {
    const { clock, spring, opened } = drag();
    spring.over(["Files"], INTERNAL, "m:/a", () => opened.push("a"));
    spring.leave("m:/a");
    clock.advance(FM_SPRING_DELAY);
    expect(opened).toEqual([]);
  });
});
