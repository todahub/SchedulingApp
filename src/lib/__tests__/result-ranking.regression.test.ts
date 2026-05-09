/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { describe, expect, it } from "vitest";
import { buildDerivedResponseFromComment } from "@/lib/comment-parser";
import {
  buildAutoInterpretationResult,
  buildAvailabilityInterpretationExecutionInput,
  buildDerivedResponseFromAvailabilityInterpretation,
} from "@/lib/availability-comment-interpretation";
import type { EventCandidateRecord, EventDetail, EventRecord, ParticipantResponseRecord } from "@/lib/domain";
import { buildAdjustmentSuggestions, buildAiScheduleDecision, buildRankedCandidateCollections, rankCandidates } from "@/lib/ranking";
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
  it("keeps strict mode limited to candidates where everyone is clearly available", () => {
    const ranked = rankCandidates(makeDemoEventDetail(), "strict_all");

    expect(ranked).toEqual([]);
  });

  it("prefers immediately decidable unanimous candidates before unresolved candidates", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });
    const april12 = buildCandidate({
      id: "candidate-12",
      date: "2026-04-12",
      startDate: "2026-04-12",
      endDate: "2026-04-12",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 30,
    });

    const detail = buildDetail({
      candidates: [april10, april11, april12],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "10日は条件付き、11日は未定、12日はできれば避けたい",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "conditional",
              reasonText: "10日は条件付き",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "neutral",
              level: "unknown",
              reasonText: "11日は未定",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "negative",
              level: "soft_no",
              reasonText: "12日はできれば避けたい",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-12", "candidate-10", "candidate-11"]);
    expect(ranked[0]?.unavailableCount).toBe(1);
    expect(ranked[1]?.conditionalCount).toBe(1);
    expect(ranked[2]?.unknownCount).toBe(1);
  });

  it("keeps fully available days ahead of conditional days inside the same no-hard-no tier", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const detail = buildDetail({
      candidates: [april10, april11],
      responses: [
        {
          id: "response-a",
          eventId: "custom-event",
          participantName: "Aki",
          note: "10日は参加可能、11日は未定",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "neutral",
              level: "unknown",
              reasonText: "11日は未定",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
        {
          id: "response-b",
          eventId: "custom-event",
          participantName: "Nao",
          note: "10日は参加可能、11日は条件付き",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "positive",
              level: "conditional",
              reasonText: "11日は条件付き",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: [],
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked[0]?.candidate.id).toBe("candidate-10");
    expect(ranked[1]?.candidate.id).toBe("candidate-11");
    expect(ranked[0]?.availableCount).toBe(2);
    expect(ranked[1]?.availableCount).toBe(0);
  });

  it("keeps soft-no candidates inside the unanimous search and prefers less negative unanimous days", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const detail = buildDetail({
      candidates: [april10, april11],
      responses: [
        {
          id: "response-a",
          eventId: "custom-event",
          participantName: "Aki",
          note: "10日は参加可能、11日はできれば避けたい",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "negative",
              level: "soft_no",
              reasonText: "11日はできれば避けたい",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
        {
          id: "response-b",
          eventId: "custom-event",
          participantName: "Nao",
          note: "どちらも参加可能",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "11日は参加可能",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: [],
        },
      ],
    });

    const strict = rankCandidates(detail, "strict_all");
    expect(strict.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11"]);
  });

  it("lists candidates that could become the best if conditions resolve after the unanimous group", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });
    const april12 = buildCandidate({
      id: "candidate-12",
      date: "2026-04-12",
      startDate: "2026-04-12",
      endDate: "2026-04-12",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 30,
    });

    const detail = buildDetail({
      candidates: [april10, april11, april12],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "10日はできれば避けたい、11日はまだわからない、12日は無理",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "negative",
              level: "soft_no",
              reasonText: "10日はできれば避けたい",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "neutral",
              level: "unknown",
              reasonText: "11日はまだわからない",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "negative",
              level: "hard_no",
              reasonText: "12日は無理",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
        {
          id: "response-2",
          eventId: "custom-event",
          participantName: "Nao",
          note: "全部参加可能",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "11日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "12日は参加可能",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: [],
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11", "candidate-12"]);
  });

  it("keeps separate internal rankings for perfect-now, perfect-if-resolved, and best-attendance", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });
    const april12 = buildCandidate({
      id: "candidate-12",
      date: "2026-04-12",
      startDate: "2026-04-12",
      endDate: "2026-04-12",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 30,
    });

    const detail = buildDetail({
      candidates: [april10, april11, april12],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "10日は参加可能、11日は未定、12日は無理",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "neutral",
              level: "unknown",
              reasonText: "11日は未定",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "negative",
              level: "hard_no",
              reasonText: "12日は無理",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
        {
          id: "response-2",
          eventId: "custom-event",
          participantName: "Nao",
          note: "全部参加可能",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "11日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "12日は参加可能",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: [],
        },
      ],
    });

    const collections = buildRankedCandidateCollections(detail);

    expect(collections.perfectNowRanking.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10"]);
    expect(collections.perfectIfResolvedRanking.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11"]);
    expect(collections.bestAttendanceRanking.map((candidate) => candidate.candidate.id)).toEqual([
      "candidate-10",
      "candidate-11",
      "candidate-12",
    ]);
  });

  it("when no unanimous date exists, picks the least impossible current options before hypothetical ones", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });
    const april12 = buildCandidate({
      id: "candidate-12",
      date: "2026-04-12",
      startDate: "2026-04-12",
      endDate: "2026-04-12",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 30,
    });

    const detail = buildDetail({
      candidates: [april10, april11, april12],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "10日は無理、11日は無理、12日は未定",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "negative",
              level: "hard_no",
              reasonText: "10日は無理",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "negative",
              level: "hard_no",
              reasonText: "11日は無理",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "neutral",
              level: "unknown",
              reasonText: "12日は未定",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
        {
          id: "response-2",
          eventId: "custom-event",
          participantName: "Nao",
          note: "10日は参加可能、11日はできれば避けたい、12日は参加可能",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "negative",
              level: "soft_no",
              reasonText: "11日はできれば避けたい",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "12日は参加可能",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: [],
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11", "candidate-12"]);
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
          parsedConstraints: [],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [buildAnswer({ candidateId: "candidate-1", availabilityKey: "yes" })],
        },
        {
          id: "response-2",
          eventId: "custom-event",
          participantName: "Nao",
          note: null,
          parsedConstraints: [],
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: [],
        },
      ],
    });

    expect(rankCandidates(detail, "strict_all")).toEqual([]);

    const maximize = rankCandidates(detail, "maximize_attendance");
    expect(maximize).toHaveLength(1);
    expect(maximize[0].noCount).toBe(1);
    expect(maximize[0].totalScore).toBe(0);
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

  it("uses parsed comment constraints to push a hard-no candidate out of strict mode and lower its score", () => {
    const friday = buildCandidate({ id: "candidate-friday", date: "2026-04-24", startDate: "2026-04-24", endDate: "2026-04-24", timeSlotKey: "night", startTime: "18:00", endTime: "22:00", sortOrder: 10 });
    const saturday = buildCandidate({ id: "candidate-saturday", date: "2026-04-25", startDate: "2026-04-25", endDate: "2026-04-25", timeSlotKey: "night", startTime: "18:00", endTime: "22:00", sortOrder: 20 });

    const detail = buildDetail({
      candidates: [friday, saturday],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "24日夜は無理",
          parsedConstraints: [
            {
              targetType: "date_time",
              targetValue: "2026-04-24_night",
              polarity: "negative",
              level: "hard_no",
              reasonText: "24日夜は無理",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [
            buildAnswer({ candidateId: "candidate-friday", availabilityKey: "yes" }),
            buildAnswer({ candidateId: "candidate-saturday", availabilityKey: "yes" }),
          ],
        },
      ],
    });

    expect(rankCandidates(detail, "strict_all").map((candidate) => candidate.candidate.id)).toEqual(["candidate-saturday"]);

    const maximize = rankCandidates(detail, "maximize_attendance");
    const fridayRank = maximize.find((candidate) => candidate.candidate.id === "candidate-friday");
    const saturdayRank = maximize.find((candidate) => candidate.candidate.id === "candidate-saturday");

    expect(fridayRank).toBeDefined();
    expect(saturdayRank).toBeDefined();
    expect(fridayRank?.commentScore).toBe(-100);
    expect(fridayRank?.commentImpacts).toHaveLength(1);
    expect(fridayRank?.hasHardNoConstraint).toBe(true);
  });

  it("does not double-count comment-derived answers when comment-only responses are ranked", () => {
    const friday = buildCandidate({
      id: "candidate-friday",
      date: "2026-04-24",
      startDate: "2026-04-24",
      endDate: "2026-04-24",
      timeSlotKey: "night",
      startTime: "18:00",
      endTime: "22:00",
    });
    const derived = buildDerivedResponseFromComment("24日夜ならいける", [friday]);

    const detail = buildDetail({
      candidates: [friday],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "24日夜ならいける",
          parsedConstraints: derived.parsedConstraints,
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: derived.answers,
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].baseScore).toBe(4);
    expect(ranked[0].commentScore).toBe(10);
    expect(ranked[0].totalScore).toBe(4);
    expect(ranked[0].maybeCount).toBe(1);
    expect(ranked[0].conditionalCount).toBe(1);
  });

  it("uses auto-llm parsed constraints as the ranking source of truth for comment-only responses", () => {
    const friday = buildCandidate({
      id: "candidate-friday",
      date: "2026-04-24",
      startDate: "2026-04-24",
      endDate: "2026-04-24",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
    });
    const executionInput = buildAvailabilityInterpretationExecutionInput("24日はいける", [friday]);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      [friday],
    );

    const detail = buildDetail({
      candidates: [friday],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "24日はいける",
          parsedConstraints: derived.parsedConstraints,
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: derived.answers,
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked).toHaveLength(1);
    expect(derived.parsedConstraints[0]?.source).toBe("auto_llm");
    expect(ranked[0].baseScore).toBe(3);
    expect(ranked[0].commentScore).toBe(0);
    expect(ranked[0].totalScore).toBe(3);
    expect(ranked[0].availableCount).toBe(1);
    expect(ranked[0].yesCount).toBe(1);
    expect(ranked[0].participantStatuses[0]?.label).toBe("参加可能");
  });

  it("does not treat unmentioned candidates in auto-llm comment responses as explicit yes", () => {
    const friday = buildCandidate({
      id: "candidate-friday",
      date: "2026-04-24",
      startDate: "2026-04-24",
      endDate: "2026-04-24",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const saturday = buildCandidate({
      id: "candidate-saturday",
      date: "2026-04-25",
      startDate: "2026-04-25",
      endDate: "2026-04-25",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });
    const executionInput = buildAvailabilityInterpretationExecutionInput("24日はいける", [friday, saturday]);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      [friday, saturday],
    );

    const detail = buildDetail({
      candidates: [friday, saturday],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "24日はいける",
          parsedConstraints: derived.parsedConstraints,
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: derived.answers,
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    const fridayRank = ranked.find((candidate) => candidate.candidate.id === "candidate-friday");
    const saturdayRank = ranked.find((candidate) => candidate.candidate.id === "candidate-saturday");

    expect(fridayRank?.yesCount).toBe(1);
    expect(fridayRank?.maybeCount).toBe(0);
    expect(saturdayRank?.yesCount).toBe(0);
    expect(saturdayRank?.maybeCount).toBe(1);
    expect(saturdayRank?.noCount).toBe(0);
  });

  it("treats unresolved comment-only defaults as maybe instead of explicit yes", () => {
    const friday = buildCandidate({ id: "candidate-friday" });
    const derived = buildDerivedResponseFromComment("よろしくお願いします", [friday]);
    const detail = buildDetail({
      candidates: [friday],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "よろしくお願いします",
          parsedConstraints: derived.parsedConstraints,
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: derived.answers,
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].yesCount).toBe(0);
    expect(ranked[0].maybeCount).toBe(1);
    expect(ranked[0].noCount).toBe(0);
    expect(ranked[0].baseScore).toBe(2);
    expect(ranked[0].unknownCount).toBe(1);
  });

  it("expands multi-day parsed comment results into per-date ranking candidates", () => {
    const rangeCandidate = buildCandidate({
      id: "candidate-range",
      date: "2026-04-24",
      startDate: "2026-04-24",
      endDate: "2026-04-26",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      dateType: "range",
      sortOrder: 10,
    });
    const detail = buildDetail({
      candidates: [rangeCandidate],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "24日はいける",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-24",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "24日はいける",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [
            buildAnswer({
              candidateId: "candidate-range",
              availabilityKey: "yes",
              selectedDates: ["2026-04-24"],
            }),
          ],
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");

    expect(ranked).toHaveLength(3);
    expect(ranked.map((candidate) => candidate.candidate.startDate)).toEqual(["2026-04-24", "2026-04-25", "2026-04-26"]);
    expect(ranked.find((candidate) => candidate.candidate.startDate === "2026-04-24")?.yesCount).toBe(1);
    expect(ranked.find((candidate) => candidate.candidate.startDate === "2026-04-25")?.maybeCount).toBe(1);
    expect(ranked.find((candidate) => candidate.candidate.startDate === "2026-04-26")?.maybeCount).toBe(1);
  });

  it("treats soft-no as heavier than participation-leaning soft-yes and conditional answers", () => {
    const friday = buildCandidate({
      id: "candidate-friday",
      date: "2026-04-24",
      startDate: "2026-04-24",
      endDate: "2026-04-24",
      timeSlotKey: "night",
      startTime: "18:00",
      endTime: "22:00",
      sortOrder: 10,
    });
    const saturday = buildCandidate({
      id: "candidate-saturday",
      date: "2026-04-25",
      startDate: "2026-04-25",
      endDate: "2026-04-25",
      timeSlotKey: "night",
      startTime: "18:00",
      endTime: "22:00",
      sortOrder: 20,
    });
    const sunday = buildCandidate({
      id: "candidate-sunday",
      date: "2026-04-26",
      startDate: "2026-04-26",
      endDate: "2026-04-26",
      timeSlotKey: "night",
      startTime: "18:00",
      endTime: "22:00",
      sortOrder: 30,
    });

    const detail = buildDetail({
      candidates: [friday, saturday, sunday],
      responses: [
        {
          id: "response-soft-no",
          eventId: "custom-event",
          participantName: "Aki",
          note: "金曜はできれば避けたい",
          parsedConstraints: buildDerivedResponseFromComment("金曜はできれば避けたい", [friday, saturday, sunday]).parsedConstraints,
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: buildDerivedResponseFromComment("金曜はできれば避けたい", [friday, saturday, sunday]).answers,
        },
        {
          id: "response-conditional",
          eventId: "custom-event",
          participantName: "Nao",
          note: "土曜夜ならいける",
          parsedConstraints: buildDerivedResponseFromComment("土曜夜ならいける", [friday, saturday, sunday]).parsedConstraints,
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: buildDerivedResponseFromComment("土曜夜ならいける", [friday, saturday, sunday]).answers,
        },
        {
          id: "response-soft-yes",
          eventId: "custom-event",
          participantName: "Sora",
          note: "日曜夜はたぶん大丈夫",
          parsedConstraints: buildDerivedResponseFromComment("日曜夜はたぶん大丈夫", [friday, saturday, sunday]).parsedConstraints,
          submittedAt: "2026-04-07T09:02:00+09:00",
          answers: buildDerivedResponseFromComment("日曜夜はたぶん大丈夫", [friday, saturday, sunday]).answers,
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-saturday", "candidate-sunday", "candidate-friday"]);
    expect(ranked[0]?.conditionalCount).toBe(1);
    expect(ranked[1]?.availableCount).toBe(1);
    expect(ranked[2]?.unavailableCount).toBe(1);
  });

  it("uses matched preference constraints as a same-tier tie-break", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const detail = buildDetail({
      candidates: [april10, april11],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "11日の方がいい",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-11",
              polarity: "positive",
              level: "soft_yes",
              reasonText: "11日の方がいい",
              intent: "preference",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [
            buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
            buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
          ],
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11", "candidate-10"]);
  });

  it("uses preference-only auto interpretation as a ranking adjustment once preference scoring is enabled", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const baselineResponse: ParticipantResponseRecord = {
      id: "response-base",
      eventId: "custom-event",
      participantName: "Aki",
      note: "11がいい",
      parsedConstraints: [],
      autoInterpretation: null,
      submittedAt: "2026-04-07T09:00:00+09:00",
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    };
    const preferenceOnlyResponse: ParticipantResponseRecord = {
      ...baselineResponse,
      id: "response-preference-only",
      autoInterpretation: {
        status: "failed",
        sourceComment: "11がいい",
        rules: [],
        resolvedCandidateStatuses: [],
        preferences: [
          {
            targetTokenIndexes: [0],
            targetText: "11",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-11"],
            markerTokenIndexes: [1],
            markerTexts: ["がいい"],
            markerLabels: ["preference_positive_marker"],
            level: "preferred",
            notes: [],
            sourceComment: "11がいい",
          },
        ],
        ambiguities: [],
        failureReason: "可否ルールは作れませんでしたが、希望情報は抽出できました。",
      },
    };

    const baselineRanked = rankCandidates(
      buildDetail({
        candidates: [april10, april11],
        responses: [baselineResponse],
      }),
      "maximize_attendance",
    );
    const preferenceOnlyRanked = rankCandidates(
      buildDetail({
        candidates: [april10, april11],
        responses: [preferenceOnlyResponse],
      }),
      "maximize_attendance",
    );

    expect(baselineRanked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11"]);
    expect(preferenceOnlyRanked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11", "candidate-10"]);
    expect(preferenceOnlyRanked.map((candidate) => candidate.availableCount)).toEqual(
      baselineRanked.map((candidate) => candidate.availableCount),
    );
    expect(preferenceOnlyRanked.map((candidate) => candidate.unknownCount)).toEqual(
      baselineRanked.map((candidate) => candidate.unknownCount),
    );
    expect(preferenceOnlyRanked.map((candidate) => candidate.plainPreferenceScoreDelta)).toEqual([2, 0]);
    expect(preferenceOnlyRanked.map((candidate) => candidate.comparisonPreferenceScoreDelta)).toEqual([0, 0]);
    expect(preferenceOnlyRanked.map((candidate) => candidate.preferenceScoreDelta)).toEqual([2, 0]);
  });

  it("activates a condition-bound preference immediately when the other-participant condition is already satisfied", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const akiResponse: ParticipantResponseRecord = {
      id: "response-aki",
      eventId: "custom-event",
      participantName: "Aki",
      note: "他の人がみんな行けるなら11がいい",
      parsedConstraints: [],
      autoInterpretation: {
        status: "failed",
        sourceComment: "他の人がみんな行けるなら11がいい",
        rules: [],
        resolvedCandidateStatuses: [],
        preferences: [
          {
            targetTokenIndexes: [0],
            targetText: "11",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-11"],
            markerTokenIndexes: [1],
            markerTexts: ["がいい"],
            markerLabels: ["preference_positive_marker"],
            level: "preferred",
            notes: [],
            sourceComment: "他の人がみんな行けるなら11がいい",
          },
        ],
        conditions: [
          {
            targetTokenIndexes: [0],
            targetText: "11",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-11"],
            conditionTokenIndexes: [2, 3, 4],
            markerTokenIndexes: [4],
            supportingClauseIndexes: [0],
            kind: "others_condition",
            resolverType: "all_others_available",
            participantScope: "all_others",
            requiredAvailabilityLevels: ["strong_yes", "soft_yes"],
            unresolvedBehavior: "blocked",
            resolvedAvailabilityLevel: "soft_yes",
            resolvedPreferenceLevel: "preferred",
            sourcePreferenceTargetTokenIndexes: [0],
            sourceComment: "他の人がみんな行けるなら11がいい",
            confidence: "high",
          },
        ],
        ambiguities: [],
        failureReason: "可否ルールは作れませんでしたが、希望情報は抽出できました。",
      },
      submittedAt: "2026-04-07T09:00:00+09:00",
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    };
    const naoResponse: ParticipantResponseRecord = {
      id: "response-nao",
      eventId: "custom-event",
      participantName: "Nao",
      note: null,
      parsedConstraints: [],
      autoInterpretation: null,
      submittedAt: "2026-04-07T09:01:00+09:00",
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    };

    const detail = buildDetail({
      candidates: [april10, april11],
      responses: [akiResponse, naoResponse],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    const collections = buildRankedCandidateCollections(detail);

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11", "candidate-10"]);
    expect(collections.perfectNowRanking.map((candidate) => candidate.candidate.id)).toEqual([
      "candidate-11",
      "candidate-10",
    ]);
    expect(ranked[0]?.plainPreferenceScoreDelta).toBe(2);
    expect(ranked[0]?.pendingConditionPreferenceScoreDelta).toBe(0);
    expect(ranked[0]?.conditionExplanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantName: "Aki",
          resolverType: "all_others_available",
          resolution: "resolved_true",
          affects: "both",
        }),
      ]),
    );
  });

  it("keeps unresolved condition-bound preference out of the current ranking while preserving it for perfect-if-resolved ordering", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const akiResponse: ParticipantResponseRecord = {
      id: "response-aki",
      eventId: "custom-event",
      participantName: "Aki",
      note: "他の人がみんな行けるなら11がいい",
      parsedConstraints: [],
      autoInterpretation: {
        status: "failed",
        sourceComment: "他の人がみんな行けるなら11がいい",
        rules: [],
        resolvedCandidateStatuses: [],
        preferences: [
          {
            targetTokenIndexes: [0],
            targetText: "11",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-11"],
            markerTokenIndexes: [1],
            markerTexts: ["がいい"],
            markerLabels: ["preference_positive_marker"],
            level: "preferred",
            notes: [],
            sourceComment: "他の人がみんな行けるなら11がいい",
          },
        ],
        conditions: [
          {
            targetTokenIndexes: [0],
            targetText: "11",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-11"],
            conditionTokenIndexes: [2, 3, 4],
            markerTokenIndexes: [4],
            supportingClauseIndexes: [0],
            kind: "others_condition",
            resolverType: "all_others_available",
            participantScope: "all_others",
            requiredAvailabilityLevels: ["strong_yes", "soft_yes"],
            unresolvedBehavior: "blocked",
            resolvedAvailabilityLevel: "soft_yes",
            resolvedPreferenceLevel: "preferred",
            sourcePreferenceTargetTokenIndexes: [0],
            sourceComment: "他の人がみんな行けるなら11がいい",
            confidence: "high",
          },
        ],
        ambiguities: [],
        failureReason: "可否ルールは作れませんでしたが、希望情報は抽出できました。",
      },
      submittedAt: "2026-04-07T09:00:00+09:00",
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    };
    const naoResponse: ParticipantResponseRecord = {
      id: "response-nao",
      eventId: "custom-event",
      participantName: "Nao",
      note: null,
      parsedConstraints: [],
      autoInterpretation: null,
      submittedAt: "2026-04-07T09:01:00+09:00",
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "maybe" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "maybe" }),
      ],
    };

    const detail = buildDetail({
      candidates: [april10, april11],
      responses: [akiResponse, naoResponse],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    const collections = buildRankedCandidateCollections(detail);

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11"]);
    expect(collections.perfectNowRanking).toEqual([]);
    expect(collections.perfectIfResolvedRanking.map((candidate) => candidate.candidate.id)).toEqual([
      "candidate-11",
      "candidate-10",
    ]);
    expect(ranked[0]?.plainPreferenceScoreDelta).toBe(0);
    expect(ranked[1]?.pendingConditionPreferenceScoreDelta).toBe(2);
    expect(ranked[1]?.conditionExplanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantName: "Aki",
          resolverType: "all_others_available",
          resolution: "unresolved",
          affects: "both",
        }),
      ]),
    );
  });

  it("treats condition-bound availability as blocked now and available after the condition is resolved", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const akiResponse: ParticipantResponseRecord = {
      id: "response-aki",
      eventId: "custom-event",
      participantName: "Aki",
      note: "他の人がみんな行けるなら11はいける",
      parsedConstraints: [],
      autoInterpretation: {
        status: "failed",
        sourceComment: "他の人がみんな行けるなら11はいける",
        rules: [],
        resolvedCandidateStatuses: [],
        preferences: [],
        conditions: [
          {
            targetTokenIndexes: [0],
            targetText: "11",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-11"],
            conditionTokenIndexes: [1, 2, 3],
            markerTokenIndexes: [3],
            supportingClauseIndexes: [0],
            kind: "others_condition",
            resolverType: "all_others_available",
            participantScope: "all_others",
            requiredAvailabilityLevels: ["strong_yes", "soft_yes"],
            unresolvedBehavior: "blocked",
            resolvedAvailabilityLevel: "conditional",
            sourceComment: "他の人がみんな行けるなら11はいける",
            confidence: "high",
          },
        ],
        ambiguities: [],
        failureReason: "可否ルールは作れませんでしたが、条件は抽出できました。",
      },
      submittedAt: "2026-04-07T09:00:00+09:00",
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    };
    const naoResponse: ParticipantResponseRecord = {
      id: "response-nao",
      eventId: "custom-event",
      participantName: "Nao",
      note: null,
      parsedConstraints: [],
      autoInterpretation: null,
      submittedAt: "2026-04-07T09:01:00+09:00",
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "maybe" }),
      ],
    };

    const detail = buildDetail({
      candidates: [april10, april11],
      responses: [akiResponse, naoResponse],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    const collections = buildRankedCandidateCollections(detail);
    const blockedCandidate = ranked.find((candidate) => candidate.candidate.id === "candidate-11");

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11"]);
    expect(collections.perfectNowRanking.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10"]);
    expect(collections.perfectIfResolvedRanking.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11"]);
    expect(blockedCandidate?.participantStatuses.find((status) => status.responseId === "response-aki")).toEqual(
      expect.objectContaining({
        availabilityKey: "no",
        isConditionBlocked: true,
        label: "条件待ち",
      }),
    );
    expect(blockedCandidate?.conditionExplanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantName: "Aki",
          resolverType: "all_others_available",
          resolution: "unresolved",
          affects: "availability",
        }),
      ]),
    );
  });

  it("assigns stronger emotion scores to strong desire than weak accept on an equal scoring basis", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const response: ParticipantResponseRecord = {
      id: "response-emotion",
      eventId: "custom-event",
      participantName: "Aki",
      note: "10でもいい、11に行きたい",
      parsedConstraints: [],
      autoInterpretation: {
        status: "failed",
        sourceComment: "10でもいい、11に行きたい",
        rules: [],
        resolvedCandidateStatuses: [],
        preferences: [
          {
            targetTokenIndexes: [0],
            targetText: "10",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-10"],
            markerTokenIndexes: [1],
            markerTexts: ["でもいい"],
            markerLabels: ["emotion_weak_accept_marker"],
            level: "preferred",
            notes: [],
            sourceComment: "10でもいい、11に行きたい",
          },
          {
            targetTokenIndexes: [2],
            targetText: "11",
            targetLabels: ["target_date"],
            targetNormalizedTexts: ["2026-04-11"],
            markerTokenIndexes: [3],
            markerTexts: ["行きたい"],
            markerLabels: ["preference_positive_marker"],
            level: "strong_preferred",
            notes: [],
            sourceComment: "10でもいい、11に行きたい",
          },
        ],
        ambiguities: [],
        failureReason: "可否ルールは作れませんでしたが、希望情報は抽出できました。",
      },
      submittedAt: "2026-04-07T09:00:00+09:00",
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    };

    const collections = buildRankedCandidateCollections(
      buildDetail({
        candidates: [april10, april11],
        responses: [response],
      }),
    );

    expect(collections.emotionPriorityRanking.map((candidate) => candidate.candidate.id)).toEqual([
      "candidate-11",
      "candidate-10",
    ]);
    expect(collections.emotionPriorityRanking.map((candidate) => candidate.plainPreferenceScoreDelta)).toEqual([3, 1]);
  });

  it("uses auto interpretation as the ranking source of truth even when parsed constraints are empty", () => {
    const sunday = buildCandidate({
      id: "candidate-sunday",
      date: "2026-04-12",
      startDate: "2026-04-12",
      endDate: "2026-04-12",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const nextSunday = buildCandidate({
      id: "candidate-next-sunday",
      date: "2026-04-19",
      startDate: "2026-04-19",
      endDate: "2026-04-19",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });
    const monday = buildCandidate({
      id: "candidate-monday",
      date: "2026-04-20",
      startDate: "2026-04-20",
      endDate: "2026-04-20",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 30,
    });
    const executionInput = buildAvailabilityInterpretationExecutionInput("休日行ける", [sunday, nextSunday, monday]);
    const builtAutoInterpretation = buildAutoInterpretationResult(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      [sunday, nextSunday, monday],
    );
    const autoInterpretation = {
      ...builtAutoInterpretation,
      rules: [],
    };

    const detail = buildDetail({
      candidates: [sunday, nextSunday, monday],
      responses: [
        {
          id: "response-holiday",
          eventId: "custom-event",
          participantName: "Aki",
          note: "休日行ける",
          parsedConstraints: [],
          autoInterpretation,
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [
            buildAnswer({ candidateId: "candidate-sunday", availabilityKey: "yes" }),
            buildAnswer({ candidateId: "candidate-next-sunday", availabilityKey: "yes" }),
            buildAnswer({ candidateId: "candidate-monday", availabilityKey: "yes" }),
          ],
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.find((candidate) => candidate.candidate.id === "candidate-sunday")?.yesCount).toBe(1);
    expect(ranked.find((candidate) => candidate.candidate.id === "candidate-next-sunday")?.yesCount).toBe(1);
    expect(ranked.find((candidate) => candidate.candidate.id === "candidate-monday")?.maybeCount).toBe(1);
  });

  it("treats fixed-time candidates as unavailable when the comment only allows a different time slot", () => {
    const daytimeCandidate = buildCandidate({
      id: "candidate-day",
      date: "2026-04-24",
      startDate: "2026-04-24",
      endDate: "2026-04-24",
      timeSlotKey: "day",
      timeType: "fixed",
      startTime: "12:00",
      endTime: "17:00",
      sortOrder: 10,
    });
    const executionInput = buildAvailabilityInterpretationExecutionInput("24日夜ならいける", [daytimeCandidate]);
    const targetTokenIndexes = executionInput.tokens
      .filter((token) => token.label === "target_date" || token.label === "target_time_of_day")
      .map((token) => token.index);
    const graph = {
      links: [
        {
          relation: "applies_to" as const,
          targetTokenIndexes,
          availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
          confidence: "high" as const,
        },
      ],
    };
    const autoInterpretation = buildAutoInterpretationResult(executionInput, graph, [daytimeCandidate]);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(executionInput, graph, [daytimeCandidate]);

    expect(autoInterpretation.resolvedCandidateStatuses).toContainEqual(
      expect.objectContaining({
        candidateId: "candidate-day",
        dateValue: "2026-04-24",
        timeSlotKey: "night",
      }),
    );
    expect(derived.parsedConstraints).toEqual([
      expect.objectContaining({
        targetType: "date_time",
        targetValue: "2026-04-24_night",
        level: "strong_yes",
      }),
    ]);

    const detail = buildDetail({
      candidates: [daytimeCandidate],
      responses: [
        {
          id: "response-1",
          eventId: "custom-event",
          participantName: "Aki",
          note: "24日夜ならいける",
          parsedConstraints: derived.parsedConstraints,
          autoInterpretation,
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: derived.answers,
        },
      ],
    });

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.noCount).toBe(1);
    expect(ranked[0]?.yesCount).toBe(0);
    expect(ranked[0]?.participantStatuses[0]?.detailLabels).toContain(
      "この候補はコメントで指定された別の時間帯なら参加可能と解釈されているため、結果集計では参加不可として扱っています。",
    );
  });

  it("builds a direct AI decision when a perfect-now candidate exists", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });

    const detail = buildDetail({
      candidates: [april10],
      responses: [
        {
          id: "response-a",
          eventId: "custom-event",
          participantName: "Aki",
          note: "10日は参加可能",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-10",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "10日は参加可能",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
      ],
    });

    const decision = buildAiScheduleDecision(detail);

    expect(decision.kind).toBe("perfect_now");
    expect(decision.primaryCandidate?.candidate.id).toBe("candidate-10");
    expect(decision.conditionsToCheck).toEqual([]);
  });

  it("builds a conditional AI decision when one condition can unlock unanimity", () => {
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });

    const detail = buildDetail({
      candidates: [april11],
      responses: [
        {
          id: "response-conditional",
          eventId: "custom-event",
          participantName: "Aki",
          note: "みんなが行ける日がこの日しかないなら11なら行ける",
          parsedConstraints: [],
          autoInterpretation: {
            status: "success",
            sourceComment: "みんなが行ける日がこの日しかないなら11なら行ける",
            rules: [],
            resolvedCandidateStatuses: [],
            preferences: [],
            conditions: [
              {
                targetTokenIndexes: [0],
                targetText: "11",
                targetLabels: ["target_date"],
                targetNormalizedTexts: ["2026-04-11"],
                conditionTokenIndexes: [1],
                markerTokenIndexes: [1],
                supportingClauseIndexes: [0],
                kind: "outcome_condition",
                resolverType: "unique_unanimous_candidate",
                participantScope: "self_only",
                requiredAvailabilityLevels: ["strong_yes"],
                unresolvedBehavior: "blocked",
                resolvedAvailabilityLevel: "strong_yes",
                resolvedPreferenceLevel: null,
                threshold: null,
                sourceComment: "みんなが行ける日がこの日しかないなら11なら行ける",
                confidence: "high",
              },
            ],
            targetContexts: [],
            comparisonPreferenceSignals: [],
            ambiguities: [],
            failureReason: null,
          },
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
      ],
    });

    const decision = buildAiScheduleDecision(detail);

    expect(decision.kind).toBe("conditional_unanimous");
    expect(decision.primaryCandidate?.candidate.id).toBe("candidate-11");
    expect(decision.conditionsToCheck).toHaveLength(1);
    expect(decision.conditionsToCheck[0]?.sourceComment).toContain("この日しか");
  });

  it("builds a best-attendance AI decision when unanimity is not available", () => {
    const april12 = buildCandidate({
      id: "candidate-12",
      date: "2026-04-12",
      startDate: "2026-04-12",
      endDate: "2026-04-12",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const april13 = buildCandidate({
      id: "candidate-13",
      date: "2026-04-13",
      startDate: "2026-04-13",
      endDate: "2026-04-13",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });

    const detail = buildDetail({
      candidates: [april12, april13],
      responses: [
        {
          id: "response-a",
          eventId: "custom-event",
          participantName: "Aki",
          note: "12日は参加可能、13日は無理",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "positive",
              level: "strong_yes",
              reasonText: "12日は参加可能",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-13",
              polarity: "negative",
              level: "hard_no",
              reasonText: "13日は無理",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
        {
          id: "response-b",
          eventId: "custom-event",
          participantName: "Nao",
          note: "12日は無理、13日も無理",
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-12",
              polarity: "negative",
              level: "hard_no",
              reasonText: "12日は無理",
              source: "auto_llm",
            },
            {
              targetType: "date",
              targetValue: "2026-04-13",
              polarity: "negative",
              level: "hard_no",
              reasonText: "13日も無理",
              source: "auto_llm",
            },
          ],
          submittedAt: "2026-04-07T09:01:00+09:00",
          answers: [],
        },
      ],
    });

    const decision = buildAiScheduleDecision(detail);

    expect(decision.kind).toBe("best_attendance");
    expect(decision.primaryCandidate?.candidate.id).toBe("candidate-12");
    expect(decision.participantNotes.some((note) => note.participantName === "Nao")).toBe(true);
  });
});
