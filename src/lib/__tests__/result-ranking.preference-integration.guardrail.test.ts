import { describe, expect, it, vi } from "vitest";
import {
  buildComparisonPreferenceInterpretationInput,
  buildRankingPreferenceSignalsFromJudgments,
  type ComparisonPreferenceInterpretationInput,
  type ComparisonPreferenceJudgment,
} from "@/lib/comparison-preference-interpretation";
import { interpretAvailabilityCommentSubmissionWithOllama } from "@/lib/availability-comment-interpretation-server";
import type { EventCandidateRecord, EventDetail, EventRecord, ParticipantResponseRecord } from "@/lib/domain";
import { rankCandidates } from "@/lib/ranking";

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

function findClause(input: ComparisonPreferenceInterpretationInput, pattern: RegExp) {
  const clause = input.relevantClauses.find((candidate) => pattern.test(candidate.text));

  if (!clause) {
    throw new Error(`Relevant clause not found for ${String(pattern)} in "${input.originalText}"`);
  }

  return clause;
}

function findTargetGroupId(
  input: ComparisonPreferenceInterpretationInput,
  clausePattern: RegExp,
  hypothesisId: string,
  expectedTexts: string[],
) {
  const clause = findClause(input, clausePattern);
  const hypothesis = clause.groupingHypotheses.find((candidate) => candidate.hypothesisId === hypothesisId);

  if (!hypothesis) {
    throw new Error(`Hypothesis ${hypothesisId} not found for clause "${clause.text}"`);
  }

  const targetGroup = hypothesis.targetGroups.find(
    (candidate) => JSON.stringify(candidate.texts) === JSON.stringify(expectedTexts),
  );

  if (!targetGroup) {
    throw new Error(
      `Target group ${JSON.stringify(expectedTexts)} not found in hypothesis ${hypothesisId} for clause "${clause.text}"`,
    );
  }

  return targetGroup.id;
}

function findTriggerTokenIndex(
  input: ComparisonPreferenceInterpretationInput,
  options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
  },
) {
  const matches = input.tokens.filter((token) => {
    const labelMatch = !options.label || token.label === options.label;
    const textMatch =
      !options.text ||
      (typeof options.text === "string" ? token.text === options.text : options.text.test(token.text));

    return labelMatch && textMatch;
  });

  const match = matches[options.nth ?? 0];

  if (!match) {
    throw new Error(
      `Token not found for label=${String(options.label)} text=${String(options.text)} nth=${String(options.nth ?? 0)} in "${input.originalText}"`,
    );
  }

  return match.index;
}

function buildResponseWithSignals({
  responseId,
  participantName,
  comment,
  candidates,
  judgments,
  answers,
}: {
  responseId: string;
  participantName: string;
  comment: string;
  candidates: EventCandidateRecord[];
  judgments: ComparisonPreferenceJudgment[];
  answers: ParticipantResponseRecord["answers"];
}): ParticipantResponseRecord {
  const input = buildComparisonPreferenceInterpretationInput(comment, candidates);
  const comparisonPreferenceSignals = buildRankingPreferenceSignalsFromJudgments(input, judgments);

  return {
    id: responseId,
    eventId: "custom-event",
    participantName,
    note: comment,
    parsedConstraints: [],
    autoInterpretation: {
      status: "failed",
      sourceComment: comment,
      rules: [],
      resolvedCandidateStatuses: [],
      preferences: [],
      comparisonPreferenceSignals,
      ambiguities: [],
      failureReason: "comparison/preference only",
    },
    submittedAt: "2026-04-07T09:00:00+09:00",
    answers,
  };
}

