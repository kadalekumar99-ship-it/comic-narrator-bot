import { describe, expect, it } from "bun:test";
import { parseAuditPrompts } from "./verify.server";

const items = (first: number) =>
  Array.from({ length: 10 }, (_, offset) => ({
    n: first + offset,
    start: (first + offset) * 4,
    end: (first + offset) * 4 + 4,
    text: `Scene ${first + offset}`,
    prompt: `Existing prompt ${first + offset}`,
  }));

describe("parseAuditPrompts", () => {
  it.each([1, 11, 21])("maps global panel numbers beginning at %d", (first) => {
    const batch = items(first);
    const raw = batch.map((item) => `${item.n}) Verified scene prompt ${item.n}`).join("\n");
    const parsed = parseAuditPrompts(raw, batch);

    expect(parsed.size).toBe(10);
    expect(parsed.get(first)).toBe(`Verified scene prompt ${first}`);
    expect(parsed.get(first + 9)).toBe(`Verified scene prompt ${first + 9}`);
  });

  it("accepts a model that restarts a later batch at one", () => {
    const batch = items(21);
    const raw = batch.map((item, index) => `${index + 1}) Verified scene prompt ${item.n}`).join("\n");
    const parsed = parseAuditPrompts(raw, batch);

    expect(parsed.size).toBe(10);
    expect(parsed.get(21)).toBe("Verified scene prompt 21");
    expect(parsed.get(30)).toBe("Verified scene prompt 30");
  });
});