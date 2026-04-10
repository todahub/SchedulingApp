/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { describe, expect, it } from "vitest";
import { buildDerivedResponseFromComment, doesConstraintMatchCandidate, parseCommentConstraints } from "@/lib/comment-parser";
import type { EventCandidateRecord } from "@/lib/domain";

const candidates: EventCandidateRecord[] = [
  {
    id: "cand-1",
    eventId: "event-1",
    date: "2026-04-23",
    timeSlotKey: "day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-23",
    endDate: "2026-04-23",
    selectedDates: [],
    timeType: "fixed",
    startTime: "12:00",
    endTime: "17:00",
    note: null,
    sortOrder: 10,
  },
  {
    id: "cand-2",
    eventId: "event-1",
    date: "2026-04-24",
    timeSlotKey: "night",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-24",
    endDate: "2026-04-24",
    selectedDates: [],
    timeType: "fixed",
    startTime: "18:00",
    endTime: "22:00",
    note: null,
    sortOrder: 20,
  },
  {
    id: "cand-3",
    eventId: "event-1",
    date: "2026-04-25",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-25",
    endDate: "2026-04-25",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 30,
  },
  {
    id: "cand-4",
    eventId: "event-1",
    date: "2026-04-26",
    timeSlotKey: "day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-26",
    endDate: "2026-04-26",
    selectedDates: [],
    timeType: "fixed",
    startTime: "12:00",
    endTime: "17:00",
    note: null,
    sortOrder: 40,
  },
];

const multiDateCandidates: EventCandidateRecord[] = [
  {
    id: "multi-1",
    eventId: "event-2",
    date: "2026-05-04",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-05-04",
    endDate: "2026-05-04",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 10,
  },
  {
    id: "multi-2",
    eventId: "event-2",
    date: "2026-05-05",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-05-05",
    endDate: "2026-05-05",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 20,
  },
  {
    id: "multi-3",
    eventId: "event-2",
    date: "2026-05-11",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-05-11",
    endDate: "2026-05-11",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 30,
  },
  {
    id: "multi-4",
    eventId: "event-2",
    date: "2026-05-12",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-05-12",
    endDate: "2026-05-12",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 40,
  },
];

const complementCandidates: EventCandidateRecord[] = [
  {
    id: "complement-1",
    eventId: "event-3",
    date: "2026-04-01",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-01",
    endDate: "2026-04-01",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 10,
  },
  {
    id: "complement-2",
    eventId: "event-3",
    date: "2026-04-02",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-02",
    endDate: "2026-04-02",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 20,
  },
  {
    id: "complement-3",
    eventId: "event-3",
    date: "2026-04-03",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-03",
    endDate: "2026-04-03",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 30,
  },
  {
    id: "complement-4",
    eventId: "event-3",
    date: "2026-04-04",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-04",
    endDate: "2026-04-04",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 40,
  },
  {
    id: "complement-5",
    eventId: "event-3",
    date: "2026-04-05",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-05",
    endDate: "2026-04-05",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 50,
  },
  {
    id: "complement-6",
    eventId: "event-3",
    date: "2026-04-06",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-06",
    endDate: "2026-04-06",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 60,
  },
];

const weekdayResidualCandidates: EventCandidateRecord[] = [
  {
    id: "weekday-1",
    eventId: "event-4",
    date: "2026-04-03",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-03",
    endDate: "2026-04-03",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 10,
  },
  {
    id: "weekday-2",
    eventId: "event-4",
    date: "2026-04-04",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-04",
    endDate: "2026-04-04",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 20,
  },
  {
    id: "weekday-3",
    eventId: "event-4",
    date: "2026-04-05",
    timeSlotKey: "morning",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-05",
    endDate: "2026-04-05",
    selectedDates: [],
    timeType: "fixed",
    startTime: "09:00",
    endTime: "12:00",
    note: null,
    sortOrder: 30,
  },
  {
    id: "weekday-4",
    eventId: "event-4",
    date: "2026-04-05",
    timeSlotKey: "day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-05",
    endDate: "2026-04-05",
    selectedDates: [],
    timeType: "fixed",
    startTime: "12:00",
    endTime: "17:00",
    note: null,
    sortOrder: 40,
  },
  {
    id: "weekday-5",
    eventId: "event-4",
    date: "2026-04-06",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-06",
    endDate: "2026-04-06",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 50,
  },
];

