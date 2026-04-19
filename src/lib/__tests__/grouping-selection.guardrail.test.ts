import { describe, expect, it, vi } from "vitest";
import type { DateSequenceInterpretation } from "@/lib/date-sequence";
import {
  buildGroupingSelectionMessages,
  GroupingSelectionParseError,
  GroupingSelectionValidationError,
  parseGroupingSelectionResponse,
  selectGroupingHypothesisWithLlm,
  toLlmGroupingSelectionInput,
  validateGroupingSelectionOutput,
} from "@/lib/date-sequence";

function buildMixedDelimiterSequence(): DateSequenceInterpretation {
  return {
    sequenceId: "seq-1",
    sourceText: "11,12、13,14",
    span: { start: 5, end: 15 },
    connectors: [
      { text: ",", start: 7, end: 8, type: "comma" },
      { text: "、", start: 10, end: 11, type: "jp_comma" },
      { text: ",", start: 13, end: 14, type: "comma" },
    ],
    targets: [
      {
        targetId: "t1",
        text: "11",
        normalizedValue: "2026-04-11",
        start: 5,
        end: 7,
        sourceTargetKind: "date",
        sourceTargetIndex: 0,
        derivedFromRange: false,
      },
      {
        targetId: "t2",
        text: "12",
        normalizedValue: "2026-04-12",
        start: 8,
        end: 10,
        sourceTargetKind: "date",
        sourceTargetIndex: 1,
        derivedFromRange: false,
      },
      {
        targetId: "t3",
        text: "13",
        normalizedValue: "2026-04-13",
        start: 11,
        end: 13,
        sourceTargetKind: "date",
        sourceTargetIndex: 2,
        derivedFromRange: false,
      },
      {
        targetId: "t4",
        text: "14",
        normalizedValue: "2026-04-14",
        start: 14,
        end: 16,
        sourceTargetKind: "date",
        sourceTargetIndex: 3,
        derivedFromRange: false,
      },
    ],
    context: {
      originalText: "行ける日は11,12、13,14はいける",
      normalizedText: "行ける日は11,12、13,14はいける",
      beforeText: "行ける日は",
      afterText: "はいける",
    },
    groupingHypotheses: [
      {
        hypothesisId: "h1",
        kind: "single_group",
        groups: [["t1", "t2", "t3", "t4"]],
        evidence: ["single_adjacent_sequence"],
      },
      {
        hypothesisId: "h2",
        kind: "split_groups",
        groups: [["t1", "t2"], ["t3", "t4"]],
        evidence: ["delimiter_pattern_change"],
        connectorPolicy: {
          splitConnectorText: "、",
          splitConnectorType: "jp_comma",
          splitInterpretation: "split",
        },
      },
    ],
  };
}

function buildRangeSequence(originalText: string, sourceText: string): DateSequenceInterpretation {
  return {
    sequenceId: "seq-tilde",
    sourceText,
    span: { start: 0, end: sourceText.length },
    connectors: [{ text: sourceText.includes("〜") ? "〜" : "~", start: 2, end: 3, type: "range" }],
    targets: [
      {
        targetId: "t1",
        text: "11",
        normalizedValue: "2026-04-11",
        start: 0,
        end: 2,
        sourceTargetKind: "date_range",
        sourceTargetIndex: 0,
        derivedFromRange: true,
        metadata: {
          rangeConnectorText: sourceText.includes("〜") ? "〜" : "~",
          rangeEndpointPosition: "start",
        },
      },
      {
        targetId: "t2",
        text: "14",
        normalizedValue: "2026-04-14",
        start: 3,
        end: 5,
        sourceTargetKind: "date_range",
        sourceTargetIndex: 0,
        derivedFromRange: true,
        metadata: {
          rangeConnectorText: sourceText.includes("〜") ? "〜" : "~",
          rangeEndpointPosition: "end",
        },
      },
    ],
    context: {
      originalText,
      normalizedText: originalText,
      beforeText: "",
      afterText: originalText.slice(sourceText.length),
    },
    groupingHypotheses: [
      {
        hypothesisId: "h1",
        kind: "range_group",
        groups: [["t1", "t2"]],
        evidence: ["single_adjacent_sequence", "tilde_between_date_targets"],
        connectorPolicy: {
          rangeConnector: sourceText.includes("〜") ? "〜" : "~",
          rangeInterpretation: "range",
        },
      },
      {
        hypothesisId: "h2",
        kind: "isolated_targets",
        groups: [["t1"], ["t2"]],
        evidence: ["connector_is_ambiguous"],
        connectorPolicy: {
          rangeConnector: sourceText.includes("〜") ? "〜" : "~",
          rangeInterpretation: "ignored",
        },
      },
    ],
  };
}

