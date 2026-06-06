import { describe, expect, it } from "vitest";
import { aggregateInterpretation } from "@/lib/self-consistency";
import type { BaseInterpretationDraft, ReviewRun } from "@/lib/self-consistency";
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

describe("aggregateInterpretation", () => {
  it("aggregates evaluation votes into availability confidence and preference summary", () => {
    const draft: BaseInterpretationDraft = {
      evaluations: [
        {
          targetText: "11日",
          targetType: "単日日付",
          memberTexts: ["11日"],
          availability: "行ける",
          preference: null,
          conditionText: null,
          evidenceText: "11日はまあ行ける",
        },
      ],
      comparisons: [],
      conditions: [],
      unresolved: [],
    };
    const reviewRuns: ReviewRun[] = [
      {
        taskId: "evaluation:0",
        kind: "evaluation",
        attempt: 1,
        decision: {
          targetText: "11日",
          availability: "行ける",
          preference: null,
          evidenceText: "11日はまあ行ける",
        },
      },
      {
        taskId: "evaluation:0",
        kind: "evaluation",
        attempt: 2,
        decision: {
          targetText: "11日",
          availability: "行ける",
          preference: null,
          evidenceText: "11日はまあ行ける",
        },
      },
      {
        taskId: "evaluation:0",
        kind: "evaluation",
        attempt: 3,
        decision: {
          targetText: "11日",
          availability: "行けない",
          preference: null,
          evidenceText: "11日はまあ行ける",
        },
      },
    ];

    const aggregated = aggregateInterpretation({
      note: "11日はまあ行ける",
      draft,
      reviewRuns,
      candidates,
    });

    expect(aggregated.targetEvaluations[0]?.availability).toBe("行ける");
    expect(aggregated.targetEvaluations[0]?.availabilityConfidence).toBe(0.67);
    expect(aggregated.targetEvaluations[0]?.reviewStatus).toBe("mixed");
    expect(aggregated.targetEvaluations[0]?.preference).toBeNull();
  });

  it("aggregates comparison direction confidence", () => {
    const draft: BaseInterpretationDraft = {
      evaluations: [],
      comparisons: [
        {
          candidateSetText: "11と12",
          candidateTargets: [
            {
              targetText: "11",
              targetType: "単日日付",
              memberTexts: ["11"],
            },
            {
              targetText: "12",
              targetType: "単日日付",
              memberTexts: ["12"],
            },
          ],
          preferredTargetText: "12",
          preference: "少し行きたい",
          conditionText: "11と12なら",
          evidenceText: "11と12なら12かな",
        },
      ],
      conditions: [],
      unresolved: [],
    };
    const reviewRuns: ReviewRun[] = [
      {
        taskId: "comparison:0",
        kind: "comparison",
        attempt: 1,
        decision: {
          candidateSetText: "11と12",
          preferredTargetText: "12",
          preference: "少し行きたい",
          conditionText: "11と12なら",
          evidenceText: "11と12なら12かな",
        },
      },
      {
        taskId: "comparison:0",
        kind: "comparison",
        attempt: 2,
        decision: {
          candidateSetText: "11と12",
          preferredTargetText: "12",
          preference: "行きたい",
          conditionText: "11と12なら",
          evidenceText: "11と12なら12かな",
        },
      },
      {
        taskId: "comparison:0",
        kind: "comparison",
        attempt: 3,
        decision: {
          candidateSetText: "11と12",
          preferredTargetText: "11",
          preference: "少し避けたい",
          conditionText: "11と12なら",
          evidenceText: "11と12なら12かな",
        },
      },
    ];

    const aggregated = aggregateInterpretation({
      note: "11と12なら12かな",
      draft,
      reviewRuns,
      candidates,
    });

    expect(aggregated.comparisons[0]?.preferredTargetText).toBe("12");
    expect(aggregated.comparisons[0]?.directionConfidence).toBe(0.67);
    expect(aggregated.comparisons[0]?.reviewStatus).toBe("mixed");
  });
});
