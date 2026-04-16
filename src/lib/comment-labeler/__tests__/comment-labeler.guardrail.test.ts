import { describe, expect, it } from "vitest";
import { labelCommentText } from "@/lib/comment-labeler";
import type { Label, LabeledToken } from "@/lib/comment-labeler";

/*
This test protects comment labeling behavior for LLM handoff. Do not weaken or rewrite it unless the product specification explicitly changes.
*/

const aprilRange = { start: "2026-04-01", end: "2026-04-30" } as const;

function tokensFor(comment: string) {
  return labelCommentText(comment, { eventDateRange: aprilRange }).tokens;
}

function expectLabel(tokens: LabeledToken[], label: Label, text?: string) {
  expect(
    tokens.some((token) => token.label === label && (text ? token.text === text : true)),
  ).toBe(true);
}

describe("comment labeler guardrails", () => {
  it("labels simple weekday negatives", () => {
    const tokens = tokensFor("平日は無理");

    expectLabel(tokens, "target_weekday_group", "平日");
    expectLabel(tokens, "particle_topic", "は");
    expectLabel(tokens, "availability_negative", "無理");
  });

  it("labels date and time targets plus positive availability", () => {
    const tokens = tokensFor("5日は午前はいける");

    expectLabel(tokens, "target_date", "5日");
    expectLabel(tokens, "target_time_of_day", "午前");
    expect(tokens.filter((token) => token.label === "particle_topic" && token.text === "は").length).toBeGreaterThanOrEqual(2);
    expectLabel(tokens, "availability_positive", "いける");
  });

  it("labels explicit day ranges and keeps range plus time-of-day together", () => {
    const range = tokensFor("10~13はいけます");
    const wordRange = tokensFor("10から13までいける");
    const rangeNight = tokensFor("10-13の夜ならいけます");

    expectLabel(range, "target_date_range", "10~13");
    expectLabel(range, "availability_positive", "いけます");
    expectLabel(wordRange, "target_date_range", "10から13まで");
    expectLabel(wordRange, "availability_positive", "いける");

    expectLabel(rangeNight, "target_date_range", "10-13");
    expectLabel(rangeNight, "target_time_of_day", "夜");
    expectLabel(rangeNight, "conditional_marker", "なら");
    expectLabel(rangeNight, "availability_positive", "いけます");
  });

  it("keeps uncertainty markers separate from the positive core", () => {
    const positiveMaybe = tokensFor("5日は午前はいけるかも");
    const negativeMaybe = tokensFor("5日は午前は無理かも");

    expectLabel(positiveMaybe, "availability_positive", "いける");
    expectLabel(positiveMaybe, "uncertainty_marker", "かも");
    expectLabel(negativeMaybe, "availability_negative", "無理");
    expectLabel(negativeMaybe, "uncertainty_marker", "かも");
  });

  it("labels residual and all-scope hints separately from availability", () => {
    const residual = tokensFor("あとは大丈夫");
    const all = tokensFor("全日いける");
    const basic = tokensFor("基本大丈夫");

    expectLabel(residual, "scope_residual", "あとは");
    expectLabel(residual, "availability_positive", "大丈夫");
    expectLabel(all, "scope_all", "全日");
    expectLabel(all, "availability_positive", "いける");
    expectLabel(basic, "scope_all", "基本");
    expectLabel(basic, "availability_positive", "大丈夫");
  });

  it("labels desire, unknown, uncertainty, and hypothetical hints", () => {
    const desire = tokensFor("行けたらいいな");
    const uncertain = tokensFor("どーやろ");
    const maybe = tokensFor("多分いける");
    const tentative = tokensFor("一応いける");
    const oneChance = tokensFor("ワンチャンいける");

    expectLabel(desire, "hypothetical_marker", "たら");
    expectLabel(desire, "desire_marker", "いいな");
    expectLabel(uncertain, "availability_unknown", "どーやろ");
    expectLabel(maybe, "uncertainty_marker", "多分");
    expectLabel(maybe, "availability_positive", "いける");
    expectLabel(tentative, "uncertainty_marker", "一応");
    expectLabel(tentative, "emphasis_marker", "一応");
    expectLabel(oneChance, "hypothetical_marker", "ワンチャン");
    expectLabel(oneChance, "availability_positive", "いける");
  });

  it("labels explicit preference phrases separately from availability", () => {
    const preferred = tokensFor("10日がいいです");
    const barePreferred = tokensFor("10がいいです");
    const softer = tokensFor("できたら10がいいです");
    const better = tokensFor("4/10はいけますが、できれば12の方がいいです");
    const ideal = tokensFor("10が理想");
    const helpful = tokensFor("10だと助かる");
    const possible = tokensFor("可能なら10");

    expectLabel(preferred, "target_date", "10日");
    expectLabel(preferred, "desire_marker", "がいいです");

    expectLabel(barePreferred, "target_date", "10");
    expectLabel(barePreferred, "desire_marker", "がいいです");

    expectLabel(softer, "target_date", "10");
    expectLabel(softer, "hypothetical_marker", "できたら");
    expectLabel(softer, "desire_marker", "がいいです");

    expectLabel(better, "target_date", "4/10");
    expectLabel(better, "availability_positive", "いけます");
    expectLabel(better, "desire_marker", "できれば");
    expectLabel(better, "target_date", "12");
    expectLabel(better, "desire_marker", "の方がいいです");

    expectLabel(ideal, "target_date", "10");
    expectLabel(ideal, "desire_marker", "が理想");

    expectLabel(helpful, "target_date", "10");
    expectLabel(helpful, "desire_marker", "だと助かる");

    expectLabel(possible, "hypothetical_marker", "可能なら");
    expectLabel(possible, "target_date", "10");
  });

  it("uses composite patterns for soft positives without over-relying on final interpretation", () => {
    const doubleNegative = tokensFor("行けなくはない");
    const notImpossible = tokensFor("無理ではない");

    expectLabel(doubleNegative, "availability_positive", "行けなくはない");
    expectLabel(notImpossible, "availability_positive", "無理ではない");
    expect(doubleNegative.some((token) => token.label === "availability_negative")).toBe(false);
    expect(notImpossible.some((token) => token.label === "availability_negative")).toBe(false);
  });

  it("covers colloquial negative and unknown phrases", () => {
    const impossibleLike = tokensFor("むりぽ");
    const vague = tokensFor("びみょ");

    expectLabel(impossibleLike, "availability_negative", "むりぽ");
    expectLabel(vague, "availability_unknown", "びみょ");
  });

  it("labels condition markers around time targets and dependency phrases", () => {
    const night = tokensFor("夜ならいける");
    const work = tokensFor("仕事次第");
    const classMaybe = tokensFor("授業次第で無理かも");

    expectLabel(night, "target_time_of_day", "夜");
    expectLabel(night, "conditional_marker", "なら");
    expectLabel(night, "particle_condition", "なら");
    expectLabel(work, "availability_unknown", "仕事次第");
    expectLabel(classMaybe, "availability_unknown", "授業次第");
    expectLabel(classMaybe, "conditional_marker", "授業次第で");
    expectLabel(classMaybe, "availability_negative", "無理");
    expectLabel(classMaybe, "uncertainty_marker", "かも");
  });

  it("labels contrast and multiple targets in one sentence", () => {
    const dates = tokensFor("5日はいけるけど6日は無理");
    const weekdays = tokensFor("平日は厳しいけど土日はいける");

    expectLabel(dates, "target_date", "5日");
    expectLabel(dates, "availability_positive", "いける");
    expectLabel(dates, "conjunction_contrast", "けど");
    expectLabel(dates, "target_date", "6日");
    expectLabel(dates, "availability_negative", "無理");

    expectLabel(weekdays, "target_weekday_group", "平日");
    expectLabel(weekdays, "availability_negative", "厳しい");
    expectLabel(weekdays, "target_weekday_group", "土日");
    expectLabel(weekdays, "availability_positive", "いける");
  });

  it("labels limit particles, emphasis, and time-target combinations", () => {
    const morningOnly = tokensFor("朝だけ無理");
    const easyNight = tokensFor("夜は全然いける");
    const afternoonChance = tokensFor("午後ならワンチャン");
    const lastTrain = tokensFor("終電までなら大丈夫");
    const nightOnly = tokensFor("夜だけならいける");
    const bareOnly = tokensFor("10だけいける");
    const bareException = tokensFor("10以外無理");
    const bareConditional = tokensFor("10ならいけるかも");
    const exceptive = tokensFor("10じゃないと無理");

    expectLabel(morningOnly, "target_time_of_day", "朝");
    expectLabel(morningOnly, "particle_limit", "だけ");
    expectLabel(morningOnly, "availability_negative", "無理");

    expectLabel(easyNight, "target_time_of_day", "夜");
    expectLabel(easyNight, "emphasis_marker", "全然");
    expectLabel(easyNight, "availability_positive", "いける");

    expectLabel(afternoonChance, "target_time_of_day", "午後");
    expectLabel(afternoonChance, "conditional_marker", "なら");
    expectLabel(afternoonChance, "hypothetical_marker", "ワンチャン");

    expectLabel(lastTrain, "target_time_of_day", "終電まで");
    expectLabel(lastTrain, "conditional_marker", "なら");
    expectLabel(lastTrain, "availability_positive", "大丈夫");

    expectLabel(nightOnly, "target_time_of_day", "夜");
    expectLabel(nightOnly, "particle_limit", "だけ");
    expectLabel(nightOnly, "conditional_marker", "なら");
    expectLabel(nightOnly, "particle_condition", "なら");
    expectLabel(nightOnly, "availability_positive", "いける");

    expectLabel(bareOnly, "target_date", "10");
    expectLabel(bareOnly, "particle_limit", "だけ");
    expectLabel(bareOnly, "availability_positive", "いける");

    expectLabel(bareException, "target_date", "10");
    expectLabel(bareException, "scope_exception", "以外");
    expectLabel(bareException, "availability_negative", "無理");

    expectLabel(bareConditional, "target_date", "10");
    expectLabel(bareConditional, "conditional_marker", "なら");
    expectLabel(bareConditional, "uncertainty_marker", "かも");
    expectLabel(bareConditional, "availability_positive", "いける");

    expectLabel(exceptive, "target_date", "10");
    expectLabel(exceptive, "scope_exception", "じゃないと");
    expectLabel(exceptive, "availability_negative", "無理");
  });

  it("labels residual scope with target dates and chrono-extracted dates", () => {
    const residual = tokensFor("5日は無理、あとはいける");
    const datedMaybe = tokensFor("4/12はたぶんいける");
    const fridayNight = tokensFor("金曜の夜ならいけそう");
    const segment = tokensFor("第2週後半は厳しいかも");

    expectLabel(residual, "target_date", "5日");
    expectLabel(residual, "availability_negative", "無理");
    expectLabel(residual, "scope_residual", "あとは");
    expectLabel(residual, "availability_positive", "いける");

    expectLabel(datedMaybe, "target_date", "4/12");
    expectLabel(datedMaybe, "uncertainty_marker", "たぶん");
    expectLabel(datedMaybe, "availability_positive", "いける");

    expectLabel(fridayNight, "target_weekday", "金曜");
    expectLabel(fridayNight, "particle_link", "の");
    expectLabel(fridayNight, "target_time_of_day", "夜");
    expectLabel(fridayNight, "conditional_marker", "なら");
    expectLabel(fridayNight, "availability_positive", "いけそう");

    expectLabel(segment, "target_week_ordinal", "第2週");
    expectLabel(segment, "target_month_part", "後半");
    expectLabel(segment, "availability_negative", "厳しい");
    expectLabel(segment, "uncertainty_marker", "かも");
  });

  it("labels mixed bare-date lists without dropping later dates", () => {
    const negativeList = tokensFor("11、12、13は無理");
    const mixedList = tokensFor("行ける日は11,12、13,14だけ");

    expectLabel(negativeList, "target_date", "11");
    expectLabel(negativeList, "target_date", "12");
    expectLabel(negativeList, "target_date", "13");
    expectLabel(negativeList, "availability_negative", "無理");

    expectLabel(mixedList, "availability_positive", "行ける");
    expectLabel(mixedList, "target_date", "11");
    expectLabel(mixedList, "target_date", "12");
    expectLabel(mixedList, "target_date", "13");
    expectLabel(mixedList, "target_date", "14");
    expectLabel(mixedList, "particle_limit", "だけ");
  });

  it("returns tokens in source order with span information", () => {
    const { normalizedText, tokens } = labelCommentText("平日は無理 5日は午前はいけるかも", { eventDateRange: aprilRange });

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((token) => token.start >= 0 && token.end > token.start && token.end <= normalizedText.length)).toBe(true);
    expect(tokens.every((token, index) => index === 0 || tokens[index - 1]!.start <= token.start)).toBe(true);
  });

  it("labels residual and exception scopes as structural hints", () => {
    const residual = tokensFor("それ以外は大丈夫");
    const exceptDate = tokensFor("5日以外はいける");
    const exceptWeekday = tokensFor("平日を除いて大丈夫");
    const commaResidual = tokensFor("5日は無理、あとはいける");

    expectLabel(residual, "scope_residual", "それ以外は");
    expectLabel(residual, "availability_positive", "大丈夫");

    expectLabel(exceptDate, "target_date", "5日");
    expectLabel(exceptDate, "scope_exception", "以外は");
    expectLabel(exceptDate, "availability_positive", "いける");

    expectLabel(exceptWeekday, "target_weekday_group", "平日");
    expectLabel(exceptWeekday, "scope_exception", "を除いて");
    expectLabel(exceptWeekday, "availability_positive", "大丈夫");

    expectLabel(commaResidual, "punctuation_boundary", "、");
    expectLabel(commaResidual, "scope_residual", "あとは");
  });

  it("labels richer parallel, topic, and contrast structure hints", () => {
    const datePair = tokensFor("5日と6日は無理");
    const timePair = tokensFor("朝と夜はいける");
    const broadPair = tokensFor("平日も土曜も厳しい");
    const topicalized = tokensFor("5日については無理");
    const simpleContrast = tokensFor("ただ6日は行ける");
    const nightContrast = tokensFor("でも夜は厳しい");
    const oneSide = tokensFor("一方で土日は空いてる");

    expectLabel(datePair, "target_date", "5日");
    expectLabel(datePair, "target_date", "6日");
    expectLabel(datePair, "conjunction_parallel", "と");
    expectLabel(datePair, "particle_link", "と");

    expectLabel(timePair, "target_time_of_day", "朝");
    expectLabel(timePair, "target_time_of_day", "夜");
    expectLabel(timePair, "conjunction_parallel", "と");

    expectLabel(broadPair, "target_weekday_group", "平日");
    expectLabel(broadPair, "target_weekday", "土曜");
    expect(broadPair.filter((token) => token.label === "conjunction_parallel" && token.text === "も").length).toBeGreaterThanOrEqual(2);

    expectLabel(topicalized, "target_date", "5日");
    expectLabel(topicalized, "particle_topic", "については");

    expectLabel(simpleContrast, "conjunction_contrast", "ただ");
    expectLabel(simpleContrast, "target_date", "6日");
    expectLabel(simpleContrast, "availability_positive", "行ける");

    expectLabel(nightContrast, "conjunction_contrast", "でも");
    expectLabel(nightContrast, "target_time_of_day", "夜");
    expectLabel(nightContrast, "availability_negative", "厳しい");

    expectLabel(oneSide, "conjunction_contrast", "一方で");
    expectLabel(oneSide, "target_weekday_group", "土日");
    expectLabel(oneSide, "availability_positive", "空いてる");
  });

  it("keeps the token stream readable for LLM consumption by trimming noisy inner structure", () => {
    const contrast = tokensFor("平日は無理だけど土日はいける");
    const maybe = tokensFor("5日は午前ならいけるかも");
    const compositePositive = tokensFor("行けなくはない");
    const compositeNegative = tokensFor("無理ではない");
    const fridayNight = tokensFor("金曜の夜ならいけそう");
    const residual = tokensFor("それ以外は大丈夫");

    expect(contrast.some((token) => token.label === "particle_limit" && token.text === "だけ")).toBe(false);
    expect(maybe.some((token) => token.label === "particle_link" && token.text === "か")).toBe(false);
    expect(maybe.some((token) => token.label === "conjunction_parallel" && token.text === "も")).toBe(false);
    expect(compositePositive.some((token) => token.label === "particle_topic" && token.text === "は")).toBe(false);
    expect(compositeNegative.some((token) => token.label === "particle_link" && token.text === "で")).toBe(false);
    expect(compositeNegative.some((token) => token.label === "particle_topic" && token.text === "は")).toBe(false);
    expect(fridayNight.some((token) => token.label === "target_date" && token.text === "金曜")).toBe(false);
    expect(residual.some((token) => token.label === "scope_exception")).toBe(false);
  });

  it("returns an LLM-friendly top-level shape without breaking the existing one", () => {
    const labeled = labelCommentText("5日は無理、あとはいける", { eventDateRange: aprilRange });

    expect(labeled.originalText).toBe("5日は無理、あとはいける");
    expect(labeled.rawText).toBe("5日は無理、あとはいける");
    expect(labeled.tokens.length).toBeGreaterThan(0);
  });
});
