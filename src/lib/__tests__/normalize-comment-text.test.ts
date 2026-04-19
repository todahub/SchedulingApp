import { describe, expect, it } from "vitest";
import { normalizeCommentText } from "@/lib/comment-normalizer/normalize-comment-text";

describe("normalizeCommentText", () => {
  it("keeps the original text and normalizes digits, spaces, and newlines", () => {
    expect(normalizeCommentText("  ４/８は\n行ける  ")).toEqual({
      originalText: "  ４/８は\n行ける  ",
      normalizedText: "4/8は 行ける",
    });
  });

  it("normalizes full-width digits inside range-like text without changing its meaning", () => {
    expect(normalizeCommentText("１０から１３は無理")).toEqual({
      originalText: "１０から１３は無理",
      normalizedText: "10から13は無理",
    });
  });

  it("keeps natural language intact while normalizing digits and spacing", () => {
    expect(normalizeCommentText("平日は無理、５日は 午前 が 無理")).toEqual({
      originalText: "平日は無理、５日は 午前 が 無理",
      normalizedText: "平日は無理、5日は 午前 が 無理",
    });
  });

  it("turns line breaks into single spaces without changing commas", () => {
    expect(normalizeCommentText("4/10,\n4/11 はいける")).toEqual({
      originalText: "4/10,\n4/11 はいける",
      normalizedText: "4/10, 4/11 はいける",
    });
  });

  it("collapses repeated spaces in preference-like text", () => {
    expect(normalizeCommentText("できれば   10がいい")).toEqual({
      originalText: "できれば   10がいい",
      normalizedText: "できれば 10がいい",
    });
  });
});
