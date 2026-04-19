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

  it("labels preference, unknown, uncertainty, and hypothetical hints", () => {
    const desire = tokensFor("行けたらいいな");
    const uncertain = tokensFor("どーやろ");
    const maybe = tokensFor("多分いける");
    const tentative = tokensFor("一応いける");
    const oneChance = tokensFor("ワンチャンいける");

    expectLabel(desire, "hypothetical_marker", "たら");
    expectLabel(desire, "preference_positive_marker", "いいな");
    expect(desire.some((token) => token.label === "desire_marker")).toBe(false);
    expectLabel(uncertain, "availability_unknown", "どーやろ");
    expectLabel(maybe, "uncertainty_marker", "多分");
    expectLabel(maybe, "availability_positive", "いける");
    expectLabel(tentative, "weak_commitment_marker", "一応");
    expect(tentative.some((token) => token.label === "uncertainty_marker" && token.text === "一応")).toBe(false);
    expect(tentative.some((token) => token.label === "emphasis_marker" && token.text === "一応")).toBe(false);
    expectLabel(oneChance, "hypothetical_marker", "ワンチャン");
    expectLabel(oneChance, "availability_positive", "いける");
  });

  it("labels explicit preference phrases separately from availability", () => {
    const preferred = tokensFor("10日がいいです");
    const firstChoice = tokensFor("10が第一希望");
    const barePreferred = tokensFor("10がいいです");
    const softer = tokensFor("できたら10がいいです");
    const better = tokensFor("4/10はいけますが、できれば12の方がいいです");
    const betterSaturday = tokensFor("土曜の方が助かる");
    const sundayPreferred = tokensFor("日曜がいい");
    const ideal = tokensFor("10が理想");
    const helpful = tokensFor("10だと助かる");
    const possible = tokensFor("可能なら10");

    expectLabel(preferred, "target_date", "10日");
    expectLabel(preferred, "preference_positive_marker", "がいいです");
    expect(preferred.some((token) => token.label === "strength_marker")).toBe(false);
    expect(preferred.some((token) => token.label === "desire_marker")).toBe(false);

    expectLabel(firstChoice, "target_date", "10");
    expectLabel(firstChoice, "strength_marker", "が第一希望");

    expectLabel(barePreferred, "target_date", "10");
    expectLabel(barePreferred, "preference_positive_marker", "がいいです");

    expectLabel(softer, "target_date", "10");
    expectLabel(softer, "hypothetical_marker", "できたら");
    expectLabel(softer, "preference_positive_marker", "がいいです");

    expectLabel(better, "target_date", "4/10");
    expectLabel(better, "availability_positive", "いけます");
    expectLabel(better, "weak_commitment_marker", "できれば");
    expectLabel(better, "target_date", "12");
    expectLabel(better, "comparison_marker", "の方がいいです");
    expect(better.some((token) => token.label === "preference_positive_marker" && token.text === "の方がいいです")).toBe(false);

    expectLabel(betterSaturday, "target_weekday", "土曜");
    expectLabel(betterSaturday, "comparison_marker", "の方が助かる");
    expect(betterSaturday.some((token) => token.label === "preference_positive_marker" && token.text === "の方が助かる")).toBe(false);

    expectLabel(sundayPreferred, "target_weekday", "日曜");
    expectLabel(sundayPreferred, "preference_positive_marker", "がいい");
    expect(sundayPreferred.some((token) => token.label === "comparison_marker")).toBe(false);

    expectLabel(ideal, "target_date", "10");
    expectLabel(ideal, "preference_positive_marker", "が理想");

    expectLabel(helpful, "target_date", "10");
    expectLabel(helpful, "preference_positive_marker", "だと助かる");

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
    const contingent = tokensFor("次第");
    const classMaybe = tokensFor("次第で無理かも");

    expectLabel(night, "target_time_of_day", "夜");
    expectLabel(night, "conditional_marker", "なら");
    expectLabel(night, "particle_condition", "なら");
    expectLabel(contingent, "conditional_marker", "次第");
    expectLabel(classMaybe, "conditional_marker", "次第で");
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
    expectLabel(easyNight, "strength_marker", "全然");
    expectLabel(easyNight, "availability_positive", "いける");
    expect(easyNight.some((token) => token.label === "emphasis_marker")).toBe(false);

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

  it("labels representative known availability and modifier expressions without forcing final interpretation", () => {
    expectLabel(tokensFor("いける"), "availability_positive", "いける");
    expectLabel(tokensFor("無理"), "availability_negative", "無理");

    const probablyPositive = tokensFor("たぶんいける");
    expectLabel(probablyPositive, "uncertainty_marker", "たぶん");
    expectLabel(probablyPositive, "availability_positive", "いける");

    const maybePositive = tokensFor("いけるかも");
    expectLabel(maybePositive, "availability_positive", "いける");
    expectLabel(maybePositive, "uncertainty_marker", "かも");

    const conditional = tokensFor("10ならいける");
    expectLabel(conditional, "conditional_marker", "なら");
    expectLabel(conditional, "availability_positive", "いける");

    const limited = tokensFor("10だけいける");
    expectLabel(limited, "particle_limit", "だけ");
    expectLabel(limited, "availability_positive", "いける");

    const negativeMaybe = tokensFor("無理かも");
    expectLabel(negativeMaybe, "availability_negative", "無理");
    expectLabel(negativeMaybe, "uncertainty_marker", "かも");

    const severe = tokensFor("厳しい");
    expectLabel(severe, "availability_negative", "厳しい");

    const doubleNegative = tokensFor("行けなくはない");
    expectLabel(doubleNegative, "availability_positive", "行けなくはない");
    expect(doubleNegative.some((token) => token.label === "availability_negative")).toBe(false);

    const emphasis = tokensFor("普通にいける");
    expectLabel(emphasis, "strength_marker", "普通に");
    expectLabel(emphasis, "availability_positive", "いける");
    expect(emphasis.some((token) => token.label === "emphasis_marker")).toBe(false);

    const hypothetical = tokensFor("もし遅くなってもいいならいける");
    expectLabel(hypothetical, "hypothetical_marker", "もし");
    expectLabel(hypothetical, "conditional_marker", "なら");
    expectLabel(hypothetical, "availability_positive", "いける");
  });

  it("keeps preference expressions separate from availability", () => {
    const wishOnly = tokensFor("できればいきたい");
    const desireOnly = tokensFor("行きたい");
    expectLabel(wishOnly, "preference_positive_marker", "いきたい");
    expectLabel(wishOnly, "weak_commitment_marker", "できれば");
    expect(wishOnly.some((token) => token.label === "availability_positive")).toBe(false);
    expect(wishOnly.some((token) => token.label === "desire_marker")).toBe(false);

    expectLabel(desireOnly, "preference_positive_marker", "行きたい");
    expect(desireOnly.some((token) => token.label === "comparison_marker")).toBe(false);

    const preferredDate = tokensFor("できれば10がいい");
    expectLabel(preferredDate, "target_date", "10");
    expectLabel(preferredDate, "weak_commitment_marker", "できれば");
    expectLabel(preferredDate, "preference_positive_marker", "がいい");
    expect(preferredDate.some((token) => token.label === "availability_positive")).toBe(false);

    const avoidWish = tokensFor("できれば避けたい");
    expectLabel(avoidWish, "weak_commitment_marker", "できれば");
    expectLabel(avoidWish, "availability_negative", "避けたい");
  });

  it("keeps known tokens available even in mixed sentences", () => {
    const mixed = tokensFor("たぶん無理だけど、行けたら行く");

    expectLabel(mixed, "uncertainty_marker", "たぶん");
    expectLabel(mixed, "availability_negative", "無理");
    expectLabel(mixed, "conjunction_contrast", "だけど");
    expectLabel(mixed, "hypothetical_marker", "たら");
    expectLabel(mixed, "availability_positive", "行けたら行く");
  });

  it("does not over-emit inner noise tokens from larger known expressions", () => {
    const maybeOnly = tokensFor("かも");
    const contrastOnly = tokensFor("だけど");
    const residualOnly = tokensFor("あとは");

    expectLabel(maybeOnly, "uncertainty_marker", "かも");
    expect(maybeOnly.some((token) => token.label === "particle_condition" && token.text === "か")).toBe(false);

    expectLabel(contrastOnly, "conjunction_contrast", "だけど");
    expect(contrastOnly.some((token) => token.label === "particle_limit" && token.text === "だけ")).toBe(false);

    expectLabel(residualOnly, "scope_residual", "あとは");
    expect(residualOnly.some((token) => token.label === "conjunction_parallel" && token.text === "と")).toBe(false);
  });

  it("emits planned semantic labels for preference, comparison, negation, and weak commitment without over-capturing reasons", () => {
    const probablyPositive = tokensFor("たぶん行ける");
    const maybePositive = tokensFor("行けるかもしれない");
    const softAvoid = tokensFor("できれば他の日がいいけど行ける");
    const comparative = tokensFor("12日の方がいい");
    const conditionalPositive = tokensFor("遅くなってもいいなら行ける");
    const reasonNegative = tokensFor("バイトだから無理");
    const notImpossible = tokensFor("無理ではない");
    const doubleNegative = tokensFor("行けなくはない");
    const tentativePositive = tokensFor("一応行ける");
    const vague = tokensFor("微妙");
    const scheduled = tokensFor("予定がある");
    const priorCommitment = tokensFor("先約ある");
    const workReason = tokensFor("仕事で");
    const classReason = tokensFor("授業で");

    expectLabel(probablyPositive, "uncertainty_marker", "たぶん");
    expectLabel(probablyPositive, "availability_positive", "行ける");
    expect(probablyPositive.some((token) => token.label === "availability_negative")).toBe(false);

    expectLabel(maybePositive, "availability_positive", "行ける");
    expectLabel(maybePositive, "uncertainty_marker", "かもしれない");
    expect(maybePositive.some((token) => token.label === "availability_negative")).toBe(false);

    expectLabel(softAvoid, "weak_commitment_marker", "できれば");
    expectLabel(softAvoid, "preference_negative_marker", "他の日がいい");
    expectLabel(softAvoid, "conjunction_contrast", "けど");
    expectLabel(softAvoid, "availability_positive", "行ける");
    expect(softAvoid.some((token) => token.label === "availability_negative")).toBe(false);

    expectLabel(comparative, "target_date", "12日");
    expectLabel(comparative, "comparison_marker", "の方がいい");
    expect(comparative.some((token) => token.label === "preference_positive_marker" && token.text === "の方がいい")).toBe(false);
    expect(comparative.some((token) => token.label === "availability_positive")).toBe(false);

    expectLabel(conditionalPositive, "conditional_marker", "なら");
    expectLabel(conditionalPositive, "availability_positive", "行ける");
    expect(conditionalPositive.some((token) => token.label === "availability_negative")).toBe(false);

    expectLabel(reasonNegative, "availability_negative", "無理");
    expect(reasonNegative.some((token) => token.label === "availability_positive")).toBe(false);
    expect(reasonNegative.some((token) => token.label === "reason_marker")).toBe(false);

    expectLabel(notImpossible, "availability_positive", "無理ではない");
    expectLabel(notImpossible, "negation_marker", "ではない");
    expect(notImpossible.some((token) => token.label === "availability_negative")).toBe(false);

    expectLabel(doubleNegative, "availability_positive", "行けなくはない");
    expectLabel(doubleNegative, "negation_marker", "なくはない");
    expect(doubleNegative.some((token) => token.label === "availability_negative")).toBe(false);

    expectLabel(tentativePositive, "weak_commitment_marker", "一応");
    expect(tentativePositive.some((token) => token.label === "uncertainty_marker" && token.text === "一応")).toBe(false);
    expectLabel(tentativePositive, "availability_positive", "行ける");

    expectLabel(vague, "availability_unknown", "微妙");
    expect(vague.some((token) => token.label === "availability_positive")).toBe(false);
    expect(vague.some((token) => token.label === "availability_negative")).toBe(false);

    for (const reasonLike of [scheduled, priorCommitment, workReason, classReason]) {
      expect(reasonLike.some((token) => token.label === "reason_marker")).toBe(false);
      expect(reasonLike.some((token) => token.label === "availability_positive")).toBe(false);
      expect(reasonLike.some((token) => token.label === "availability_negative")).toBe(false);
      expect(reasonLike.some((token) => token.label === "availability_unknown")).toBe(false);
      expect(reasonLike.some((token) => token.label === "conditional_marker")).toBe(false);
    }
  });
});
