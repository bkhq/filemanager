import { describe, expect, it } from "bun:test";
import { clampZoom, INITIAL_VIEW, layoutOf, rotateBy } from "./transform";

describe("media transform", () => {
  it("rotates in quarter turns both ways", () => {
    expect(rotateBy(INITIAL_VIEW, 90).rotate).toBe(90);
    expect(rotateBy(INITIAL_VIEW, -90).rotate).toBe(270);
    expect(rotateBy({ ...INITIAL_VIEW, rotate: 270 }, 90).rotate).toBe(0);
  });

  it("fits without upscaling and swaps sides when turned", () => {
    const natural = { width: 400, height: 200 };
    expect(layoutOf(natural, { width: 1000, height: 1000 }, INITIAL_VIEW)).toEqual({
      width: 400,
      height: 200,
      scale: 1,
      fit: 1,
    });
    expect(layoutOf(natural, { width: 200, height: 1000 }, INITIAL_VIEW)).toMatchObject({ width: 200, height: 100, scale: 0.5 });
    expect(layoutOf(natural, { width: 1000, height: 200 }, { ...INITIAL_VIEW, rotate: 90 })).toMatchObject({ width: 100, height: 200, scale: 0.5 });
    expect(layoutOf(natural, { width: 100, height: 100 }, { ...INITIAL_VIEW, zoom: 2 })).toMatchObject({ width: 800, height: 400, fit: 0.25 });
  });

  it("clamps zoom", () => {
    expect(clampZoom(100)).toBe(8);
    expect(clampZoom(0)).toBe(0.05);
  });
});
