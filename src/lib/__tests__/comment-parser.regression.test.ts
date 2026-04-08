/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { describe, expect, it } from "vitest";
import { doesConstraintMatchCandidate, parseCommentConstraints } from "@/lib/comment-parser";
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

  it("keeps unparseable comments safe by returning an empty constraint list", () => {
    expect(parseCommentConstraints("よろしくお願いします！楽しみです", candidates)).toEqual([]);
  });

  it("matches generated constraints against candidate dates and time slots for later scoring", () => {
    const constraints = parseCommentConstraints("24日夜ならいける。金曜はできれば避けたい", candidates);

    expect(doesConstraintMatchCandidate(constraints[0]!, candidates[1]!)).toBe(true);
    expect(doesConstraintMatchCandidate(constraints[1]!, candidates[1]!)).toBe(true);
    expect(doesConstraintMatchCandidate(constraints[1]!, candidates[0]!)).toBe(false);
  });
});
