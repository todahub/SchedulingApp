import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAvailabilityInterpretationExecutionInput } from "@/lib/availability-comment-interpretation";
import type { EventCandidateRecord } from "@/lib/domain";

const OUTPUT_PATH = "/tmp/comparison-target-grouping.json";

function buildAprilCandidates(days: number[]): EventCandidateRecord[] {
  return days.map((day, index) => ({
    id: `candidate-${day}`,
    eventId: "event-april",
    date: `2026-04-${String(day).padStart(2, "0")}`,
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: `2026-04-${String(day).padStart(2, "0")}`,
    endDate: `2026-04-${String(day).padStart(2, "0")}`,
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: index + 1,
  }));
}

function summarizeTargetGroup(tokenIndexes: number[], tokens: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>["tokens"]) {
  return tokenIndexes.map((tokenIndex) => tokens[tokenIndex]!.text);
}

function buildObservation(input: string, candidates = buildAprilCandidates([10, 11, 12, 13])) {
  const executionInput = buildAvailabilityInterpretationExecutionInput(input, candidates);

  return {
    input,
    labeledTokens: executionInput.tokens.map((token) => ({
      index: token.index,
      text: token.text,
      label: token.label,
      normalizedText: token.normalizedText,
    })),
    targets: executionInput.grouping.targetGroups.map((group) => ({
      id: group.id,
      texts: summarizeTargetGroup(group.tokenIndexes, executionInput.tokens),
      labels: group.tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!.label),
    })),
    groupingHypotheses: executionInput.groupingHypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      kind: hypothesis.kind,
      note: hypothesis.note,
      targetGroups: hypothesis.grouping.targetGroups.map((group) => ({
        id: group.id,
        texts: summarizeTargetGroup(group.tokenIndexes, executionInput.tokens),
      })),
    })),
  };
}

function hasTargetGroup(observation: ReturnType<typeof buildObservation>, expectedTexts: string[]) {
  return observation.targets.some((group) => JSON.stringify(group.texts) === JSON.stringify(expectedTexts));
}

function hasHypothesisGroup(observation: ReturnType<typeof buildObservation>, expectedTexts: string[]) {
  return observation.groupingHypotheses.some((hypothesis) =>
    hypothesis.targetGroups.some((group) => JSON.stringify(group.texts) === JSON.stringify(expectedTexts)),
  );
}

describe("comparison target grouping guardrails", () => {
  const observations = [
    buildObservation("10と11なら11がいい"),
    buildObservation("10か11なら11がいい"),
    buildObservation("10,11なら11"),
    buildObservation("10 or 11 なら 11"),
    buildObservation("10より11の方がいい"),
    buildObservation("10日夜と11日夜なら11日夜がいい"),
    buildObservation("10日の午前より11日の午後の方がいい"),
    buildObservation("金土なら土の方がいい"),
    buildObservation("平日は無理、土の方がいい"),
    buildObservation("10と11はいける"),
    buildObservation("11がいい"),
    buildObservation("11なら嬉しい"),
    buildObservation("11ならいける"),
  ];

  it("writes a visibility snapshot for comparison/preference target materials", () => {
    writeFileSync(OUTPUT_PATH, JSON.stringify(observations, null, 2), "utf8");
    console.log(`[comparison-target-grouping] wrote ${observations.length} cases to ${OUTPUT_PATH}`);
    expect(observations).toHaveLength(13);
  });

  it("keeps discrete candidate sets and selected targets for date-only comparisons", () => {
    const commaCase = observations.find((entry) => entry.input === "10,11なら11");
    const englishOrCase = observations.find((entry) => entry.input === "10 or 11 なら 11");
    const plainSetCase = observations.find((entry) => entry.input === "10と11はいける");

    expect(commaCase?.targets.map((group) => group.texts)).toEqual(expect.arrayContaining([["10"], ["11"], ["11"]]));
    expect(hasHypothesisGroup(commaCase!, ["10", "11"])).toBe(true);

    expect(englishOrCase?.targets.map((group) => group.texts)).toEqual(expect.arrayContaining([["10"], ["11"], ["11"]]));
    expect(hasHypothesisGroup(englishOrCase!, ["10", "11"])).toBe(true);

    expect(plainSetCase?.targets.map((group) => group.texts)).toEqual(expect.arrayContaining([["10"], ["11"]]));
    expect(hasHypothesisGroup(plainSetCase!, ["10", "11"])).toBe(true);
  });

  it("keeps date + time_of_day as one comparison unit when the phrase is contiguous or linked", () => {
    const contiguous = observations.find((entry) => entry.input === "10日夜と11日夜なら11日夜がいい");
    const linked = observations.find((entry) => entry.input === "10日の午前より11日の午後の方がいい");

    expect(hasTargetGroup(contiguous!, ["10日", "夜"])).toBe(true);
    expect(hasTargetGroup(contiguous!, ["11日", "夜"])).toBe(true);
    expect(contiguous?.targets.filter((group) => JSON.stringify(group.texts) === JSON.stringify(["11日", "夜"]))).toHaveLength(2);
    expect(hasHypothesisGroup(contiguous!, ["10日", "夜", "11日", "夜"])).toBe(true);

    expect(hasTargetGroup(linked!, ["10日", "午前"])).toBe(true);
    expect(hasTargetGroup(linked!, ["11日", "午後"])).toBe(true);
  });

  it("keeps weekday pairs and bare weekdays as separate comparison materials", () => {
    const pairCase = observations.find((entry) => entry.input === "金土なら土の方がいい");
    const residualCase = observations.find((entry) => entry.input === "平日は無理、土の方がいい");

    expect(hasTargetGroup(pairCase!, ["金土"])).toBe(true);
    expect(hasTargetGroup(pairCase!, ["土"])).toBe(true);

    expect(hasTargetGroup(residualCase!, ["平日"])).toBe(true);
    expect(hasTargetGroup(residualCase!, ["土"])).toBe(true);
  });

  it("preserves single-target materials for plain preference and conditional cases", () => {
    const preferred = observations.find((entry) => entry.input === "11がいい");
    const happy = observations.find((entry) => entry.input === "11なら嬉しい");
    const available = observations.find((entry) => entry.input === "11ならいける");

    expect(preferred?.targets.map((group) => group.texts)).toEqual([["11"]]);
    expect(happy?.targets.map((group) => group.texts)).toEqual([["11"]]);
    expect(available?.targets.map((group) => group.texts)).toEqual([["11"]]);
  });
});
