import { describe, expect, it } from "vitest";
import { labelCommentText } from "@/lib/comment-labeler";
import {
  callOllamaForLabelCompletion,
  completeLabelsWithLlm,
  completeLabeledCommentWithLlm,
  extractUnlabeledSegments,
  labelCommentTextWithLlm,
  toCommentLabelCompletionInput,
} from "@/lib/comment-labeler/llm-label-completion";

const aprilRange = { start: "2026-04-01", end: "2026-04-30" } as const;

function createMockFetchWithContent(content: string, options?: { ok?: boolean; status?: number; error?: string }) {
  return async (url: string, init?: RequestInit) => {
    expect(url).toContain("/chat");
    expect(init?.method).toBe("POST");
    expect(typeof init?.body).toBe("string");

    return {
      ok: options?.ok ?? true,
      status: options?.status ?? 200,
      json: async () => ({
        ...(options?.error ? { error: options.error } : {}),
        message: {
          content,
        },
      }),
    } as Response;
  };
}

function buildJsonForAllSegments(
  segments: Array<{ segmentId: string; text: string }>,
  labelsFor: (segment: { segmentId: string; text: string }) => string[],
) {
  return JSON.stringify({
    segments: segments.map((segment) => ({
      segmentId: segment.segmentId,
      text: segment.text,
      labels: labelsFor(segment),
    })),
  });
}

