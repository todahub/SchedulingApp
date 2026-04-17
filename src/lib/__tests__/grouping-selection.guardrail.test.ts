import { describe, expect, it, vi } from "vitest";
import { extractCommentTimeFeatures } from "@/lib/comment-target-extractor";
import {
  buildDateSequenceInterpretations,
  GroupingSelectionParseError,
  GroupingSelectionValidationError,
  parseGroupingSelectionResponse,
  selectGroupingHypothesisWithLlm,
  toLlmGroupingSelectionInput,
  validateGroupingSelectionOutput,
} from "@/lib/date-sequence";

const aprilRange = { start: "2026-04-01", end: "2026-04-30" } as const;

function buildSequence(comment: string, sourceText?: string) {
  const extracted = extractCommentTimeFeatures(comment, { eventDateRange: aprilRange });
  const result = buildDateSequenceInterpretations({
    originalText: comment,
    normalizedText: extracted.normalizedText,
    extractedTargets: extracted.targets,
  });

  if (typeof sourceText === "string") {
    const matched = result.sequences.find((sequence) => sequence.sourceText === sourceText);

    if (!matched) {
      throw new Error(`Expected to find sequence for sourceText: ${sourceText}`);
    }

    return matched;
  }

  if (!result.sequences[0]) {
    throw new Error(`Expected at least one sequence for comment: ${comment}`);
  }

  return result.sequences[0];
}

describe("grouping hypothesis selection guardrails", () => {
  it("selects one hypothesis from the provided candidates only", async () => {
    const sequence = buildSequence("11,12、13,14はいける", "11,12、13,14");
    const splitHypothesis = sequence.groupingHypotheses.find((hypothesis) => hypothesis.kind === "split_groups");

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

    const result = await selectGroupingHypothesisWithLlm(sequence, {
      fetchImpl: fetchMock as typeof fetch,
      baseUrl: "http://127.0.0.1:11434/api",
      model: "mock-model",
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({
      selectedHypothesisId: splitHypothesis?.hypothesisId ?? null,
      decision: "selected",
      reasonCodes: ["delimiter_pattern_change"],
    });
    expect(result.selectedHypothesis?.hypothesisId).toBe(splitHypothesis?.hypothesisId);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.model).toBe("mock-model");
    expect(body.stream).toBe(false);
    expect(body.messages[1]?.content).toContain('"originalText": "11,12、13,14はいける"');
    expect(body.messages[1]?.content).toContain('"sourceText": "11,12、13,14"');
    expect(body.messages[1]?.content).toContain('"hypothesisId"');
  });

  it("can select either range_group or isolated_targets without inventing new grouping", async () => {
    const sequence = buildSequence("行ける日は11~14もいけるよ", "11~14");
    const rangeHypothesis = sequence.groupingHypotheses.find((hypothesis) => hypothesis.kind === "range_group");

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

    const result = await selectGroupingHypothesisWithLlm(sequence, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.error).toBeNull();
    expect(result.selectedHypothesis?.kind).toBe("range_group");
    expect(result.output.reasonCodes).toEqual(["range_connector_adopted"]);
  });

  it("allows undetermined when the context is still ambiguous", async () => {
    const sequence = buildSequence("11〜14いけるよ~", "11〜14");
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

    const result = await selectGroupingHypothesisWithLlm(sequence, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.error).toBeNull();
    expect(result.selectedHypothesis).toBeNull();
    expect(result.output).toEqual({
      selectedHypothesisId: null,
      decision: "undetermined",
      reasonCodes: ["insufficient_context"],
    });
  });

  it("rejects hypothesis ids that are not present in the provided candidates", () => {
    const sequence = buildSequence("11,12、13,14はいける", "11,12、13,14");
    const input = toLlmGroupingSelectionInput(sequence);

    expect(() =>
      validateGroupingSelectionOutput(
        {
          selectedHypothesisId: "h999",
          decision: "selected",
          reasonCodes: ["delimiter_pattern_change"],
        },
        sequence.groupingHypotheses,
      ),
    ).toThrowError(GroupingSelectionValidationError);

    expect(input.sequence.groupingHypotheses).toHaveLength(sequence.groupingHypotheses.length);
  });

  it("fails parsing when the llm returns non-json free text and falls back safely", async () => {
    expect(() => parseGroupingSelectionResponse("I think h1 is more natural.")).toThrowError(GroupingSelectionParseError);

    const sequence = buildSequence("11,12、13,14はいける", "11,12、13,14");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: "I think h1 is more natural.",
        },
      }),
    });

    const result = await selectGroupingHypothesisWithLlm(sequence, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.selectedHypothesis).toBeNull();
    expect(result.output.decision).toBe("undetermined");
    expect(result.error?.stage).toBe("parse");
  });

  it("rejects outputs that try to smuggle in grouping data outside the schema", () => {
    const sequence = buildSequence("11~14いけるよ", "11~14");

    expect(() =>
      validateGroupingSelectionOutput(
        {
          selectedHypothesisId: sequence.groupingHypotheses[0]?.hypothesisId ?? null,
          decision: "selected",
          reasonCodes: ["range_connector_adopted"],
          groups: [["made-up"]],
        },
        sequence.groupingHypotheses,
      ),
    ).toThrowError(GroupingSelectionValidationError);
  });
});
