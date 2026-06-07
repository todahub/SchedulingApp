import { describe, expect, it } from "vitest";
import { normalizeScopeDraft } from "@/lib/self-consistency";
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

describe("normalizeScopeDraft", () => {
  it("keeps time as a first-class scope axis", () => {
    const normalized = normalizeScopeDraft(
      {
        dateText: "18日",
        dateType: "単日日付",
        dateMemberTexts: ["18日"],
        timeText: "夜",
        timeType: "時間帯",
        placeText: "全場所",
        placeType: "全場所",
      },
      candidates,
    );

    expect(normalized.dateType).toBe("単日日付");
    expect(normalized.timeType).toBe("時間帯");
    expect(normalized.timeText).toBe("夜");
    expect(normalized.timeMembers.some((member) => member.kind === "時間帯" && member.sourceText === "夜")).toBe(true);
  });

  it("uses wildcard axes when date or place are unspecified", () => {
    const normalized = normalizeScopeDraft(
      {
        dateText: "全日付",
        dateType: "全日付",
        dateMemberTexts: ["全日付"],
        timeText: "夜",
        timeType: "時間帯",
        placeText: "全場所",
        placeType: "全場所",
      },
      candidates,
    );

    expect(normalized.dateText).toBe("全日付");
    expect(normalized.timeText).toBe("夜");
    expect(normalized.placeText).toBe("全場所");
    expect(normalized.dateMembers[0]?.value).toBe("all_dates");
    expect(normalized.placeMembers[0]?.value).toBe("all_places");
  });
});