describe("comment label completion runtime guardrails", () => {
  it("adopts valid JSON from the Ollama wrapper", async () => {
    const labeled = labelCommentText("バイトだから無理", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(labeled);
    const input = toCommentLabelCompletionInput({
      originalText: labeled.originalText,
      normalizedText: labeled.normalizedText,
      labeledTokens: labeled.tokens,
      unlabeledSegments: segments,
    });

    const result = await completeLabelsWithLlm(input, {
      fetchImpl: createMockFetchWithContent(
        buildJsonForAllSegments(segments, (segment) => (segment.text === "バイトだから" ? ["reason_marker"] : ["none"])),
      ),
    });

    expect(result.error).toBeNull();
    expect(result.output?.segments).toEqual([
      {
        segmentId: segments[0]!.segmentId,
        text: "バイトだから",
        labels: ["reason_marker"],
      },
    ]);
  });

  it("rejects code fence output safely", async () => {
    const labeled = labelCommentText("仕事で", { eventDateRange: aprilRange });
    const input = toCommentLabelCompletionInput({
      originalText: labeled.originalText,
      normalizedText: labeled.normalizedText,
      labeledTokens: labeled.tokens,
      unlabeledSegments: extractUnlabeledSegments(labeled),
    });

    const result = await completeLabelsWithLlm(input, {
      fetchImpl: createMockFetchWithContent("```json\n{}\n```"),
    });

    expect(result.output).toBeNull();
    expect(result.error).toMatchObject({
      stage: "parse",
      message: "LLM response was not valid JSON.",
    });
  });

  it("rejects free-form output safely", async () => {
    const labeled = labelCommentText("仕事で", { eventDateRange: aprilRange });
    const input = toCommentLabelCompletionInput({
      originalText: labeled.originalText,
      normalizedText: labeled.normalizedText,
      labeledTokens: labeled.tokens,
      unlabeledSegments: extractUnlabeledSegments(labeled),
    });

    const result = await completeLabelsWithLlm(input, {
      fetchImpl: createMockFetchWithContent("これは reason です"),
    });

    expect(result.output).toBeNull();
    expect(result.error?.stage).toBe("parse");
  });

  it("rejects unsupported labels safely", async () => {
    const labeled = labelCommentText("仕事で", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(labeled);
    const input = toCommentLabelCompletionInput({
      originalText: labeled.originalText,
      normalizedText: labeled.normalizedText,
      labeledTokens: labeled.tokens,
      unlabeledSegments: segments,
    });

    const result = await completeLabelsWithLlm(input, {
      fetchImpl: createMockFetchWithContent(
        buildJsonForAllSegments(segments, () => ["desire_marker"]),
      ),
    });

    expect(result.output).toBeNull();
    expect(result.error?.stage).toBe("validate");
  });

  it("rejects reason_marker when combined with other labels", async () => {
    const labeled = labelCommentText("仕事で", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(labeled);
    const input = toCommentLabelCompletionInput({
      originalText: labeled.originalText,
      normalizedText: labeled.normalizedText,
      labeledTokens: labeled.tokens,
      unlabeledSegments: segments,
    });

    const result = await completeLabelsWithLlm(input, {
      fetchImpl: createMockFetchWithContent(
        buildJsonForAllSegments(segments, () => ["reason_marker", "conditional_marker"]),
      ),
    });

    expect(result.output).toBeNull();
    expect(result.error?.stage).toBe("validate");
  });

  it("rejects partial output safely", async () => {
    const input = toCommentLabelCompletionInput({
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

    const result = await completeLabelsWithLlm(input, {
      fetchImpl: createMockFetchWithContent(
        JSON.stringify({
          segments: [
            {
              segmentId: "seg-1",
              text: "バイトだから",
              labels: ["reason_marker"],
            },
          ],
        }),
      ),
    });

    expect(result.output).toBeNull();
    expect(result.error?.stage).toBe("validate");
  });

  it("rejects text and segmentId mismatches safely", async () => {
    const labeled = labelCommentText("仕事で", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(labeled);
    const input = toCommentLabelCompletionInput({
      originalText: labeled.originalText,
      normalizedText: labeled.normalizedText,
      labeledTokens: labeled.tokens,
      unlabeledSegments: segments,
    });

    const badIdResult = await completeLabelsWithLlm(input, {
      fetchImpl: createMockFetchWithContent(
        JSON.stringify({
          segments: [
            {
              segmentId: "seg-999",
              text: "仕事で",
              labels: ["reason_marker"],
            },
          ],
        }),
      ),
    });
    expect(badIdResult.output).toBeNull();
    expect(badIdResult.error?.stage).toBe("validate");

    const badTextResult = await completeLabelsWithLlm(input, {
      fetchImpl: createMockFetchWithContent(
        JSON.stringify({
          segments: [
            {
              segmentId: segments[0]!.segmentId,
              text: "仕事",
              labels: ["reason_marker"],
            },
          ],
        }),
      ),
    });
    expect(badTextResult.output).toBeNull();
    expect(badTextResult.error?.stage).toBe("validate");
  });

  it("fails safely on request errors", async () => {
    const labeled = labelCommentText("仕事で", { eventDateRange: aprilRange });
    const input = toCommentLabelCompletionInput({
      originalText: labeled.originalText,
      normalizedText: labeled.normalizedText,
      labeledTokens: labeled.tokens,
      unlabeledSegments: extractUnlabeledSegments(labeled),
    });

    const result = await completeLabelsWithLlm(input, {
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    expect(result.output).toBeNull();
    expect(result.error).toMatchObject({
      stage: "request",
      message: "network down",
    });
  });
});

describe("comment label completion integration guardrails", () => {
  it("keeps dictionary negatives and adds reason_marker only to the unlabeled fragment", async () => {
    const base = labelCommentText("バイトだから無理", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(base);

    const result = await completeLabeledCommentWithLlm(base, {
      fetchImpl: createMockFetchWithContent(
        buildJsonForAllSegments(segments, (segment) => (segment.text === "バイトだから" ? ["reason_marker"] : ["none"])),
      ),
    });

    expect(result.llmWasCalled).toBe(true);
    expect(result.unlabeledSegments.map((segment) => segment.text)).toEqual(["バイトだから"]);
    expect(result.labeledComment.tokens.some((token) => token.label === "availability_negative" && token.text === "無理")).toBe(true);
    expect(result.labeledComment.tokens.some((token) => token.label === "reason_marker" && token.text === "バイトだから" && token.source === "llm_completion")).toBe(true);
  });

  it("adds reason_marker next to provisional unknown without overwriting the existing token", async () => {
    const base = labelCommentText("次の日1限だから微妙", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(base);

    const result = await completeLabeledCommentWithLlm(base, {
      fetchImpl: createMockFetchWithContent(
        buildJsonForAllSegments(segments, (segment) => (segment.text === "次の日1限だから" ? ["reason_marker"] : ["none"])),
      ),
    });

    expect(result.labeledComment.tokens.some((token) => token.label === "availability_unknown" && token.text === "微妙")).toBe(true);
    expect(result.labeledComment.tokens.some((token) => token.label === "reason_marker" && token.text === "次の日1限だから")).toBe(true);
  });

  it("does not turn conditional-like text into reason_marker when condition markers already exist", async () => {
    const base = labelCommentText("終電でもいいなら行ける", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(base);

    const result = await completeLabeledCommentWithLlm(base, {
      fetchImpl: createMockFetchWithContent(
        buildJsonForAllSegments(segments, () => ["none"]),
      ),
    });

    expect(result.labeledComment.tokens.some((token) => token.label === "conditional_marker")).toBe(true);
    expect(result.labeledComment.tokens.some((token) => token.label === "availability_positive" && token.text === "行ける")).toBe(true);
    expect(result.labeledComment.tokens.some((token) => token.label === "reason_marker")).toBe(false);
  });

  it("does not call Ollama when the dictionary already covers the sentence", async () => {
    let called = false;
    const result = await labelCommentTextWithLlm("たぶん行ける", { eventDateRange: aprilRange }, {
      fetchImpl: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    expect(called).toBe(false);
    expect(result.llmWasCalled).toBe(false);
    expect(result.labeledComment.tokens.some((token) => token.label === "uncertainty_marker" && token.text === "たぶん")).toBe(true);
    expect(result.labeledComment.tokens.some((token) => token.label === "availability_positive" && token.text === "行ける")).toBe(true);
    expect(result.labeledComment.tokens.some((token) => token.label === "reason_marker")).toBe(false);
  });

  it("does not add reason_marker to comparison-only comments already covered by the dictionary", async () => {
    let called = false;
    const result = await labelCommentTextWithLlm("土曜の方が助かる", { eventDateRange: aprilRange }, {
      fetchImpl: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });

    expect(called).toBe(false);
    expect(result.labeledComment.tokens.some((token) => token.label === "comparison_marker" && token.text === "の方が助かる")).toBe(true);
    expect(result.labeledComment.tokens.some((token) => token.label === "reason_marker")).toBe(false);
  });

  it("can attach reason_marker to a pure background-fragment comment", async () => {
    const base = labelCommentText("仕事で", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(base);
    const result = await completeLabeledCommentWithLlm(base, {
      fetchImpl: createMockFetchWithContent(
        buildJsonForAllSegments(segments, () => ["reason_marker"]),
      ),
    });

    expect(result.labeledComment.tokens.some((token) => token.label === "particle_link" && token.text === "で")).toBe(true);
    expect(result.labeledComment.tokens.some((token) => token.label === "reason_marker" && token.text === "仕事で")).toBe(true);
    expect(result.labeledComment.tokens.find((token) => token.label === "reason_marker")).toMatchObject({
      label: "reason_marker",
      text: "仕事で",
      source: "llm_completion",
    });
  });

  it("permits none for fragments that should not be forced into reason_marker", async () => {
    const base = labelCommentText("相談", { eventDateRange: aprilRange });
    const segments = extractUnlabeledSegments(base);
    const result = await completeLabeledCommentWithLlm(base, {
      fetchImpl: createMockFetchWithContent(
        buildJsonForAllSegments(segments, () => ["none"]),
      ),
    });

    expect(result.labeledComment.tokens).toHaveLength(0);
    expect(result.completion?.output?.segments[0]?.labels).toEqual(["none"]);
  });
});

const maybeIt = process.env.RUN_OLLAMA_LABEL_COMPLETION_TESTS === "1" ? it : it.skip;

describe("comment label completion ollama smoke test", () => {
  maybeIt("can talk to a local Ollama instance when explicitly enabled", async () => {
    const labeled = labelCommentText("仕事で", { eventDateRange: aprilRange });
    const input = toCommentLabelCompletionInput({
      originalText: labeled.originalText,
      normalizedText: labeled.normalizedText,
      labeledTokens: labeled.tokens,
      unlabeledSegments: extractUnlabeledSegments(labeled),
    });

    const raw = await callOllamaForLabelCompletion(input, {
      model: process.env.OLLAMA_MODEL,
      baseUrl: process.env.OLLAMA_BASE_URL,
      timeoutMs: 20_000,
    });

    expect(typeof raw).toBe("string");
    expect(raw.length).toBeGreaterThan(0);
  });
});
