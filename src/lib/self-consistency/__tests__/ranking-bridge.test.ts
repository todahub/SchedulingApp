import { describe, expect, it } from "vitest";
import type {
  EventCandidateRecord,
  EventDetail,
  EventRecord,
  ParticipantResponseRecord,
} from "@/lib/domain";
import { buildAiScheduleDecision, buildRankedCandidateCollections, rankCandidates } from "@/lib/ranking";
import { projectSelfConsistencyToRankingArtifacts } from "@/lib/self-consistency";
import type {
  FinalInterpretationJson,
  NormalizedScope,
  SelfConsistencyInterpretationResult,
} from "@/lib/self-consistency";

function buildCandidate(overrides: Partial<EventCandidateRecord> = {}): EventCandidateRecord {
  return {
    id: "candidate",
    eventId: "custom-event",
    date: "2026-04-18",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-18",
    endDate: "2026-04-18",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 10,
    ...overrides,
  };
}

function buildDetail(candidates: EventCandidateRecord[], responses: ParticipantResponseRecord[]): EventDetail {
  return {
    event: {
      id: "custom-event",
      title: "custom-event",
      createdAt: "2026-04-07T00:00:00+09:00",
      defaultResultMode: "maximize_attendance",
    } satisfies EventRecord,
    candidates,
    responses,
  };
}

function buildDateScope(dateValue: string): NormalizedScope {
  return {
    dateText: dateValue,
    dateType: "単日日付",
    dateMemberTexts: [dateValue],
    dateMembers: [{ sourceText: dateValue, kind: "日付", value: dateValue }],
    timeText: "全時間",
    timeType: "全時間",
    timeMembers: [{ sourceText: "全時間", kind: "補助", value: "all_times" }],
    placeText: "全場所",
    placeType: "全場所",
    placeMembers: [{ sourceText: "全場所", kind: "補助", value: "all_places" }],
    normalizedBy: "system",
  };
}

function buildDateTimeScope(dateValue: string, timeValue: string, timeText: string): NormalizedScope {
  return {
    dateText: dateValue,
    dateType: "単日日付",
    dateMemberTexts: [dateValue],
    dateMembers: [{ sourceText: dateValue, kind: "日付", value: dateValue }],
    timeText,
    timeType: "時間帯",
    timeMembers: [{ sourceText: timeText, kind: "時間帯", value: timeValue }],
    placeText: "全場所",
    placeType: "全場所",
    placeMembers: [{ sourceText: "全場所", kind: "補助", value: "all_places" }],
    normalizedBy: "system",
  };
}

function buildInterpretation(
  interpretation: FinalInterpretationJson,
): SelfConsistencyInterpretationResult {
  return {
    interpretation,
    debug: {
      baseInterpretation: {
        evaluations: [],
        comparisons: [],
        unresolved: [],
      },
      interpretationRuns: [],
      risks: [],
      multiRunTriggered: false,
      performedAdditionalRuns: 0,
    },
  };
}

