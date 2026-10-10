import { describe, expect, it } from "vitest";
import {
  BOARD_H, BOARD_W, PORTRAIT_H, PORTRAIT_W, anchor, layoutPortraits, portraitAt, threadGeometry,
} from "./caseBoardLayout";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `person_${i}`);

describe("layoutPortraits", () => {
  it.each([3, 4, 5, 6])("keeps %i portraits on the board and apart", (n) => {
    const places = layoutPortraits(ids(n));
    const list = Object.values(places);
    expect(list).toHaveLength(n);
    for (const p of list) {
      expect(p.x - PORTRAIT_W / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + PORTRAIT_W / 2).toBeLessThanOrEqual(BOARD_W);
      expect(p.y - PORTRAIT_H / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + PORTRAIT_H / 2).toBeLessThanOrEqual(BOARD_H);
    }
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const overlapX = Math.abs(list[i].x - list[j].x) < PORTRAIT_W;
        const overlapY = Math.abs(list[i].y - list[j].y) < PORTRAIT_H;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("does not depend on the order the ids arrive in", () => {
    expect(layoutPortraits(["b", "c", "a"])).toEqual(layoutPortraits(["a", "b", "c"]));
  });

  it("mirrors the right half toward the middle, the left half away, and flips the centre per person", () => {
    const places = layoutPortraits(ids(6));
    for (const p of Object.values(places)) {
      if (p.x > BOARD_W / 2 + 1) expect(p.flip).toBe(true);
      if (p.x < BOARD_W / 2 - 1) expect(p.flip).toBe(false);
    }
    const centre = Array.from({ length: 40 }, (_, i) => layoutPortraits([`a${i}`])[`a${i}`].flip);
    expect(centre.some(Boolean) && centre.some((f) => !f)).toBe(true); // not always the same way
    expect(layoutPortraits(ids(4))).toEqual(layoutPortraits(ids(4))); // but stable for a person
  });

  it("gives the same person the same spot and tilt every time", () => {
    expect(layoutPortraits(ids(5))).toEqual(layoutPortraits(ids(5)));
    for (const p of Object.values(layoutPortraits(ids(5)))) expect(Math.abs(p.rot)).toBeLessThanOrEqual(3);
  });
});

describe("threads", () => {
  const places = layoutPortraits(ids(4));

  it("leaves each portrait at its edge, not its centre", () => {
    const [a, b] = [places.person_0, places.person_2];
    const start = anchor(a, b);
    expect(Math.hypot(start.x - a.x, start.y - a.y)).toBeGreaterThan(PORTRAIT_W / 2 - 1);
  });

  it("bows parallel threads between one pair to different sides", () => {
    const first = threadGeometry(places.person_0, places.person_1, 0);
    const second = threadGeometry(places.person_0, places.person_1, 1);
    expect(Math.hypot(first.mid.x - second.mid.x, first.mid.y - second.mid.y)).toBeGreaterThan(20);
  });

  it("finds the portrait under a point and skips the excluded one", () => {
    const p = places.person_1;
    expect(portraitAt(places, { x: p.x, y: p.y })).toBe("person_1");
    expect(portraitAt(places, { x: p.x, y: p.y }, "person_1")).toBeNull();
    expect(portraitAt(places, { x: -50, y: -50 })).toBeNull();
  });
});
