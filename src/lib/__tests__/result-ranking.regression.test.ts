/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { describe, expect, it } from "vitest";
import type { EventCandidateRecord, EventDetail, EventRecord, ParticipantResponseRecord } from "@/lib/domain";
import { buildAdjustmentSuggestions, rankCandidates } from "@/lib/ranking";
import { makeDemoEventDetail } from "@/test/fixtures";

function buildCandidate(overrides: Partial<EventCandidateRecord> = {}): EventCandidateRecord {
  return {
    id: "candidate",
    eventId: "custom-event",
    date: "2026-04-18",
    timeSlotKey: "day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-18",
    endDate: "2026-04-18",
    selectedDates: [],
    timeType: "fixed",
    startTime: "12:00",
    endTime: "17:00",
    note: null,
    sortOrder: 10,
    ...overrides,
  };
}

function buildAnswer(overrides: Partial<ParticipantResponseRecord["answers"][number]> = {}) {
  return {
    candidateId: "candidate",
    availabilityKey: "yes",
    selectedDates: [],
    preferredTimeSlotKey: null,
    dateTimePreferences: {},
    availableStartTime: null,
    availableEndTime: null,
    ...overrides,
  };
}

function buildDetail({
  event,
  candidates,
  responses,
}: {
  event?: Partial<EventRecord>;
  candidates: EventCandidateRecord[];
  responses: ParticipantResponseRecord[];
}): EventDetail {
  return {
    event: {
      id: "custom-event",
      title: "custom-event",
      createdAt: "2026-04-07T00:00:00+09:00",
      defaultResultMode: "strict_all",
      ...event,
    },
    candidates,
    responses,
  };
}

describe("result ranking regression", () => {
  it("keeps strict mode limited to candidates with zero impossible votes", () => {
    const ranked = rankCandidates(makeDemoEventDetail(), "strict_all");

    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.id).toBe("cand-1");
    expect(ranked[0].totalScore).toBe(3.5);
    expect(ranked[0].yesCount).toBe(3);
    expect(ranked[0].maybeCount).toBe(1);
    expect(ranked[0].noCount).toBe(0);
  });

  it("keeps maximize attendance mode sorted by no-count and then total score", () => {
    const ranked = rankCandidates(makeDemoEventDetail(), "maximize_attendance");

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["cand-1", "cand-3", "cand-2", "cand-4"]);
    expect(ranked.map((candidate) => candidate.totalScore)).toEqual([3.5, 2.5, 2, 1.5]);
  });

  it("keeps the same ranking and score output for the same input", () => {
    const detail = makeDemoEventDetail();

    const firstRun = rankCandidates(detail, "maximize_attendance");
    const secondRun = rankCandidates(detail, "maximize_attendance");

    expect(secondRun).toEqual(firstRun);
  });

  it("keeps missing answers treated as impossible in the current scoring model", () => {
    const detail = buildDetail({
      candidates: [buildCandidate({ id: "candidate-1" })],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: null,
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [buildAnswer({ candidateId: "candidate-1", availabilityKey: "yes" })],
        },
        {
          id: "response-2",
          eventId: "custom-event",
          participantName: "Nao",
          note: null,
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: [],
        },
      ],
    });

    expect(rankCandidates(detail, "strict_all")).toEqual([]);

    const maximize = rankCandidates(detail, "maximize_attendance");
    expect(maximize).toHaveLength(1);
    expect(maximize[0].noCount).toBe(1);
    expect(maximize[0].totalScore).toBe(1);
  });

  it("keeps tie handling stable by falling back to sort order when scores are identical", () => {
    const detail = buildDetail({
      candidates: [
        buildCandidate({ id: "candidate-a", sortOrder: 10, startTime: "10:00", endTime: "12:00", timeSlotKey: "custom" }),
        buildCandidate({ id: "candidate-b", sortOrder: 20, startTime: "10:00", endTime: "12:00", timeSlotKey: "custom" }),
      ],
      responses: [],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-a", "candidate-b"]);
  });

  it("keeps adjustment suggestions non-empty and aligned with current ranking explanations", () => {
    const suggestions = buildAdjustmentSuggestions(rankCandidates(makeDemoEventDetail(), "maximize_attendance"));

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].title).toMatch(/確度を上げやすい候補/u);
    expect(suggestions[0].body).toMatch(/Sora/u);
    expect(suggestions[1].title).toMatch(/あと一歩/u);
    expect(suggestions.every((suggestion) => suggestion.body.trim().length > 0)).toBe(true);
  });
});
