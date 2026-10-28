import { describe, expect, it } from "vitest";
import { draftFrom, overridesFrom } from "./pacing-draft.client";

describe("pacing draft", () => {
  it("shows an unset setting as an empty field", () => {
    const draft = draftFrom({ stop_pct: 80 });
    expect(draft.stop_pct).toBe("80");
    expect(draft.weekly_target_pct).toBe("");
    expect(draft.weekly_pace).toBe("");
  });

  it("saves only the fields the user filled, as numbers", () => {
    const draft = { ...draftFrom({}), stop_pct: " 85 ", max_concurrency: "3", weekly_pace: "whole_week" };
    expect(overridesFrom(draft)).toEqual({ overrides: { stop_pct: 85, max_concurrency: 3, weekly_pace: "whole_week" } });
  });

  it("refuses a percent outside 0-100, a fractional or zero agent count, and text", () => {
    for (const [key, text] of [["stop_pct", "101"], ["up_margin_pct", "-1"], ["max_concurrency", "0"], ["max_concurrency", "2.5"], ["weekly_target_pct", "ninety"]] as const) {
      const result = overridesFrom({ ...draftFrom({}), [key]: text });
      expect(result, `${key}=${text}`).toMatchObject({ error: expect.stringContaining(key) });
    }
  });
});
