import { describe, expect, it } from "vitest";
import { isIdList, parseIds } from "./ids.client";

describe("id lists typed in the settings", () => {
  it("reads comma-separated ids, negative group ids included", () => {
    expect(parseIds(" 123456789, -1001234567890 ,")).toEqual([123456789, -1001234567890]);
  });

  it("reads an empty field as no ids", () => {
    expect(parseIds("  ")).toEqual([]);
    expect(isIdList("")).toBe(true);
  });

  it("rejects anything that is not a whole number", () => {
    expect(isIdList("123, @max")).toBe(false);
    expect(isIdList("1.5")).toBe(false);
    expect(isIdList("1e3")).toBe(false);
    expect(isIdList("0x10")).toBe(false);
    expect(isIdList("99999999999999999999")).toBe(false);
  });
});
