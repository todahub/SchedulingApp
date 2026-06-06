import { describe, expect, it } from "vitest";
import { assessSnippetRisk } from "@/lib/self-consistency";
import type { EventCandidateRecord } from "@/lib/domain";

const candidates: EventCandidateRecord[] = [
  {
    id: "candidate-1",
    eventId: "event-1",
    date: "2026-06-11",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-06-11",
    endDate: "2026-06-11",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 10,
  },
  {
    id: "candidate-2",
    eventId: "event-1",
    date: "2026-06-12",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-06-12",
    endDate: "2026-06-12",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 20,
  },
];

describe("assessSnippetRisk", () => {
  it("does not require local review for a plain hard no statement", () => {
    const result = assessSnippetRisk("11日は無理", candidates, "evaluation");

    expect(result.shouldReview).toBe(false);
    expect(result.signals).not.toContain("comparison");
  });

  it("marks comparison and uncertainty expressions for review", () => {
    const result = assessSnippetRisk("11と12なら12かな", candidates, "comparison");

    expect(result.shouldReview).toBe(true);
    expect(result.signals).toContain("comparison");
    expect(result.signals).toContain("condition");
    expect(result.signals).toContain("uncertainty");
    expect(result.signals).toContain("multi_target");
  });

  it("marks double-negative expressions for review", () => {
    const result = assessSnippetRisk("11は行けなくもない", candidates, "evaluation");

    expect(result.shouldReview).toBe(true);
    expect(result.signals).toContain("negation_complexity");
  });
});
