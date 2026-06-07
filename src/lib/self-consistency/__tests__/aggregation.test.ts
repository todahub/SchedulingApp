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

function buildDateScope(text: string) {
  return {
    dateText: text,
    dateType: "単日日付" as const,
    dateMemberTexts: [text],
    timeText: "全時間",
    timeType: "全時間" as const,
    placeText: "全場所",
    placeType: "全場所" as const,
  };
}

describe("aggregateInterpretation", () => {
  it("aggregates full-pass evaluation votes into availability confidence and nullable preference", () => {
    const drafts: BaseInterpretationDraft[] = [
      {
        evaluations: [
          {
            scope: buildDateScope("11日"),
            availability: "行ける",
            preference: "少し行きたい",
            externalConditionTexts: [],
            evidenceText: "11日はいけたら行きたい",
          },
        ],
        comparisons: [],
        unresolved: [],
      },
      {
        evaluations: [
          {
            scope: buildDateScope("11日"),
            availability: "行ける",
            preference: "行きたい",
            externalConditionTexts: [],
            evidenceText: "11日はいけたら行きたい",
          },
        ],
        comparisons: [],
        unresolved: [],
      },
      {
        evaluations: [
          {
            scope: buildDateScope("11日"),
            availability: "行けない",
            preference: null,
            externalConditionTexts: [],
            evidenceText: "11日はいけたら行きたい",
          },
        ],
        comparisons: [],
        unresolved: [],
      },
    ];

    const aggregated = aggregateInterpretation({
      note: "11日はいけたら行きたい",
      drafts,
      candidates,
    });

    expect(aggregated.evaluations[0]?.availability).toBe("行ける");
    expect(aggregated.evaluations[0]?.availabilityConfidence).toBe(0.67);
    expect(aggregated.evaluations[0]?.reviewStatus).toBe("mixed");
    expect(aggregated.evaluations[0]?.preference?.mean).toBe(1.5);
    expect(aggregated.meta.totalInterpretationRuns).toBe(3);
    expect(aggregated.meta.performedAdditionalRuns).toBe(2);
  });

  it("aggregates full-pass comparison direction confidence without inventing availability", () => {
    const drafts: BaseInterpretationDraft[] = [
      {
        evaluations: [],
        comparisons: [
          {
            candidateSetText: "11と12",
            candidateScopes: [buildDateScope("11"), buildDateScope("12")],
            preferredScopeText: "12",
            preference: "少し行きたい",
            externalConditionTexts: [],
            evidenceText: "11と12なら12かな",
          },
        ],
        unresolved: [],
      },
      {
        evaluations: [],
        comparisons: [
          {
            candidateSetText: "11と12",
            candidateScopes: [buildDateScope("11"), buildDateScope("12")],
            preferredScopeText: "12",
            preference: "行きたい",
            externalConditionTexts: [],
            evidenceText: "11と12なら12かな",
          },
        ],
        unresolved: [],
      },
      {
        evaluations: [],
        comparisons: [
          {
            candidateSetText: "11と12",
            candidateScopes: [buildDateScope("11"), buildDateScope("12")],
            preferredScopeText: "11",
            preference: "少し避けたい",
            externalConditionTexts: [],
            evidenceText: "11と12なら12かな",
          },
        ],
        unresolved: [],
      },
    ];

    const aggregated = aggregateInterpretation({
      note: "11と12なら12かな",
      drafts,
      candidates,
    });

    expect(aggregated.evaluations).toEqual([]);
    expect(aggregated.comparisons[0]?.preferredScopeText).toBe("12");
    expect(aggregated.comparisons[0]?.directionConfidence).toBe(0.67);
    expect(aggregated.comparisons[0]?.reviewStatus).toBe("mixed");
    expect(aggregated.comparisons[0]?.preference.mean).toBe(0.67);
  });

  it("merges comparison runs when the same candidate set is extracted with slightly different scope detail", () => {
    const drafts: BaseInterpretationDraft[] = [
      {
        evaluations: [],
        comparisons: [
          {
            candidateSetText: "19日と20日",
            candidateScopes: [buildDateScope("19日"), buildDateScope("20日")],
            preferredScopeText: "19日",
            preference: "行きたい",
            externalConditionTexts: [],
            evidenceText: "19日と20日なら19日の方が嬉しい",
          },
        ],
        unresolved: [],
      },
      {
        evaluations: [],
        comparisons: [
          {
            candidateSetText: "19日と20日",
            candidateScopes: [buildDateScope("19日")],
            preferredScopeText: "19日",
            preference: "少し行きたい",
            externalConditionTexts: ["他の日が難しければ"],
            evidenceText: "19日と20日なら19日の方が嬉しいですが、他の日が難しければ20日でも大丈夫です",
          },
        ],
        unresolved: [],
      },
    ];

    const aggregated = aggregateInterpretation({
      note: "19日と20日なら19日の方が嬉しいですが、他の日が難しければ20日でも大丈夫です",
      drafts,
      candidates,
    });

    expect(aggregated.comparisons).toHaveLength(1);
    expect(aggregated.comparisons[0]?.preferredScopeText).toBe("19日");
    expect(aggregated.comparisons[0]?.directionConfidence).toBe(1);
    expect(aggregated.comparisons[0]?.preference.mean).toBe(1.5);
    expect(aggregated.comparisons[0]?.externalConditionTexts).toEqual([]);
    expect(aggregated.unresolved).toEqual([]);
  });

  it("drops availability evaluations that were only inferred from comparison wording", () => {
    const drafts: BaseInterpretationDraft[] = [
      {
        evaluations: [
          {
            scope: buildDateScope("19日"),
            availability: "行ける",
            preference: "行きたい",
            externalConditionTexts: [],
            evidenceText: "19日の方が嬉しい",
          },
        ],
        comparisons: [
          {
            candidateSetText: "19日と20日",
            candidateScopes: [buildDateScope("19日"), buildDateScope("20日")],
            preferredScopeText: "19日",
            preference: "行きたい",
            externalConditionTexts: [],
            evidenceText: "19日と20日なら19日の方が嬉しい",
          },
        ],
        unresolved: [],
      },
    ];

    const aggregated = aggregateInterpretation({
      note: "19日と20日なら19日の方が嬉しい",
      drafts,
      candidates,
    });

    expect(aggregated.evaluations).toEqual([]);
    expect(aggregated.comparisons).toHaveLength(1);
    expect(aggregated.unresolved).toEqual([]);
  });
});
