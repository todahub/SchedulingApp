import { describe, expect, it } from "vitest";
import { aggregateInterpretation } from "@/lib/self-consistency";
import type { BaseInterpretationDraft } from "@/lib/self-consistency";
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
  it("aggregates full-pass evaluation votes into availability confidence and nullable preference", () => {
    const drafts: BaseInterpretationDraft[] = [
      {
        evaluations: [
          {
            targetText: "11日",
            targetType: "単日日付",
            memberTexts: ["11日"],
            timeText: null,
            timeRole: "指定なし",
            availability: "行ける",
            preference: "少し行きたい",
            conditionText: null,
            evidenceText: "11日はいけたら行きたい",
          },
        ],
        comparisons: [],
        conditions: [],
        unresolved: [],
      },
      {
        evaluations: [
          {
            targetText: "11日",
            targetType: "単日日付",
            memberTexts: ["11日"],
            timeText: null,
            timeRole: "指定なし",
            availability: "行ける",
            preference: "行きたい",
            conditionText: null,
            evidenceText: "11日はいけたら行きたい",
          },
        ],
        comparisons: [],
        conditions: [],
        unresolved: [],
      },
      {
        evaluations: [
          {
            targetText: "11日",
            targetType: "単日日付",
            memberTexts: ["11日"],
            timeText: null,
            timeRole: "指定なし",
            availability: "行けない",
            preference: null,
            conditionText: null,
            evidenceText: "11日はいけたら行きたい",
          },
        ],
        comparisons: [],
        conditions: [],
        unresolved: [],
      },
    ];

    const aggregated = aggregateInterpretation({
      note: "11日はいけたら行きたい",
      drafts,
      candidates,
    });

    expect(aggregated.targetEvaluations[0]?.availability).toBe("行ける");
    expect(aggregated.targetEvaluations[0]?.availabilityConfidence).toBe(0.67);
    expect(aggregated.targetEvaluations[0]?.reviewStatus).toBe("mixed");
    expect(aggregated.targetEvaluations[0]?.preference?.mean).toBe(1.5);
    expect(aggregated.meta.totalInterpretationRuns).toBe(3);
    expect(aggregated.meta.performedAdditionalRuns).toBe(2);
  });

  it("aggregates full-pass comparison direction confidence", () => {
    const drafts: BaseInterpretationDraft[] = [
      {
        evaluations: [],
        comparisons: [
          {
            candidateSetText: "11と12",
            candidateTargets: [
              {
                targetText: "11",
                targetType: "単日日付",
                memberTexts: ["11"],
                timeText: null,
                timeRole: "指定なし",
              },
              {
                targetText: "12",
                targetType: "単日日付",
                memberTexts: ["12"],
                timeText: null,
                timeRole: "指定なし",
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
      },
      {
        evaluations: [],
        comparisons: [
          {
            candidateSetText: "11と12",
            candidateTargets: [
              {
                targetText: "11",
                targetType: "単日日付",
                memberTexts: ["11"],
                timeText: null,
                timeRole: "指定なし",
              },
              {
                targetText: "12",
                targetType: "単日日付",
                memberTexts: ["12"],
                timeText: null,
                timeRole: "指定なし",
              },
            ],
            preferredTargetText: "12",
            preference: "行きたい",
            conditionText: "11と12なら",
            evidenceText: "11と12なら12かな",
          },
        ],
        conditions: [],
        unresolved: [],
      },
      {
        evaluations: [],
        comparisons: [
          {
            candidateSetText: "11と12",
            candidateTargets: [
              {
                targetText: "11",
                targetType: "単日日付",
                memberTexts: ["11"],
                timeText: null,
                timeRole: "指定なし",
              },
              {
                targetText: "12",
                targetType: "単日日付",
                memberTexts: ["12"],
                timeText: null,
                timeRole: "指定なし",
              },
            ],
            preferredTargetText: "11",
            preference: "少し避けたい",
            conditionText: "11と12なら",
            evidenceText: "11と12なら12かな",
          },
        ],
        conditions: [],
        unresolved: [],
      },
    ];

    const aggregated = aggregateInterpretation({
      note: "11と12なら12かな",
      drafts,
      candidates,
    });

    expect(aggregated.comparisons[0]?.preferredTargetText).toBe("12");
    expect(aggregated.comparisons[0]?.directionConfidence).toBe(0.67);
    expect(aggregated.comparisons[0]?.reviewStatus).toBe("mixed");
    expect(aggregated.comparisons[0]?.preference.mean).toBe(0.67);
  });
});
