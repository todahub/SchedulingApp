import { describe, expect, it } from "vitest";
import { labelCommentText } from "@/lib/comment-labeler";
import {
  COMMENT_LABEL_COMPLETION_ALLOWED_LABELS,
  COMMENT_LABEL_COMPLETION_RULES,
  COMMENT_LABEL_MEANING_GUIDE,
  buildCommentLabelCompletionMessages,
  parseCommentLabelCompletionResponse,
  toCommentLabelCompletionInput,
  validateCommentLabelCompletionOutput,
} from "@/lib/comment-labeler/llm-label-completion";

function makeInput() {
  return toCommentLabelCompletionInput({
    originalText: "たぶんバイトだから行けぬ",
    normalizedText: "たぶんバイトだから行けぬ",
    labeledTokens: [
      {
        text: "たぶん",
        label: "uncertainty_marker",
        start: 0,
        end: 2,
        source: "rule",
      },
    ],
    unlabeledSegments: [
      {
        segmentId: "seg-1",
        text: "バイトだから",
        start: 3,
        end: 8,
        beforeText: "たぶん",
        afterText: "行けぬ",
      },
      {
        segmentId: "seg-2",
        text: "行けぬ",
        start: 8,
        end: 11,
        beforeText: "たぶんバイトだから",
        afterText: "",
      },
    ],
  });
}