describe("result ranking preference integration guardrails", () => {
  it("uses comparison/preference signals only as a same-tier ordering adjustment", () => {
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
    const input = buildComparisonPreferenceInterpretationInput("10と11なら11がいい", [april10, april11]);
    const mergedHypothesisId = "gh-merge-1";
    const comparedSetId = findTargetGroupId(input, /10と11なら11がいい/u, mergedHypothesisId, ["10", "11"]);
    const preferredId = findTargetGroupId(input, /10と11なら11がいい/u, mergedHypothesisId, ["11"]);
    const response = buildResponseWithSignals({
      responseId: "response-1",
      participantName: "Aki",
      comment: "10と11なら11がいい",
      candidates: [april10, april11],
      judgments: [
        {
          groupingHypothesisId: mergedHypothesisId,
          kind: "comparison",
          comparedTargetGroupIds: [comparedSetId, preferredId],
          preferredTargetGroupId: preferredId,
          dispreferredTargetGroupIds: [comparedSetId],
          relation: "better_than",
          strength: "strong",
          confidence: "high",
          triggerTokenIndexes: [2, 4],
          supportingClauseIndexes: [0],
          notes: null,
        },
      ],
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    });

    const ranked = rankCandidates(
      buildDetail({
        candidates: [april10, april11],
        responses: [response],
      }),
      "maximize_attendance",
    );

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11", "candidate-10"]);
    expect(ranked.map((candidate) => candidate.preferenceScoreDelta)).toEqual([2, 0]);
    expect(ranked[0]?.preferenceExplanations).toEqual([
      expect.objectContaining({
        participantName: "Aki",
        targetGroupId: preferredId,
        preferenceScoreDelta: 2,
      }),
    ]);
  });

  it("does not double-count a duplicate preference when the same evidence is already represented as comparison", () => {
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
    const april12 = buildCandidate({
      id: "candidate-12",
      date: "2026-04-12",
      startDate: "2026-04-12",
      endDate: "2026-04-12",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });
    const input = buildComparisonPreferenceInterpretationInput("11より12がいい", [april11, april12]);
    const dispreferredId = findTargetGroupId(input, /11より12がいい/u, "gh-default", ["11"]);
    const preferredId = findTargetGroupId(input, /11より12がいい/u, "gh-default", ["12"]);
    const markerIndex = findTriggerTokenIndex(input, { label: "comparison_marker", text: /より/ });
    const comparisonPreferenceSignals = buildRankingPreferenceSignalsFromJudgments(input, [
      {
        groupingHypothesisId: "gh-default",
        kind: "comparison",
        comparedTargetGroupIds: [dispreferredId, preferredId],
        preferredTargetGroupId: preferredId,
        dispreferredTargetGroupIds: [dispreferredId],
        relation: "better_than",
        strength: "strong",
        confidence: "high",
        triggerTokenIndexes: [markerIndex],
        supportingClauseIndexes: [0],
        notes: null,
      },
      {
        groupingHypothesisId: "gh-default",
        kind: "preference",
        comparedTargetGroupIds: [preferredId],
        preferredTargetGroupId: preferredId,
        dispreferredTargetGroupIds: [],
        relation: "preferred",
        strength: "strong",
        confidence: "high",
        triggerTokenIndexes: [markerIndex],
        supportingClauseIndexes: [0],
        notes: null,
      },
    ]);

    expect(comparisonPreferenceSignals.filter((signal) => signal.targetGroupId === preferredId && signal.signal === "preferred")).toHaveLength(1);
    expect(comparisonPreferenceSignals.filter((signal) => signal.targetGroupId === dispreferredId && signal.signal === "dispreferred")).toHaveLength(1);
  });

  it("reads comparisonPreferenceSignals generated by the main submission pipeline", async () => {
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
    const comment = "10と11なら11がいい";
    const input = buildComparisonPreferenceInterpretationInput(comment, [april10, april11]);
    const mergedHypothesisId = "gh-merge-1";
    const comparedSetId = findTargetGroupId(input, /10と11なら11がいい/u, mergedHypothesisId, ["10", "11"]);
    const preferredId = findTargetGroupId(input, /10と11なら11がいい/u, mergedHypothesisId, ["11"]);
    const markerIndex = findTriggerTokenIndex(input, { label: "preference_positive_marker", text: /がいい/ });
    const conditionIndex = findTriggerTokenIndex(input, { label: "conditional_marker", text: "なら" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            judgments: [
              {
                groupingHypothesisId: mergedHypothesisId,
                kind: "comparison",
                comparedTargetGroupIds: [comparedSetId, preferredId],
                preferredTargetGroupId: preferredId,
                dispreferredTargetGroupIds: [comparedSetId],
                relation: "better_than",
                strength: "strong",
                confidence: "high",
                triggerTokenIndexes: [conditionIndex, markerIndex],
                supportingClauseIndexes: [0],
                notes: null,
              },
            ],
            warnings: [],
          }),
        },
      }),
    });

    const submission = await interpretAvailabilityCommentSubmissionWithOllama(comment, [april10, april11], {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(submission.autoInterpretation.comparisonPreferenceSignals).toEqual([
      expect.objectContaining({
        targetGroupId: preferredId,
        targetValue: "2026-04-11",
        signal: "preferred",
      }),
    ]);

    const ranked = rankCandidates(
      buildDetail({
        candidates: [april10, april11],
        responses: [
          {
            id: "response-1",
            eventId: "custom-event",
            participantName: "Aki",
            note: comment,
            parsedConstraints: submission.parsedConstraints,
            autoInterpretation: submission.autoInterpretation,
            submittedAt: "2026-04-07T09:00:00+09:00",
            answers: submission.answers,
          },
        ],
      }),
      "maximize_attendance",
    );

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11", "candidate-10"]);
    expect(ranked[0]?.preferenceScoreDelta).toBe(2);
  });

  it("applies date-time comparison signals to the matching candidate slice", () => {
    const april10Morning = buildCandidate({
      id: "candidate-10-morning",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "morning",
      timeType: "fixed",
      startTime: "09:00",
      endTime: "12:00",
      sortOrder: 10,
    });
    const april11Day = buildCandidate({
      id: "candidate-11-day",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "day",
      timeType: "fixed",
      startTime: "13:00",
      endTime: "17:00",
      sortOrder: 20,
    });
    const input = buildComparisonPreferenceInterpretationInput(
      "10日の午前より11日の午後の方がいい",
      [april10Morning, april11Day],
    );
    const worseId = findTargetGroupId(input, /10日の午前より11日の午後/u, "gh-default", ["10日", "午前"]);
    const preferredId = findTargetGroupId(input, /10日の午前より11日の午後/u, "gh-default", ["11日", "午後"]);
    const response = buildResponseWithSignals({
      responseId: "response-1",
      participantName: "Aki",
      comment: "10日の午前より11日の午後の方がいい",
      candidates: [april10Morning, april11Day],
      judgments: [
        {
          groupingHypothesisId: "gh-default",
          kind: "comparison",
          comparedTargetGroupIds: [worseId, preferredId],
          preferredTargetGroupId: preferredId,
          dispreferredTargetGroupIds: [worseId],
          relation: "better_than",
          strength: "strong",
          confidence: "high",
          triggerTokenIndexes: [2],
          supportingClauseIndexes: [0],
          notes: null,
        },
      ],
      answers: [
        buildAnswer({ candidateId: "candidate-10-morning", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11-day", availabilityKey: "yes" }),
      ],
    });

    const ranked = rankCandidates(
      buildDetail({
        candidates: [april10Morning, april11Day],
        responses: [response],
      }),
      "maximize_attendance",
    );

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11-day", "candidate-10-morning"]);
    expect(ranked.map((candidate) => candidate.preferenceScoreDelta)).toEqual([2, -2]);
  });

  it("does not let preference signals override availability negatives", () => {
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
    const input = buildComparisonPreferenceInterpretationInput("11の方がいい", [april10, april11]);
    const preferredId = findTargetGroupId(input, /11の方がいい/u, "gh-default", ["11"]);
    const response = buildResponseWithSignals({
      responseId: "response-1",
      participantName: "Aki",
      comment: "11の方がいい",
      candidates: [april10, april11],
      judgments: [
        {
          groupingHypothesisId: "gh-default",
          kind: "comparison",
          comparedTargetGroupIds: [preferredId],
          preferredTargetGroupId: preferredId,
          relation: "preferred",
          strength: "strong",
          confidence: "high",
          triggerTokenIndexes: [1],
          supportingClauseIndexes: [0],
          notes: null,
        },
      ],
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "no" }),
      ],
    });

    const ranked = rankCandidates(
      buildDetail({
        candidates: [april10, april11],
        responses: [response],
      }),
      "maximize_attendance",
    );

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11"]);
    expect(ranked[1]?.preferenceScoreDelta).toBe(2);
    expect(ranked[1]?.unavailableCount).toBe(1);
  });

  it("keeps availability handling intact while still applying safe weekday preference nudges", () => {
    const friday = buildCandidate({
      id: "candidate-friday",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });
    const saturday = buildCandidate({
      id: "candidate-saturday",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 20,
    });
    const input = buildComparisonPreferenceInterpretationInput("平日は無理、土の方がいい", [friday, saturday]);
    const preferredId = findTargetGroupId(input, /土の方がいい/u, "gh-default", ["土"]);
    const response = buildResponseWithSignals({
      responseId: "response-1",
      participantName: "Aki",
      comment: "平日は無理、土の方がいい",
      candidates: [friday, saturday],
      judgments: [
        {
          groupingHypothesisId: "gh-default",
          kind: "comparison",
          comparedTargetGroupIds: [preferredId],
          preferredTargetGroupId: preferredId,
          relation: "preferred",
          strength: "strong",
          confidence: "high",
          triggerTokenIndexes: [4],
          supportingClauseIndexes: [1],
          notes: null,
        },
      ],
      answers: [
        buildAnswer({ candidateId: "candidate-friday", availabilityKey: "no" }),
        buildAnswer({ candidateId: "candidate-saturday", availabilityKey: "yes" }),
      ],
    });

    const ranked = rankCandidates(
      buildDetail({
        candidates: [friday, saturday],
        responses: [response],
      }),
      "maximize_attendance",
    );

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-saturday", "candidate-friday"]);
    expect(ranked[0]?.preferenceScoreDelta).toBe(2);
    expect(ranked[1]?.unavailableCount).toBe(1);
  });

  it("treats weak preference signals as a small tie-break only", () => {
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
    const input = buildComparisonPreferenceInterpretationInput("どっちかといえば11", [april10, april11]);
    const preferredId = findTargetGroupId(input, /どっちかといえば11/u, "gh-default", ["11"]);
    const response = buildResponseWithSignals({
      responseId: "response-1",
      participantName: "Aki",
      comment: "どっちかといえば11",
      candidates: [april10, april11],
      judgments: [
        {
          groupingHypothesisId: "gh-default",
          kind: "preference",
          comparedTargetGroupIds: [preferredId],
          preferredTargetGroupId: preferredId,
          relation: "preferred",
          strength: "weak",
          confidence: "medium",
          triggerTokenIndexes: [0],
          supportingClauseIndexes: [0],
          notes: null,
        },
      ],
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    });

    const ranked = rankCandidates(
      buildDetail({
        candidates: [april10, april11],
        responses: [response],
      }),
      "maximize_attendance",
    );

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11", "candidate-10"]);
    expect(ranked.map((candidate) => candidate.preferenceScoreDelta)).toEqual([0.5, 0]);
  });

  it("does not apply preference correction for plain availability-only input", () => {
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

    const ranked = rankCandidates(
      buildDetail({
        candidates: [april10, april11],
        responses: [
          {
            id: "response-1",
            eventId: "custom-event",
            participantName: "Aki",
            note: "11ならいける",
            parsedConstraints: [],
            autoInterpretation: null,
            submittedAt: "2026-04-07T09:00:00+09:00",
            answers: [
              buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
              buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
            ],
          },
        ],
      }),
      "maximize_attendance",
    );

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11"]);
    expect(ranked.map((candidate) => candidate.preferenceScoreDelta)).toEqual([0, 0]);
  });

  it("can apply both positive and negative comparison signals without overpowering the base ranking", () => {
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
    const input = buildComparisonPreferenceInterpretationInput("10より11の方がいい", [april10, april11]);
    const dispreferredId = findTargetGroupId(input, /10より11の方がいい/u, "gh-default", ["10"]);
    const preferredId = findTargetGroupId(input, /10より11の方がいい/u, "gh-default", ["11"]);
    const response = buildResponseWithSignals({
      responseId: "response-1",
      participantName: "Aki",
      comment: "10より11の方がいい",
      candidates: [april10, april11],
      judgments: [
        {
          groupingHypothesisId: "gh-default",
          kind: "comparison",
          comparedTargetGroupIds: [dispreferredId, preferredId],
          preferredTargetGroupId: preferredId,
          dispreferredTargetGroupIds: [dispreferredId],
          relation: "better_than",
          strength: "strong",
          confidence: "high",
          triggerTokenIndexes: [1],
          supportingClauseIndexes: [0],
          notes: null,
        },
      ],
      answers: [
        buildAnswer({ candidateId: "candidate-10", availabilityKey: "yes" }),
        buildAnswer({ candidateId: "candidate-11", availabilityKey: "yes" }),
      ],
    });

    const ranked = rankCandidates(
      buildDetail({
        candidates: [april10, april11],
        responses: [response],
      }),
      "maximize_attendance",
    );

    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11", "candidate-10"]);
    expect(ranked.map((candidate) => candidate.preferenceScoreDelta)).toEqual([2, -2]);
  });
});
