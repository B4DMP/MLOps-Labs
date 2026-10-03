import { describe, expect, it } from "vitest";
import type { AtomicChange } from "../types/ActionCard";
import { sameAsLastPitch } from "./sameCard";

const ingest: AtomicChange = { target: "data.ingestion", kind: "raise_to", axis: "automation", value: 3 };
const validate: AtomicChange = { target: "data.validation", kind: "raise_to", axis: "automation", value: 2 };

describe("sameAsLastPitch", () => {
  it("matches the same changes in a different order", () => {
    expect(sameAsLastPitch([ingest, validate], [validate, ingest])).toBe(true);
  });

  it("treats a missing kind as raise_to", () => {
    const { kind: _k, ...bare } = ingest;
    expect(sameAsLastPitch([bare], [ingest])).toBe(true);
  });

  it("does not match once a value or the count differs", () => {
    expect(sameAsLastPitch([ingest], [{ ...ingest, value: 2 }])).toBe(false);
    expect(sameAsLastPitch([ingest, validate], [ingest])).toBe(false);
  });

  it("never matches before anything was pitched", () => {
    expect(sameAsLastPitch([], [])).toBe(false);
    expect(sameAsLastPitch([ingest], [])).toBe(false);
  });
});
