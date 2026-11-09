import { describe, expect, it } from "bun:test";
import { centerOn, clampPan, INITIAL_VIEW, layoutOf, maxZoomOf, rotateBy, zoomAround } from "./transform";

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
      fit: 1,
    });
    expect(layoutOf(natural, { width: 200, height: 1000 }, INITIAL_VIEW)).toEqual({ width: 200, height: 100, fit: 0.5 });
    expect(layoutOf(natural, { width: 1000, height: 200 }, { ...INITIAL_VIEW, rotate: 90 })).toEqual({ width: 100, height: 200, fit: 0.5 });
  });

  it("zooms by a factor around a point, keeping it in place, within limits", () => {
    const at = { scale: 2, positionX: -100, positionY: -50 };
    const next = zoomAround(at, 1.5, { x: 300, y: 200 }, 8);
    expect(next.scale).toBe(3);
    // The content point under (300, 200) stays under it.
    expect((300 - next.positionX) / next.scale).toBeCloseTo((300 - at.positionX) / at.scale);
    expect((200 - next.positionY) / next.scale).toBeCloseTo((200 - at.positionY) / at.scale);
    expect(zoomAround(at, 10, { x: 0, y: 0 }, 8).scale).toBe(8);
    expect(zoomAround(at, 0.1, { x: 0, y: 0 }, 8).scale).toBe(1);
  });

  it("keeps the content over the viewport, centring an axis that fits", () => {
    const content = { width: 100, height: 50 };
    const viewport = { width: 200, height: 200 };
    expect(clampPan({ scale: 4, positionX: 50, positionY: 0 }, content, viewport)).toEqual({ scale: 4, positionX: 0, positionY: 0 });
    expect(clampPan({ scale: 4, positionX: -900, positionY: 0 }, content, viewport)).toEqual({ scale: 4, positionX: -200, positionY: 0 });
    // 200 tall content fills the viewport; shorter content is centred.
    expect(clampPan({ scale: 2, positionX: 0, positionY: 30 }, content, viewport)).toEqual({ scale: 2, positionX: 0, positionY: 50 });
  });

  it("centres the view on a fraction of the content, within bounds", () => {
    const content = { width: 100, height: 100 };
    const viewport = { width: 100, height: 100 };
    expect(centerOn({ x: 0.5, y: 0.5 }, 4, content, viewport)).toEqual({ scale: 4, positionX: -150, positionY: -150 });
    expect(centerOn({ x: 0, y: 1 }, 4, content, viewport)).toEqual({ scale: 4, positionX: 0, positionY: -300 });
    expect(centerOn({ x: -3, y: 9 }, 4, content, viewport)).toEqual({ scale: 4, positionX: 0, positionY: -300 });
  });

  it("lets every image zoom to at least four times its real size", () => {
    // Zoom is relative to the fitted size: 1 is fit, 1 / fit is real size.
    expect(maxZoomOf(1)).toBe(4);
    expect(maxZoomOf(0.5)).toBe(8);
    expect(maxZoomOf(0.17) * 0.17).toBeCloseTo(4);
  });
});