describe("self-consistency ranking bridge", () => {
  it("projects stable availability evaluations into ranking-ready availability statuses", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      sortOrder: 20,
    });
    const interpretation = buildInterpretation({
      sourceText: "10はいける、11は無理",
      evaluations: [
        {
          scope: buildDateScope("2026-04-10"),
          availability: "行ける",
          availabilityConfidence: 0.9,
          availabilityConfidenceSource: "self_consistency",
          preference: null,
          externalConditionTexts: [],
          evidenceTexts: ["10はいける"],
          reviewStatus: "stable",
        },
        {
          scope: buildDateScope("2026-04-11"),
          availability: "行けない",
          availabilityConfidence: 0.9,
          availabilityConfidenceSource: "self_consistency",
          preference: null,
          externalConditionTexts: [],
          evidenceTexts: ["11は無理"],
          reviewStatus: "stable",
        },
      ],
      comparisons: [],
      unresolved: [],
      meta: {
        totalInterpretationRuns: 3,
        performedAdditionalRuns: 2,
        multiRunTriggered: true,
      },
    });

    const projected = projectSelfConsistencyToRankingArtifacts(
      interpretation.interpretation.sourceText,
      interpretation,
      [april10, april11],
    );

    expect(projected.autoInterpretation.status).toBe("success");
    expect(projected.parsedConstraints).toHaveLength(2);
    expect(projected.answers).toEqual([
      expect.objectContaining({ candidateId: "candidate-10", availabilityKey: "yes" }),
      expect.objectContaining({ candidateId: "candidate-11", availabilityKey: "no" }),
    ]);

    const detail = buildDetail([april10, april11], [
      {
        id: "response-1",
        eventId: "custom-event",
        participantName: "Aki",
        note: interpretation.interpretation.sourceText,
        parsedConstraints: projected.parsedConstraints,
        autoInterpretation: projected.autoInterpretation,
        submittedAt: "2026-04-07T09:00:00+09:00",
        answers: projected.answers,
      },
    ]);

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-10", "candidate-11"]);
  });

  it("keeps preference-only interpretations on the default-availability lane while applying comparison ordering", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      sortOrder: 10,
    });
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      sortOrder: 20,
    });
    const interpretation = buildInterpretation({
      sourceText: "10と11なら11がいい",
      evaluations: [],
      comparisons: [
        {
          candidateSetText: "10と11",
          candidateScopes: [buildDateScope("2026-04-10"), buildDateScope("2026-04-11")],
          preferredScopeText: "2026-04-11",
          directionConfidence: 1,
          preference: {
            representative: "行きたい",
            mean: 2,
            sampleCount: 3,
            histogram: {
              かなり行きたい: 0,
              行きたい: 3,
              少し行きたい: 0,
              中立: 0,
              少し避けたい: 0,
              避けたい: 0,
              かなり避けたい: 0,
            },
          },
          externalConditionTexts: [],
          evidenceTexts: ["10と11なら11がいい"],
          reviewStatus: "stable",
        },
      ],
      unresolved: [],
      meta: {
        totalInterpretationRuns: 3,
        performedAdditionalRuns: 2,
        multiRunTriggered: true,
      },
    });

    const projected = projectSelfConsistencyToRankingArtifacts(
      interpretation.interpretation.sourceText,
      interpretation,
      [april10, april11],
    );

    expect(projected.autoInterpretation.status).toBe("failed");
    expect(projected.parsedConstraints).toEqual([]);
    expect(projected.answers).toEqual([
      expect.objectContaining({ candidateId: "candidate-10", availabilityKey: "yes" }),
      expect.objectContaining({ candidateId: "candidate-11", availabilityKey: "yes" }),
    ]);

    const detail = buildDetail([april10, april11], [
      {
        id: "response-1",
        eventId: "custom-event",
        participantName: "Aki",
        note: interpretation.interpretation.sourceText,
        parsedConstraints: projected.parsedConstraints,
        autoInterpretation: projected.autoInterpretation,
        submittedAt: "2026-04-07T09:00:00+09:00",
        answers: projected.answers,
      },
    ]);

    const ranked = rankCandidates(detail, "maximize_attendance");
    expect(ranked.map((candidate) => candidate.candidate.id)).toEqual(["candidate-11", "candidate-10"]);
    expect(ranked[0]?.comparisonPreferenceScoreDelta).toBeGreaterThan(0);
  });

  it("turns external-condition evaluations into projected conditional candidates", () => {
    const april10 = buildCandidate({
      id: "candidate-10",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      sortOrder: 10,
    });
    const interpretation = buildInterpretation({
      sourceText: "10はいけるけど、バイト次第",
      evaluations: [
        {
          scope: buildDateScope("2026-04-10"),
          availability: "行ける",
          availabilityConfidence: 0.9,
          availabilityConfidenceSource: "self_consistency",
          preference: {
            representative: "行きたい",
            mean: 2,
            sampleCount: 1,
            histogram: {
              かなり行きたい: 0,
              行きたい: 1,
              少し行きたい: 0,
              中立: 0,
              少し避けたい: 0,
              避けたい: 0,
              かなり避けたい: 0,
            },
          },
          externalConditionTexts: ["バイト次第"],
          evidenceTexts: ["10はいけるけど、バイト次第"],
          reviewStatus: "stable",
        },
      ],
      comparisons: [],
      unresolved: [],
      meta: {
        totalInterpretationRuns: 3,
        performedAdditionalRuns: 2,
        multiRunTriggered: true,
      },
    });

    const projected = projectSelfConsistencyToRankingArtifacts(
      interpretation.interpretation.sourceText,
      interpretation,
      [april10],
    );
    const detail = buildDetail([april10], [
      {
        id: "response-1",
        eventId: "custom-event",
        participantName: "Aki",
        note: interpretation.interpretation.sourceText,
        parsedConstraints: projected.parsedConstraints,
        autoInterpretation: projected.autoInterpretation,
        submittedAt: "2026-04-07T09:00:00+09:00",
        answers: projected.answers,
      },
    ]);

    const decision = buildAiScheduleDecision(detail);
    expect(projected.autoInterpretation.conditions).toHaveLength(1);
    expect(decision.kind).toBe("conditional_unanimous");
  });

  it("keeps time-scoped conditions attached to the intended slot only", () => {
    const april10Day = buildCandidate({
      id: "candidate-10-day",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "day",
      timeType: "fixed",
      startTime: "12:00",
      endTime: "17:00",
      sortOrder: 10,
    });
    const april10Night = buildCandidate({
      id: "candidate-10-night",
      date: "2026-04-10",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
      timeSlotKey: "night",
      timeType: "fixed",
      startTime: "18:00",
      endTime: "22:00",
      sortOrder: 20,
    });
    const interpretation = buildInterpretation({
      sourceText: "10日の夜はいけるけど、バイト次第",
      evaluations: [
        {
          scope: buildDateTimeScope("2026-04-10", "night", "夜"),
          availability: "行ける",
          availabilityConfidence: 0.9,
          availabilityConfidenceSource: "self_consistency",
          preference: null,
          externalConditionTexts: ["バイト次第"],
          evidenceTexts: ["10日の夜はいけるけど、バイト次第"],
          reviewStatus: "stable",
        },
      ],
      comparisons: [],
      unresolved: [],
      meta: {
        totalInterpretationRuns: 3,
        performedAdditionalRuns: 2,
        multiRunTriggered: true,
      },
    });

    const projected = projectSelfConsistencyToRankingArtifacts(
      interpretation.interpretation.sourceText,
      interpretation,
      [april10Day, april10Night],
    );
    const detail = buildDetail([april10Day, april10Night], [
      {
        id: "response-1",
        eventId: "custom-event",
        participantName: "Aki",
        note: interpretation.interpretation.sourceText,
        parsedConstraints: projected.parsedConstraints,
        autoInterpretation: projected.autoInterpretation,
        submittedAt: "2026-04-07T09:00:00+09:00",
        answers: projected.answers,
      },
      {
        id: "response-2",
        eventId: "custom-event",
        participantName: "Nao",
        note: null,
        parsedConstraints: [],
        autoInterpretation: null,
        submittedAt: "2026-04-07T09:01:00+09:00",
        answers: [
          { candidateId: "candidate-10-day", availabilityKey: "yes" },
          { candidateId: "candidate-10-night", availabilityKey: "yes" },
        ],
      },
    ]);

    const collections = buildRankedCandidateCollections(detail);
    const ranked = rankCandidates(detail, "maximize_attendance");
    const dayCandidate = ranked.find((candidate) => candidate.candidate.id === "candidate-10-day");
    const nightCandidate = ranked.find((candidate) => candidate.candidate.id === "candidate-10-night");

    expect(projected.autoInterpretation.conditions).toEqual([
      expect.objectContaining({
        targetLabels: ["target_date", "target_time_of_day"],
        targetNormalizedTexts: ["2026-04-10", "night"],
      }),
    ]);
    expect(collections.perfectIfResolvedRanking.map((candidate) => candidate.candidate.id)).toEqual([
      "candidate-10-night",
      "candidate-10-day",
    ]);
    expect(dayCandidate?.conditionExplanations).toEqual([]);
    expect(dayCandidate?.participantStatuses.find((status) => status.responseId === "response-1")?.availabilityKey).toBe("maybe");
    expect(dayCandidate?.participantStatuses.find((status) => status.responseId === "response-1")?.isConditionBlocked).not.toBe(true);
    expect(nightCandidate?.conditionExplanations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetText: "4/10(金) 夜",
          resolverType: "self_convenience",
        }),
      ]),
    );
  });
});
