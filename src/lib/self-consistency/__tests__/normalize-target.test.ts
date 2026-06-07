import { describe, expect, it } from "vitest";
import { normalizeTargetDraft } from "@/lib/self-consistency";
import type { EventCandidateRecord } from "@/lib/domain";

const candidates: EventCandidateRecord[] = [
  {
    id: "candidate-1",
    eventId: "event-1",
    date: "2026-06-18",
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-06-18",
    endDate: "2026-06-18",
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: 10,
  },
];

describe("normalizeTargetDraft", () => {
  it("keeps conditional time as a separate role without upgrading target type", () => {
    const normalized = normalizeTargetDraft(
      {
        targetText: "18日",
        targetType: "単日日付",
        memberTexts: ["18日", "夜"],
        timeText: "夜",
        timeRole: "条件",
      },
      candidates,
    );

    expect(normalized.targetType).toBe("単日日付");
    expect(normalized.timeText).toBe("夜");
    expect(normalized.timeRole).toBe("条件");
    expect(normalized.members.some((member) => member.kind === "時間帯" && member.sourceText === "夜")).toBe(true);
  });

  it("upgrades target type when time is part of the target itself", () => {
    const normalized = normalizeTargetDraft(
      {
        targetText: "18日夜",
        targetType: "単日日付と時間帯",
        memberTexts: ["18日", "夜"],
        timeText: "夜",
        timeRole: "対象",
      },
      candidates,
    );

    expect(normalized.targetType).toBe("単日日付と時間帯");
    expect(normalized.timeRole).toBe("対象");
  });
});