describe("comment label completion guardrails", () => {
  it("keeps reason_marker as an LLM-only label and does not emit it from the dictionary", () => {
    const labeled = labelCommentText("バイトだから", { eventDateRange: { start: "2026-04-01", end: "2026-04-30" } });
    expect(labeled.tokens.some((token) => token.label === "reason_marker")).toBe(false);
  });

  it("exposes only the allowed labels and excludes legacy markers", () => {
    expect(COMMENT_LABEL_COMPLETION_ALLOWED_LABELS).toContain("reason_marker");
    expect(COMMENT_LABEL_COMPLETION_ALLOWED_LABELS).not.toContain("desire_marker");
    expect(COMMENT_LABEL_COMPLETION_ALLOWED_LABELS).not.toContain("emphasis_marker");
  });

  it("builds prompts that force JSON-only completion and keep reason as last resort", () => {
    const input = makeInput();
    const { system, user } = buildCommentLabelCompletionMessages(input);

    expect(system).toContain("出力は JSON のみです");
    expect(system).toContain("reason_marker は最後の手段です");
    expect(system).toContain("reason_marker は「既存ラベルで説明できないものを全部入れる箱」ではありません。");
    expect(system).toContain("条件・比較・不確実性・選好・可否を reason_marker にしてはいけません。");
    expect(system).toContain("availability_positive");
    expect(system).toContain("comparison_marker");
    expect(system).toContain("reason_marker");
    expect(user).toContain('"segmentId": "seg-1"');
    expect(user).toContain('"text": "バイトだから"');
    expect(user).toContain('"label": "uncertainty_marker"');
    expect(user).toContain(COMMENT_LABEL_COMPLETION_RULES[0]!);
  });

  it("documents strict reason_marker semantics", () => {
    expect(COMMENT_LABEL_MEANING_GUIDE.reason_marker.useWhen).toContain("事情");
    expect(COMMENT_LABEL_MEANING_GUIDE.reason_marker.doNotUseWhen).toContain("条件");
    expect(COMMENT_LABEL_MEANING_GUIDE.reason_marker.llmOnly).toBe(true);
  });

  it("parses and validates a valid completion payload", () => {
    const input = makeInput();
    const parsed = parseCommentLabelCompletionResponse(
      JSON.stringify({
        segments: [
          {
            segmentId: "seg-1",
            text: "バイトだから",
            labels: ["reason_marker"],
          },
          {
            segmentId: "seg-2",
            text: "行けぬ",
            labels: ["availability_negative"],
          },
        ],
      }),
    );

    expect(validateCommentLabelCompletionOutput(parsed, input)).toEqual({
      segments: [
        {
          segmentId: "seg-1",
          text: "バイトだから",
          labels: ["reason_marker"],
        },
        {
          segmentId: "seg-2",
          text: "行けぬ",
          labels: ["availability_negative"],
        },
      ],
    });
  });

  it("allows none when a segment cannot be labeled safely", () => {
    const input = makeInput();
    const parsed = parseCommentLabelCompletionResponse(
      JSON.stringify({
        segments: [
          {
            segmentId: "seg-1",
            text: "バイトだから",
            labels: ["none"],
          },
          {
            segmentId: "seg-2",
            text: "行けぬ",
            labels: ["none"],
          },
        ],
      }),
    );

    expect(validateCommentLabelCompletionOutput(parsed, input)).toEqual({
      segments: [
        {
          segmentId: "seg-1",
          text: "バイトだから",
          labels: ["none"],
        },
        {
          segmentId: "seg-2",
          text: "行けぬ",
          labels: ["none"],
        },
      ],
    });
  });

  it("rejects invalid JSON or free-form output", () => {
    expect(() => parseCommentLabelCompletionResponse("この断片は reason です")).toThrow(
      "LLM response was not valid JSON.",
    );
    expect(() => parseCommentLabelCompletionResponse("```json\n{}\n```")).toThrow(
      "LLM response was not valid JSON.",
    );
  });

  it("rejects unsupported labels and legacy labels", () => {
    const input = makeInput();
    const parsed = parseCommentLabelCompletionResponse(
      JSON.stringify({
        segments: [
          {
            segmentId: "seg-1",
            text: "バイトだから",
            labels: ["reason_marker"],
          },
          {
            segmentId: "seg-2",
            text: "行けぬ",
            labels: ["desire_marker"],
          },
        ],
      }),
    );

    expect(() => validateCommentLabelCompletionOutput(parsed, input)).toThrow(
      "labels contains unsupported values.",
    );
  });

  it("rejects reason_marker when combined with another semantic label", () => {
    const input = makeInput();
    const parsed = parseCommentLabelCompletionResponse(
      JSON.stringify({
        segments: [
          {
            segmentId: "seg-1",
            text: "バイトだから",
            labels: ["reason_marker", "conditional_marker"],
          },
          {
            segmentId: "seg-2",
            text: "行けぬ",
            labels: ["availability_negative"],
          },
        ],
      }),
    );

    expect(() => validateCommentLabelCompletionOutput(parsed, input)).toThrow(
      "reason_marker must not be combined with other labels.",
    );
  });

  it("rejects unknown segment ids and text mismatches", () => {
    const input = makeInput();
    const parsedUnknownId = parseCommentLabelCompletionResponse(
      JSON.stringify({
        segments: [
          {
            segmentId: "seg-999",
            text: "バイトだから",
            labels: ["reason_marker"],
          },
          {
            segmentId: "seg-2",
            text: "行けぬ",
            labels: ["availability_negative"],
          },
        ],
      }),
    );

    expect(() => validateCommentLabelCompletionOutput(parsedUnknownId, input)).toThrow(
      "segmentId does not exist in input.",
    );

    const parsedTextMismatch = parseCommentLabelCompletionResponse(
      JSON.stringify({
        segments: [
          {
            segmentId: "seg-1",
            text: "バイトで",
            labels: ["reason_marker"],
          },
          {
            segmentId: "seg-2",
            text: "行けぬ",
            labels: ["availability_negative"],
          },
        ],
      }),
    );

    expect(() => validateCommentLabelCompletionOutput(parsedTextMismatch, input)).toThrow(
      "segment text must exactly match the input segment text.",
    );
  });

  it("rejects partial output that does not cover all segments", () => {
    const input = makeInput();
    const parsed = parseCommentLabelCompletionResponse(
      JSON.stringify({
        segments: [
          {
            segmentId: "seg-1",
            text: "バイトだから",
            labels: ["reason_marker"],
          },
        ],
      }),
    );

    expect(() => validateCommentLabelCompletionOutput(parsed, input)).toThrow(
      "Output must cover every input segment exactly once.",
    );
  });
});
