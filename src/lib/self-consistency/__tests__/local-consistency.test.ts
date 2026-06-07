import { describe, expect, it } from "vitest";
import { buildReviewSchedule } from "@/lib/self-consistency/local-consistency";
import type { ReviewTask } from "@/lib/self-consistency/types";

function makeTask(id: string, kind: ReviewTask["kind"]): ReviewTask {
  if (kind === "comparison") {
    return {
      id,
      kind,
      note: "11と12なら12かな",
      focusText: "11と12なら12かな",
      candidateSetText: "11と12",
      preferredTargetText: "12",
      base: {
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
    };
  }

  if (kind === "condition") {
    return {
      id,
      kind,
      note: "18日は夜なら行ける",
      focusText: "18日は夜なら行ける",
      targetText: "18日",
      conditionText: "夜なら",
      base: {
        targetText: "18日",
        targetType: "単日日付",
        memberTexts: ["18日", "夜"],
        timeText: "夜",
        timeRole: "条件",
        availability: "条件付きで行ける",
        conditionText: "夜なら",
        evidenceText: "18日は夜なら行ける",
      },
    };
  }

  return {
    id,
    kind,
    note: "11日はたぶん行ける",
    focusText: "11日はたぶん行ける",
    targetText: "11日",
    conditionText: null,
    base: {
      targetText: "11日",
      targetType: "単日日付",
      memberTexts: ["11日"],
      timeText: null,
      timeRole: "指定なし",
      availability: "行ける",
      preference: null,
      conditionText: null,
      evidenceText: "11日はたぶん行ける",
    },
  };
}

describe("buildReviewSchedule", () => {
  it("caps total additional calls to the provided budget", () => {
    const schedule = buildReviewSchedule(
      [makeTask("evaluation:0", "evaluation"), makeTask("comparison:0", "comparison"), makeTask("condition:0", "condition")],
      3,
    );

    expect(schedule).toHaveLength(3);
    expect(schedule.map((item) => item.task.id)).toEqual(["comparison:0", "condition:0", "evaluation:0"]);
    expect(schedule.map((item) => item.attempt)).toEqual([1, 1, 1]);
  });

  it("reuses the same task when only one risky task exists", () => {
    const schedule = buildReviewSchedule([makeTask("comparison:0", "comparison")], 3);

    expect(schedule).toHaveLength(3);
    expect(schedule.map((item) => item.task.id)).toEqual(["comparison:0", "comparison:0", "comparison:0"]);
    expect(schedule.map((item) => item.attempt)).toEqual([1, 2, 3]);
  });
});