describe("grouping hypothesis selection guardrails", () => {
  describe("normal selections", () => {
    it("uses originalText / normalizedText / hypotheses as the unit input and accepts a valid selected hypothesis", async () => {
      const sequence = buildMixedDelimiterSequence();
      const input = toLlmGroupingSelectionInput(sequence);
      const messages = buildGroupingSelectionMessages(input);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              selectedHypothesisId: "h2",
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

      expect(input.originalText).toBe("行ける日は11,12、13,14はいける");
      expect(input.sequence.sourceText).toBe("11,12、13,14");
      expect(input.sequence.groupingHypotheses.map((hypothesis) => hypothesis.hypothesisId)).toEqual(["h1", "h2"]);
      expect(messages.userPrompt).toContain('"originalText": "行ける日は11,12、13,14はいける"');
      expect(messages.userPrompt).toContain('"beforeText": "行ける日は"');
      expect(messages.userPrompt).toContain('"afterText": "はいける"');
      expect(result.error).toBeNull();
      expect(result.output).toEqual({
        selectedHypothesisId: "h2",
        decision: "selected",
        reasonCodes: ["delimiter_pattern_change"],
      });
      expect(result.selectedHypothesis?.hypothesisId).toBe("h2");
    });

    it("can select either range_group or isolated_targets only from the provided hypotheses", async () => {
      const sequence = buildRangeSequence("行ける日は11~14もいけるよ", "11~14");
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              selectedHypothesisId: "h1",
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
  });

  describe("undetermined handling", () => {
    it("accepts undetermined when context is insufficient", async () => {
      const sequence = buildRangeSequence("11〜14いけるよ~", "11〜14");
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
  });

  describe("invalid outputs from ollama", () => {
    it("rejects hypothesis ids that are not present in the provided candidates", () => {
      const sequence = buildMixedDelimiterSequence();

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
    });

    it("rejects invalid reason codes", () => {
      const sequence = buildMixedDelimiterSequence();

      expect(() =>
        validateGroupingSelectionOutput(
          {
            selectedHypothesisId: "h1",
            decision: "selected",
            reasonCodes: ["totally_new_reason"],
          },
          sequence.groupingHypotheses,
        ),
      ).toThrowError(GroupingSelectionValidationError);
    });

    it("rejects undetermined outputs that still include a hypothesis id", () => {
      const sequence = buildMixedDelimiterSequence();

      expect(() =>
        validateGroupingSelectionOutput(
          {
            selectedHypothesisId: "h1",
            decision: "undetermined",
            reasonCodes: ["insufficient_context"],
          },
          sequence.groupingHypotheses,
        ),
      ).toThrowError(GroupingSelectionValidationError);
    });

    it("rejects selected outputs with a null hypothesis id", () => {
      const sequence = buildMixedDelimiterSequence();

      expect(() =>
        validateGroupingSelectionOutput(
          {
            selectedHypothesisId: null,
            decision: "selected",
            reasonCodes: ["delimiter_pattern_change"],
          },
          sequence.groupingHypotheses,
        ),
      ).toThrowError(GroupingSelectionValidationError);
    });

    it("rejects outputs that try to smuggle grouping data outside the schema", () => {
      const sequence = buildRangeSequence("11~14いけるよ", "11~14");

      expect(() =>
        validateGroupingSelectionOutput(
          {
            selectedHypothesisId: "h1",
            decision: "selected",
            reasonCodes: ["range_connector_adopted"],
            groups: [["made-up"]],
          },
          sequence.groupingHypotheses,
        ),
      ).toThrowError(GroupingSelectionValidationError);
    });

    it("fails parsing when ollama returns free text instead of json", async () => {
      const sequence = buildMixedDelimiterSequence();

      expect(() => parseGroupingSelectionResponse("I think h1 is more natural.")).toThrowError(GroupingSelectionParseError);

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

    it("fails parsing when ollama mixes explanation text around json", async () => {
      const sequence = buildMixedDelimiterSequence();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content:
              'selected this because it looks natural\n{"selectedHypothesisId":"h1","decision":"selected","reasonCodes":["single_adjacent_sequence"]}',
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

    it("fails parsing when ollama wraps the json in a code fence", async () => {
      const sequence = buildMixedDelimiterSequence();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content:
              '```json\n{"selectedHypothesisId":"h1","decision":"selected","reasonCodes":["single_adjacent_sequence"]}\n```',
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
  });
});
