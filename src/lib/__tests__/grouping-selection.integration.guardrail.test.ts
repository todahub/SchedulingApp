import { describe, expect, it, vi } from "vitest";
import { normalizeCommentText } from "@/lib/comment-normalizer/normalize-comment-text";
import { extractCommentTimeFeatures } from "@/lib/comment-target-extractor";
import { buildDateSequenceInterpretations, selectGroupingHypothesisWithLlm } from "@/lib/date-sequence";

const aprilRange = { start: "2026-04-01", end: "2026-04-30" } as const;

function buildPipelineInput(comment: string) {
  const normalized = normalizeCommentText(comment);
  const extracted = extractCommentTimeFeatures(normalized.normalizedText, { eventDateRange: aprilRange });

  return {
    normalized,
    extracted,
    interpretations: buildDateSequenceInterpretations({
      originalText: normalized.originalText,
      normalizedText: normalized.normalizedText,
      extractedTargets: extracted.targets,
    }),
  };
}

describe("grouping selection integration guardrails", () => {
  it("normalizes, extracts, builds hypotheses, and adopts the split hypothesis for a mixed-delimiter list", async () => {
    const built = buildPipelineInput("行ける日は11,12、13,14だけ");
    const sequence = built.interpretations.sequences.find((candidate) => candidate.sourceText === "11,12、13,14");
    const splitHypothesis = sequence?.groupingHypotheses.find((hypothesis) => hypothesis.kind === "split_groups");

    expect(built.normalized.normalizedText).toBe("行ける日は11,12、13,14だけ");
    expect(sequence).toBeDefined();
    expect(sequence?.targets.map((target) => target.text)).toEqual(["11", "12", "13", "14"]);
    expect(splitHypothesis).toBeDefined();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            selectedHypothesisId: splitHypothesis?.hypothesisId ?? null,
            decision: "selected",
            reasonCodes: ["delimiter_pattern_change"],
          }),
        },
      }),
    });

    const result = await selectGroupingHypothesisWithLlm(sequence!, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.error).toBeNull();
    expect(result.selectedHypothesis?.hypothesisId).toBe(splitHypothesis?.hypothesisId);
    expect(result.output.decision).toBe("selected");
  });

  it("keeps range hypotheses and can adopt range_group through the thin pipeline", async () => {
    const built = buildPipelineInput("11~14いけるよ");
    const sequence = built.interpretations.sequences.find((candidate) => candidate.sourceText === "11~14");
    const rangeHypothesis = sequence?.groupingHypotheses.find((hypothesis) => hypothesis.kind === "range_group");

    expect(sequence).toBeDefined();
    expect(sequence?.groupingHypotheses.some((hypothesis) => hypothesis.kind === "isolated_targets")).toBe(true);
    expect(rangeHypothesis).toBeDefined();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            selectedHypothesisId: rangeHypothesis?.hypothesisId ?? null,
            decision: "selected",
            reasonCodes: ["range_connector_adopted"],
          }),
        },
      }),
    });

    const result = await selectGroupingHypothesisWithLlm(sequence!, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.error).toBeNull();
    expect(result.selectedHypothesis?.kind).toBe("range_group");
  });

  it("allows undetermined when the thin pipeline still has insufficient context", async () => {
    const built = buildPipelineInput("11〜14いけるよ~");
    const sequence = built.interpretations.sequences.find((candidate) => candidate.sourceText === "11〜14");

    expect(sequence).toBeDefined();
    expect(sequence?.groupingHypotheses.some((hypothesis) => hypothesis.kind === "range_group")).toBe(true);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            selectedHypothesisId: null,
            decision: "undetermined",
            reasonCodes: ["insufficient_context"],
          }),
        },
      }),
    });

    const result = await selectGroupingHypothesisWithLlm(sequence!, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.error).toBeNull();
    expect(result.selectedHypothesis).toBeNull();
    expect(result.output.decision).toBe("undetermined");
  });

  it("falls back safely when the llm response is broken even if earlier pipeline stages succeeded", async () => {
    const built = buildPipelineInput("行ける日は11,12、13,14だけ");
    const sequence = built.interpretations.sequences.find((candidate) => candidate.sourceText === "11,12、13,14");

    expect(sequence).toBeDefined();
    expect(sequence?.groupingHypotheses.length).toBeGreaterThan(1);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: "I think h1 is probably right.",
        },
      }),
    });

    const result = await selectGroupingHypothesisWithLlm(sequence!, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.selectedHypothesis).toBeNull();
    expect(result.output.decision).toBe("undetermined");
    expect(result.error?.stage).toBe("parse");
  });
});
