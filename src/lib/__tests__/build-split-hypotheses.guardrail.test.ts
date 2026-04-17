import { describe, expect, it } from "vitest";
import { extractCommentTimeFeatures } from "@/lib/comment-target-extractor";
import { buildDateSequenceInterpretations } from "@/lib/date-sequence";

const aprilRange = { start: "2026-04-01", end: "2026-04-30" } as const;

function buildFromComment(comment: string) {
  const extracted = extractCommentTimeFeatures(comment, { eventDateRange: aprilRange });

  return buildDateSequenceInterpretations({
    originalText: comment,
    normalizedText: extracted.normalizedText,
    extractedTargets: extracted.targets,
  });
}

function findSequenceBySourceText(
  sequences: ReturnType<typeof buildFromComment>["sequences"],
  sourceText: string,
) {
  return sequences.find((sequence) => sequence.sourceText === sourceText);
}

function hasGrouping(
  sequence: NonNullable<ReturnType<typeof findSequenceBySourceText>>,
  expectedGroups: string[][],
) {
  return sequence.groupingHypotheses.some((hypothesis) => {
    return JSON.stringify(hypothesis.groups) === JSON.stringify(expectedGroups);
  });
}

describe("build split hypotheses guardrails", () => {
  it("creates a single sequence for simple japanese comma lists and includes a no-split hypothesis", () => {
    const result = buildFromComment("11、12、13");
    const sequence = findSequenceBySourceText(result.sequences, "11、12、13");

    expect(sequence).toBeDefined();
    expect(sequence?.targets.map((target) => target.text)).toEqual(["11", "12", "13"]);
    expect(hasGrouping(sequence!, [[sequence!.targets[0]!.targetId, sequence!.targets[1]!.targetId, sequence!.targets[2]!.targetId]])).toBe(true);
  });

  it("keeps mixed delimiter lists in one sequence and emits both merged and split hypotheses", () => {
    const result = buildFromComment("11,12、13,14");
    const sequence = findSequenceBySourceText(result.sequences, "11,12、13,14");

    expect(sequence).toBeDefined();
    expect(sequence?.targets.map((target) => target.text)).toEqual(["11", "12", "13", "14"]);
    expect(hasGrouping(sequence!, [[sequence!.targets[0]!.targetId, sequence!.targets[1]!.targetId, sequence!.targets[2]!.targetId, sequence!.targets[3]!.targetId]])).toBe(true);
    expect(hasGrouping(sequence!, [
      [sequence!.targets[0]!.targetId, sequence!.targets[1]!.targetId],
      [sequence!.targets[2]!.targetId, sequence!.targets[3]!.targetId],
    ])).toBe(true);
  });

  it("emits a whitespace-based split hypothesis without losing the merged candidate", () => {
    const result = buildFromComment("12,13 14,15");
    const sequence = findSequenceBySourceText(result.sequences, "12,13 14,15");

    expect(sequence).toBeDefined();
    expect(sequence?.targets.map((target) => target.text)).toEqual(["12", "13", "14", "15"]);
    expect(hasGrouping(sequence!, [[sequence!.targets[0]!.targetId, sequence!.targets[1]!.targetId, sequence!.targets[2]!.targetId, sequence!.targets[3]!.targetId]])).toBe(true);
    expect(hasGrouping(sequence!, [
      [sequence!.targets[0]!.targetId, sequence!.targets[1]!.targetId],
      [sequence!.targets[2]!.targetId, sequence!.targets[3]!.targetId],
    ])).toBe(true);
  });

  it("treats conjunction-based pairs as a sequence without overproducing split hypotheses", () => {
    const andResult = buildFromComment("10と12");
    const andSequence = findSequenceBySourceText(andResult.sequences, "10と12");
    const orResult = buildFromComment("10か12");
    const orSequence = findSequenceBySourceText(orResult.sequences, "10か12");

    expect(andSequence).toBeDefined();
    expect(andSequence?.targets.map((target) => target.text)).toEqual(["10", "12"]);
    expect(andSequence?.groupingHypotheses).toHaveLength(1);
    expect(hasGrouping(andSequence!, [[andSequence!.targets[0]!.targetId, andSequence!.targets[1]!.targetId]])).toBe(true);

    expect(orSequence).toBeDefined();
    expect(orSequence?.targets.map((target) => target.text)).toEqual(["10", "12"]);
    expect(orSequence?.groupingHypotheses).toHaveLength(1);
    expect(hasGrouping(orSequence!, [[orSequence!.targets[0]!.targetId, orSequence!.targets[1]!.targetId]])).toBe(true);
  });

  it("keeps unsupported fully concatenated digits out of sequence generation", () => {
    const result = buildFromComment("11121314");

    expect(result.sequences).toHaveLength(0);
  });

  it("does not drop existing date and time targets when building nearby sequences", () => {
    const result = buildFromComment("平日は無理、5日は午前が無理、あとはいける");

    expect(result.sequences.some((sequence) => sequence.targets.some((target) => target.text === "平日"))).toBe(true);
    expect(result.sequences.some((sequence) => sequence.targets.some((target) => target.text === "5日"))).toBe(true);
    expect(result.sequences.some((sequence) => sequence.targets.some((target) => target.text === "午前"))).toBe(true);
  });

  it("emits both range and isolated-target hypotheses for tilde-based ranges", () => {
    const result = buildFromComment("11~14いけるよ");
    const sequence = findSequenceBySourceText(result.sequences, "11~14");

    expect(sequence).toBeDefined();
    expect(sequence?.targets.map((target) => target.text)).toEqual(["11", "14"]);
    expect(sequence?.groupingHypotheses.some((hypothesis) => hypothesis.kind === "range_group")).toBe(true);
    expect(sequence?.groupingHypotheses.some((hypothesis) => hypothesis.kind === "isolated_targets")).toBe(true);
  });

  it("emits both range and isolated-target hypotheses for japanese wave ranges without deciding availability", () => {
    const result = buildFromComment("11〜14も一応いける");
    const sequence = findSequenceBySourceText(result.sequences, "11〜14");

    expect(sequence).toBeDefined();
    expect(sequence?.targets.map((target) => target.text)).toEqual(["11", "14"]);
    expect(sequence?.groupingHypotheses.some((hypothesis) => hypothesis.kind === "range_group")).toBe(true);
    expect(sequence?.groupingHypotheses.some((hypothesis) => hypothesis.kind === "isolated_targets")).toBe(true);
  });
});
