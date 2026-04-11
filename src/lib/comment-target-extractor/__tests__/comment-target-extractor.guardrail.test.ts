import { describe, expect, it } from "vitest";
import { extractCommentTimeFeatures } from "@/lib/comment-target-extractor";
import type { ExtractedTimeTargetCandidate } from "@/lib/comment-target-extractor";

/*
This test protects extraction-layer behavior for comment parsing. Do not weaken or rewrite it unless the product specification explicitly changes.
*/

const aprilRange = { start: "2026-04-01", end: "2026-04-30" } as const;
const mayRange = { start: "2026-05-01", end: "2026-05-31" } as const;

function findTargets(comment: string, range = aprilRange) {
  return extractCommentTimeFeatures(comment, { eventDateRange: range }).targets;
}

function expectTarget(
  targets: ExtractedTimeTargetCandidate[],
  predicate: (target: ExtractedTimeTargetCandidate) => boolean,
) {
  expect(targets.some(predicate)).toBe(true);
}

describe("comment target extractor guardrails", () => {
  it("extracts a date candidate from 23日は無理", () => {
    const features = extractCommentTimeFeatures("23日は無理", { eventDateRange: aprilRange });

    expect(features.rawText).toBe("23日は無理");
    expect(features.normalizedText).toBe("23日は無理");
    expect(features.targets.length).toBeGreaterThan(0);
    expectTarget(features.targets, (target) => target.kind === "date" && target.text === "23日" && target.normalizedValue === "2026-04-23");
  });

  it("extracts a weekday target from 金曜はできれば避けたい", () => {
    const targets = findTargets("金曜はできれば避けたい");

    expectTarget(targets, (target) => target.kind === "weekday" && target.text === "金曜" && target.normalizedValue === "friday");
  });

  it("extracts date and time_of_day candidates from 24日夜ならいける", () => {
    const targets = findTargets("24日夜ならいける");

    expectTarget(targets, (target) => target.kind === "date" && target.text === "24日" && target.normalizedValue === "2026-04-24");
    expectTarget(targets, (target) => target.kind === "time_of_day" && target.text === "夜" && target.normalizedValue === "night");
    expect(targets.every((target) => !["positive_core", "negative_core", "complement_target"].includes(target.kind))).toBe(true);
  });

  it("extracts only time-related targets from broad and specific mixed text", () => {
    const targets = findTargets("平日は無理 5日は午前が無理 あとはいける");

    expectTarget(targets, (target) => target.kind === "weekday_group" && target.text === "平日");
    expectTarget(targets, (target) => target.kind === "date" && target.text === "5日" && target.normalizedValue === "2026-04-05");
    expectTarget(targets, (target) => target.kind === "time_of_day" && target.text === "午前" && target.normalizedValue === "morning");
    expect(targets.every((target) => target.text !== "あとは")).toBe(true);
  });

  it("does not treat unit-less numeric lists as date targets", () => {
    const targets = findTargets("1,2,3はいける");
    expect(targets.some((target) => target.kind === "date")).toBe(false);
  });

  it("extracts bare numeric days only in safe anchored contexts", () => {
    const bareAvailability = findTargets("10ならいける", mayRange);
    const bareLimit = findTargets("10だけいける", mayRange);
    const bareException = findTargets("10以外無理", mayRange);
    const bareDateTime = findTargets("10は昼ならいける", mayRange);
    const looseList = findTargets("11と12はどっちがいい？", mayRange);

    expectTarget(bareAvailability, (target) => target.kind === "date" && target.text === "10" && target.normalizedValue === "2026-05-10");
    expectTarget(bareLimit, (target) => target.kind === "date" && target.text === "10" && target.normalizedValue === "2026-05-10");
    expectTarget(bareException, (target) => target.kind === "date" && target.text === "10" && target.normalizedValue === "2026-05-10");
    expectTarget(bareDateTime, (target) => target.kind === "date" && target.text === "10" && target.normalizedValue === "2026-05-10");
    expectTarget(bareDateTime, (target) => target.kind === "time_of_day" && target.text === "昼" && target.normalizedValue === "noon");
    expect(looseList.some((target) => target.kind === "date")).toBe(false);
  });

  it("does not partially extract ambiguous ordinal lists", () => {
    const targets = findTargets("1,2周目はむりだけど後半なら行ける");

    expectTarget(targets, (target) => target.kind === "month_part" && target.text === "後半" && target.normalizedValue === "second_half");
    expect(targets.some((target) => target.kind === "week_ordinal")).toBe(false);
  });

  it("extracts explicit ordinal targets when they are safely separated", () => {
    const targets = findTargets("1周目と2周目");

    expectTarget(targets, (target) => target.kind === "week_ordinal" && target.text === "1周目" && target.normalizedValue === "week_1");
    expectTarget(targets, (target) => target.kind === "week_ordinal" && target.text === "2周目" && target.normalizedValue === "week_2");
  });

  it("extracts explicit day ranges and keeps attached time-of-day targets", () => {
    const positiveRange = findTargets("10~13はいけます");
    const negativeRange = findTargets("10〜13は無理です");
    const rangeWithNight = findTargets("10-13の夜ならいけます");

    expectTarget(
      positiveRange,
      (target) => target.kind === "date_range" && target.text === "10~13" && target.normalizedValue === "2026-04-10..2026-04-13",
    );
    expectTarget(
      negativeRange,
      (target) => target.kind === "date_range" && target.text === "10〜13" && target.normalizedValue === "2026-04-10..2026-04-13",
    );
    expectTarget(
      rangeWithNight,
      (target) => target.kind === "date_range" && target.text === "10-13" && target.normalizedValue === "2026-04-10..2026-04-13",
    );
    expectTarget(rangeWithNight, (target) => target.kind === "time_of_day" && target.text === "夜" && target.normalizedValue === "night");
  });

  it("extracts bare day targets only in explicit preference contexts", () => {
    const preferred = findTargets("できたら10がいいです");
    const better = findTargets("12の方がいいです");
    const prefixed = findTargets("可能なら10", mayRange);
    const ambiguous = findTargets("10とか13がいい");

    expectTarget(preferred, (target) => target.kind === "date" && target.text === "10" && target.normalizedValue === "2026-04-10");
    expectTarget(better, (target) => target.kind === "date" && target.text === "12" && target.normalizedValue === "2026-04-12");
    expectTarget(prefixed, (target) => target.kind === "date" && target.text === "10" && target.normalizedValue === "2026-05-10");
    expect(ambiguous.some((target) => target.kind === "date_range")).toBe(false);
  });

  it("extracts standalone weekday_group, holiday_related, month_part, week_ordinal, and time_of_day targets", () => {
    expectTarget(findTargets("平日"), (target) => target.kind === "weekday_group" && target.normalizedValue === "weekday");
    expectTarget(findTargets("週末"), (target) => target.kind === "weekday_group" && target.normalizedValue === "weekend");
    expectTarget(findTargets("休日"), (target) => target.kind === "holiday_related" && target.normalizedValue === "holiday");
    expectTarget(findTargets("祝日"), (target) => target.kind === "holiday_related" && target.normalizedValue === "public_holiday");
    expectTarget(findTargets("祝日前"), (target) => target.kind === "holiday_related" && target.normalizedValue === "holiday_eve");
    expectTarget(findTargets("後半"), (target) => target.kind === "month_part" && target.normalizedValue === "second_half");
    expectTarget(findTargets("上旬"), (target) => target.kind === "month_part" && target.normalizedValue === "early_month");
    expectTarget(findTargets("月末"), (target) => target.kind === "month_part" && target.normalizedValue === "month_end");
    expectTarget(findTargets("4周目"), (target) => target.kind === "week_ordinal" && target.normalizedValue === "week_4");
    expectTarget(findTargets("第4週"), (target) => target.kind === "week_ordinal" && target.normalizedValue === "week_4");
    expectTarget(findTargets("オール"), (target) => target.kind === "time_of_day" && target.normalizedValue === "overnight");
    expectTarget(findTargets("終電まで"), (target) => target.kind === "time_of_day" && target.normalizedValue === "until_last_train");
  });
});