const fullyCoveredResidualCandidates: EventCandidateRecord[] = [
  {
    id: "covered-1",
    eventId: "event-5",
    date: "2026-04-03",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-03",
    endDate: "2026-04-03",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 10,
  },
  {
    id: "covered-2",
    eventId: "event-5",
    date: "2026-04-05",
    timeSlotKey: "morning",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-05",
    endDate: "2026-04-05",
    selectedDates: [],
    timeType: "fixed",
    startTime: "09:00",
    endTime: "12:00",
    note: null,
    sortOrder: 20,
  },
  {
    id: "covered-3",
    eventId: "event-5",
    date: "2026-04-06",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-06",
    endDate: "2026-04-06",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 30,
  },
];

describe("comment parser regression", () => {
  it("parses date, date-time, and weekday constraints into the fixed JSON shape", () => {
    expect(parseCommentConstraints("23日は無理だけど、24日夜ならいける。金曜はできれば避けたい", candidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-23",
        polarity: "negative",
        level: "hard_no",
        reasonText: "23日は無理",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-24_night",
        polarity: "positive",
        level: "conditional",
        reasonText: "24日夜ならいける",
      },
      {
        targetType: "weekday",
        targetValue: "friday",
        polarity: "negative",
        level: "soft_no",
        reasonText: "金曜はできれば避けたい",
      },
    ]);
  });

  it("parses slash-formatted dates that were auto-inserted into the comment field", () => {
    expect(parseCommentConstraints("4/23は 無理。4/24は 夜ならいける", candidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-23",
        polarity: "negative",
        level: "hard_no",
        reasonText: "4/23は 無理",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-24_night",
        polarity: "positive",
        level: "conditional",
        reasonText: "4/24は 夜ならいける",
      },
    ]);
  });

  it("supports weekday-time combinations and the full discrete level set without forcing unknown text", () => {
    expect(parseCommentConstraints("金曜夜は確実に行ける。土日は未定。朝は厳しい", candidates)).toEqual([
      {
        targetType: "date_time",
        targetValue: "friday_night",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "金曜夜は確実に行ける",
      },
      {
        targetType: "weekday",
        targetValue: "saturday",
        polarity: "neutral",
        level: "unknown",
        reasonText: "土日は未定",
      },
      {
        targetType: "weekday",
        targetValue: "sunday",
        polarity: "neutral",
        level: "unknown",
        reasonText: "土日は未定",
      },
      {
        targetType: "time",
        targetValue: "morning",
        polarity: "negative",
        level: "soft_no",
        reasonText: "朝は厳しい",
      },
    ]);
  });

  it("handles mixed clauses, dense date-time text, and conditional wording in one comment", () => {
    expect(parseCommentConstraints("23は無理、24夜ならいける", candidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-23",
        polarity: "negative",
        level: "hard_no",
        reasonText: "23は無理",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-24_night",
        polarity: "positive",
        level: "conditional",
        reasonText: "24夜ならいける",
      },
    ]);
  });

  it("keeps week, weekend, weekday-night, and double-negative language in structured constraints", () => {
    expect(parseCommentConstraints("その週はまだ未定", candidates)).toEqual([
      {
        targetType: "date",
        targetValue: "week:2026-04-20",
        polarity: "neutral",
        level: "unknown",
        reasonText: "その週はまだ未定",
      },
    ]);

    expect(parseCommentConstraints("土日ならたぶん大丈夫", candidates)).toEqual([
      {
        targetType: "weekday",
        targetValue: "saturday",
        polarity: "positive",
        level: "conditional",
        reasonText: "土日ならたぶん大丈夫",
      },
      {
        targetType: "weekday",
        targetValue: "sunday",
        polarity: "positive",
        level: "conditional",
        reasonText: "土日ならたぶん大丈夫",
      },
    ]);

    expect(parseCommentConstraints("行けなくはない", candidates)).toEqual([
      {
        targetType: "time",
        targetValue: "all_day",
        polarity: "positive",
        level: "soft_yes",
        reasonText: "行けなくはない",
      },
    ]);

    expect(parseCommentConstraints("平日夜ならだいたい大丈夫", candidates)).toEqual([
      {
        targetType: "date_time",
        targetValue: "weekday_night",
        polarity: "positive",
        level: "conditional",
        reasonText: "平日夜ならだいたい大丈夫",
      },
    ]);
  });

  it("preserves specific targets when uncertain leading text is followed by a concrete condition", () => {
    expect(parseCommentConstraints("まだ予定わからないけど金曜夜はたぶんいける", candidates)).toEqual([
      {
        targetType: "date_time",
        targetValue: "friday_night",
        polarity: "positive",
        level: "soft_yes",
        reasonText: "金曜夜はたぶんいける",
      },
    ]);

    expect(parseCommentConstraints("土曜なら終日いける", candidates)).toEqual([
      {
        targetType: "date_time",
        targetValue: "saturday_all_day",
        polarity: "positive",
        level: "conditional",
        reasonText: "土曜なら終日いける",
      },
    ]);

    expect(parseCommentConstraints("その日はできれば避けたい", candidates)).toEqual([
      {
        targetType: "time",
        targetValue: "all_day",
        polarity: "negative",
        level: "soft_no",
        reasonText: "その日はできれば避けたい",
      },
    ]);
  });

  it("keeps weekday constraints when the comment only talks about weekdays", () => {
    expect(parseCommentConstraints("平日は厳しいです", multiDateCandidates)).toEqual([
      {
        targetType: "weekday",
        targetValue: "weekday",
        polarity: "negative",
        level: "soft_no",
        reasonText: "平日は厳しいです",
      },
    ]);
  });

  it("expands listed dates into separate constraints when one condition applies to both dates", () => {
    expect(parseCommentConstraints("4と5は夜ならいけます", multiDateCandidates)).toEqual([
      {
        targetType: "date_time",
        targetValue: "2026-05-04_night",
        polarity: "positive",
        level: "conditional",
        reasonText: "4と5は夜ならいけます",
      },
      {
        targetType: "date_time",
        targetValue: "2026-05-05_night",
        polarity: "positive",
        level: "conditional",
        reasonText: "4と5は夜ならいけます",
      },
    ]);
  });

  it("keeps individually described dates separate when a listed-date prefix is followed by per-date details", () => {
    expect(parseCommentConstraints("11と12は11は一日中いけて、12は昼からいける気がします", multiDateCandidates)).toEqual([
      {
        targetType: "date_time",
        targetValue: "2026-05-11_all_day",
        polarity: "positive",
        level: "soft_yes",
        reasonText: "11は一日中いけて",
      },
      {
        targetType: "date_time",
        targetValue: "2026-05-12_day",
        polarity: "positive",
        level: "soft_yes",
        reasonText: "12は昼からいける気がします",
      },
    ]);
  });

  it("keeps weekday, listed-date, and per-date overrides all together in one combined comment", () => {
    expect(
      parseCommentConstraints(
        "平日は厳しいです。4と5は夜ならいけます。11と12は11は一日中いけて、12は昼からいける気がします",
        multiDateCandidates,
      ),
    ).toEqual([
      {
        targetType: "weekday",
        targetValue: "weekday",
        polarity: "negative",
        level: "soft_no",
        reasonText: "平日は厳しいです",
      },
      {
        targetType: "date_time",
        targetValue: "2026-05-04_night",
        polarity: "positive",
        level: "conditional",
        reasonText: "4と5は夜ならいけます",
      },
      {
        targetType: "date_time",
        targetValue: "2026-05-05_night",
        polarity: "positive",
        level: "conditional",
        reasonText: "4と5は夜ならいけます",
      },
      {
        targetType: "date_time",
        targetValue: "2026-05-11_all_day",
        polarity: "positive",
        level: "soft_yes",
        reasonText: "11は一日中いけて",
      },
      {
        targetType: "date_time",
        targetValue: "2026-05-12_day",
        polarity: "positive",
        level: "soft_yes",
        reasonText: "12は昼からいける気がします",
      },
    ]);
  });

  it("treats listed dates, complement rules, and later conditional exceptions as separate targets", () => {
    expect(parseCommentConstraints("1と2と3はいける それ以外は絶対にやめてほしい 5,6,は他の人がみんないけるならいいよ", complementCandidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-01",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-02",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-03",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-04",
        polarity: "negative",
        level: "hard_no",
        reasonText: "それ以外は絶対にやめてほしい",
      },
      {
        targetType: "date",
        targetValue: "2026-04-05",
        polarity: "positive",
        level: "conditional",
        reasonText: "5,6,は他の人がみんないけるならいいよ",
      },
      {
        targetType: "date",
        targetValue: "2026-04-06",
        polarity: "positive",
        level: "conditional",
        reasonText: "5,6,は他の人がみんないけるならいいよ",
      },
    ]);
  });

  it("expands multiple listed dates for と, comma, and Japanese comma separators", () => {
    expect(parseCommentConstraints("1と2と3はいける", complementCandidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-01",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-02",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-03",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
    ]);

    expect(parseCommentConstraints("1,2,3はいける", complementCandidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-01",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1,2,3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-02",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1,2,3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-03",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1,2,3はいける",
      },
    ]);

    expect(parseCommentConstraints("1、2、3はいける", complementCandidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-01",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1、2、3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-02",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1、2、3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-03",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1、2、3はいける",
      },
    ]);
  });

  it("keeps standalone それ以外 safe and applies complement logic when an explicit set exists", () => {
    expect(parseCommentConstraints("それ以外は絶対にやめてほしい", complementCandidates)).toEqual([
      {
        targetType: "time",
        targetValue: "all_day",
        polarity: "negative",
        level: "hard_no",
        reasonText: "それ以外は絶対にやめてほしい",
      },
    ]);

    expect(parseCommentConstraints("1と2と3はいける それ以外は絶対にやめてほしい", complementCandidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-01",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-02",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-03",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-04",
        polarity: "negative",
        level: "hard_no",
        reasonText: "それ以外は絶対にやめてほしい",
      },
      {
        targetType: "date",
        targetValue: "2026-04-05",
        polarity: "negative",
        level: "hard_no",
        reasonText: "それ以外は絶対にやめてほしい",
      },
      {
        targetType: "date",
        targetValue: "2026-04-06",
        polarity: "negative",
        level: "hard_no",
        reasonText: "それ以外は絶対にやめてほしい",
      },
    ]);
  });

  it("lets later explicit conditional dates override the earlier complement rule", () => {
    expect(parseCommentConstraints("1と2と3はいける それ以外は絶対にやめてほしい 5,6は条件付きでいける", complementCandidates)).toEqual([
      {
        targetType: "date",
        targetValue: "2026-04-01",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-02",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-03",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "1と2と3はいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-04",
        polarity: "negative",
        level: "hard_no",
        reasonText: "それ以外は絶対にやめてほしい",
      },
      {
        targetType: "date",
        targetValue: "2026-04-05",
        polarity: "positive",
        level: "conditional",
        reasonText: "5,6は条件付きでいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-06",
        polarity: "positive",
        level: "conditional",
        reasonText: "5,6は条件付きでいける",
      },
    ]);
  });

  it("parses weekday groups and specific date-time negatives without losing either target", () => {
    expect(parseCommentConstraints("平日は無理", weekdayResidualCandidates)).toEqual([
      {
        targetType: "weekday",
        targetValue: "weekday",
        polarity: "negative",
        level: "hard_no",
        reasonText: "平日は無理",
      },
    ]);

    expect(parseCommentConstraints("5日は午前が無理", weekdayResidualCandidates)).toEqual([
      {
        targetType: "date_time",
        targetValue: "2026-04-05_morning",
        polarity: "negative",
        level: "hard_no",
        reasonText: "5日は午前が無理",
      },
    ]);
  });

  it("treats あとは as the remaining uncovered targets instead of a global all-day positive", () => {
    expect(parseCommentConstraints("あとはいける", weekdayResidualCandidates)).toEqual([
      {
        targetType: "time",
        targetValue: "all_day",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
    ]);

    expect(parseCommentConstraints("平日は無理 あとはいける", weekdayResidualCandidates)).toEqual([
      {
        targetType: "weekday",
        targetValue: "weekday",
        polarity: "negative",
        level: "hard_no",
        reasonText: "平日は無理",
      },
      {
        targetType: "date",
        targetValue: "2026-04-04",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-05_morning",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-05_day",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
    ]);

    expect(parseCommentConstraints("5日は午前が無理 あとはいける", weekdayResidualCandidates)).toEqual([
      {
        targetType: "date_time",
        targetValue: "2026-04-05_morning",
        polarity: "negative",
        level: "hard_no",
        reasonText: "5日は午前が無理",
      },
      {
        targetType: "date",
        targetValue: "2026-04-03",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-04",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-05_day",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
      {
        targetType: "date",
        targetValue: "2026-04-06",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
    ]);

    expect(parseCommentConstraints("平日は無理 5日は午前が無理 あとはいける", weekdayResidualCandidates)).toEqual([
      {
        targetType: "weekday",
        targetValue: "weekday",
        polarity: "negative",
        level: "hard_no",
        reasonText: "平日は無理",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-05_morning",
        polarity: "negative",
        level: "hard_no",
        reasonText: "5日は午前が無理",
      },
      {
        targetType: "date",
        targetValue: "2026-04-04",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-05_day",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "あとはいける",
      },
    ]);
  });

  it("accepts 残り as the same residual reference as あとは", () => {
    expect(parseCommentConstraints("平日は無理 残りはいける", weekdayResidualCandidates)).toEqual([
      {
        targetType: "weekday",
        targetValue: "weekday",
        polarity: "negative",
        level: "hard_no",
        reasonText: "平日は無理",
      },
      {
        targetType: "date",
        targetValue: "2026-04-04",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "残りはいける",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-05_morning",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "残りはいける",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-05_day",
        polarity: "positive",
        level: "strong_yes",
        reasonText: "残りはいける",
      },
    ]);
  });

  it("does not fall back to a global all-day positive when あとは resolves to an empty complement", () => {
    expect(parseCommentConstraints("平日は無理 5日は午前が無理 あとはいける", fullyCoveredResidualCandidates)).toEqual([
      {
        targetType: "weekday",
        targetValue: "weekday",
        polarity: "negative",
        level: "hard_no",
        reasonText: "平日は無理",
      },
      {
        targetType: "date_time",
        targetValue: "2026-04-05_morning",
        polarity: "negative",
        level: "hard_no",
        reasonText: "5日は午前が無理",
      },
    ]);

    expect(parseCommentConstraints("平日は無理 あとはいける", [
      fullyCoveredResidualCandidates[0]!,
      fullyCoveredResidualCandidates[2]!,
    ])).toEqual([
      {
        targetType: "weekday",
        targetValue: "weekday",
        polarity: "negative",
        level: "hard_no",
        reasonText: "平日は無理",
      },
    ]);
  });

  it("keeps derived answers aligned with listed-date positives so the final date does not drop out", () => {
    expect(
      buildDerivedResponseFromComment("1,2,3はいける それ以外は絶対にやめてほしい 5,6は条件付きでいける", complementCandidates),
    ).toMatchObject({
      usedDefault: false,
      answers: [
        { candidateId: "complement-1", availabilityKey: "yes", selectedDates: ["2026-04-01"] },
        { candidateId: "complement-2", availabilityKey: "yes", selectedDates: ["2026-04-02"] },
        { candidateId: "complement-3", availabilityKey: "yes", selectedDates: ["2026-04-03"] },
        { candidateId: "complement-4", availabilityKey: "no", selectedDates: [] },
        { candidateId: "complement-5", availabilityKey: "maybe", selectedDates: ["2026-04-05"] },
        { candidateId: "complement-6", availabilityKey: "maybe", selectedDates: ["2026-04-06"] },
      ],
    });
  });

  it("keeps unparseable comments safe by returning an empty constraint list", () => {
    expect(parseCommentConstraints("よろしくお願いします！楽しみです", candidates)).toEqual([]);
  });

  it("matches generated constraints against candidate dates and time slots for later scoring", () => {
    const constraints = parseCommentConstraints("24日夜ならいける。金曜はできれば避けたい", candidates);

    expect(doesConstraintMatchCandidate(constraints[0]!, candidates[1]!)).toBe(true);
    expect(doesConstraintMatchCandidate(constraints[1]!, candidates[1]!)).toBe(true);
    expect(doesConstraintMatchCandidate(constraints[1]!, candidates[0]!)).toBe(false);
  });

  it("distinguishes empty defaults from non-empty but unparseable comments", () => {
    expect(buildDerivedResponseFromComment("", candidates)).toMatchObject({
      parsedConstraints: [],
      usedDefault: true,
      defaultReason: "empty",
      answers: [
        { candidateId: "cand-1", availabilityKey: "yes", selectedDates: ["2026-04-23"] },
        { candidateId: "cand-2", availabilityKey: "yes", selectedDates: ["2026-04-24"] },
        { candidateId: "cand-3", availabilityKey: "yes", selectedDates: ["2026-04-25"] },
        { candidateId: "cand-4", availabilityKey: "yes", selectedDates: ["2026-04-26"] },
      ],
    });

    expect(buildDerivedResponseFromComment("よろしくお願いします", candidates)).toMatchObject({
      parsedConstraints: [],
      usedDefault: true,
      defaultReason: "unparsed",
    });

    expect(buildDerivedResponseFromComment("4/23は", candidates)).toMatchObject({
      parsedConstraints: [],
      usedDefault: true,
      defaultReason: "unparsed",
    });
    expect(buildDerivedResponseFromComment("よろしくお願いします", candidates).answers.every((answer) => answer.availabilityKey === "yes")).toBe(true);
  });

  it("prefers parsed constraints over the default and derives compatibility answers from the comment", () => {
    expect(buildDerivedResponseFromComment("23日は無理だけど、24日夜ならいける", candidates)).toMatchObject({
      parsedConstraints: [
        {
          targetType: "date",
          targetValue: "2026-04-23",
          level: "hard_no",
        },
        {
          targetType: "date_time",
          targetValue: "2026-04-24_night",
          level: "conditional",
        },
      ],
      usedDefault: false,
      answers: [
        { candidateId: "cand-1", availabilityKey: "no", selectedDates: [] },
        { candidateId: "cand-2", availabilityKey: "maybe", selectedDates: ["2026-04-24"] },
        { candidateId: "cand-3", availabilityKey: "yes", selectedDates: ["2026-04-25"] },
        { candidateId: "cand-4", availabilityKey: "yes", selectedDates: ["2026-04-26"] },
      ],
    });
  });
});
