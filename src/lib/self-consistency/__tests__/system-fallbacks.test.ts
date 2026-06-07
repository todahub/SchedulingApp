import { describe, expect, it } from "vitest";
import type { EventCandidateRecord } from "@/lib/domain";
import type { BaseInterpretationDraft } from "@/lib/self-consistency";
import { applySystemFallbacks } from "@/lib/self-consistency/system-fallbacks";

const candidates: EventCandidateRecord[] = [
  {
    id: "candidate-1",
    eventId: "event-1",
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
  },
  {
    id: "candidate-2",
    eventId: "event-1",
    date: "2026-04-19",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-19",
    endDate: "2026-04-19",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 20,
  },
];

describe("applySystemFallbacks", () => {
  it("adds a deterministic comparison when LLM returns empty output for a comparison-only sentence", () => {
    const draft: BaseInterpretationDraft = {
      evaluations: [],
      comparisons: [],
      unresolved: [],
    };

    const result = applySystemFallbacks("18と19なら19がいい", draft, candidates);

    expect(result.evaluations).toEqual([]);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0]?.candidateSetText).toBe("18と19");
    expect(result.comparisons[0]?.preferredScopeText).toBe("19");
  });

  it("does not let external-condition-free negative preference escape as conditional availability", () => {
    const draft: BaseInterpretationDraft = {
      evaluations: [
        {
          scope: {
            dateText: "4月前半",
            dateType: "月の一部",
            dateMemberTexts: ["4月前半"],
            timeText: "全時間",
            timeType: "全時間",
            placeText: "全場所",
            placeType: "全場所",
          },
          availability: "条件付きで行ける",
          preference: "少し避けたい",
          externalConditionTexts: [],
          evidenceText: "4月前半は少し厳しいかもです",
        },
      ],
      comparisons: [],
      unresolved: [],
    };

    const result = applySystemFallbacks("4月前半は少し厳しいかもです", draft, candidates);

    expect(result.evaluations[0]?.availability).toBe("行けない");
  });

  it("recovers an evaluation when LLM marks an explicit out-of-candidate period as unresolved", () => {
    const draft: BaseInterpretationDraft = {
      evaluations: [],
      comparisons: [],
      unresolved: [
        {
          text: "4月前半は少し厳しいかもです",
          reason: "候補日ではない期間に関するコメント",
        },
      ],
    };

    const result = applySystemFallbacks("4月前半は少し厳しいかもです", draft, candidates);

    expect(result.evaluations[0]?.scope.dateText).toBe("4月前半");
    expect(result.evaluations[0]?.availability).toBe("行けない");
    expect(result.evaluations[0]?.preference).toBe("少し避けたい");
    expect(result.unresolved).toEqual([]);
  });
});
