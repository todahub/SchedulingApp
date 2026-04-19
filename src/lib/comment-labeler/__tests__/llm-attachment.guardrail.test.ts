import { describe, expect, it } from "vitest";
import {
  buildAttachmentResolutionMessages,
  parseAttachmentResolutionResponse,
  resolveAttachmentsWithLlm,
  toAttachmentResolutionInput,
  validateAttachmentResolutionOutput,
} from "@/lib/comment-labeler/llm-attachment";
import type { AttachmentResolutionInput } from "@/lib/comment-labeler/attachment-types";

function createMockFetchWithContent(content: string, options?: { ok?: boolean; status?: number; error?: string }) {
  return async () =>
    ({
      ok: options?.ok ?? true,
      status: options?.status ?? 200,
      json: async () => ({
        ...(options?.error ? { error: options.error } : {}),
        message: { content },
      }),
    }) as Response;
}

function candidate(id: string, text: string, label: AttachmentResolutionInput["candidates"][number]["label"], start: number, end: number, clauseIndex = 0) {
  return {
    id,
    text,
    label,
    start,
    end,
    sentenceIndex: 0,
    clauseIndex,
  };
}

describe("llm attachment guardrails", () => {
  it("builds prompts that forbid free reinterpretation and require JSON-only relation output", () => {
    const input = toAttachmentResolutionInput("12はたぶんいける", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("m1", "たぶん", "uncertainty_marker", 2, 5),
      candidate("a1", "いける", "availability_positive", 5, 8),
    ]);

    const { systemPrompt, userPrompt } = buildAttachmentResolutionMessages(input);

    expect(systemPrompt).toContain("候補どうしの係り受けだけ");
    expect(systemPrompt).toContain("新しい日付、新しい可否、新しい理由、新しい希望を作ってはいけません。");
    expect(systemPrompt).toContain("出力は JSON のみです。");
    expect(userPrompt).toContain('"comment": "12はたぶんいける"');
    expect(userPrompt).toContain('"id": "a1"');
    expect(userPrompt).toContain('"label": "availability_positive"');
  });

  it("validates simple availability_target attachments", () => {
    const input = toAttachmentResolutionInput("12はいける", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("a1", "いける", "availability_positive", 2, 5),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "availability_target",
            sourceId: "a1",
            targetId: "t1",
            confidence: 0.97,
          },
        ],
        features: [],
        unresolved: [],
      }),
    );

    expect(validateAttachmentResolutionOutput(parsed, input)).toEqual({
      attachments: [
        {
          type: "availability_target",
          sourceId: "a1",
          targetId: "t1",
          confidence: 0.97,
        },
      ],
      features: [],
      unresolved: [],
    });
  });

  it("validates modifier and availability attachments together", () => {
    const input = toAttachmentResolutionInput("12はたぶんいける", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("m1", "たぶん", "uncertainty_marker", 2, 5),
      candidate("a1", "いける", "availability_positive", 5, 8),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "availability_target",
            sourceId: "a1",
            targetId: "t1",
            confidence: 0.94,
          },
          {
            type: "modifier_predicate",
            sourceId: "m1",
            targetId: "a1",
            confidence: 0.9,
          },
        ],
        features: [
          {
            type: "uncertainty_mode",
            sourceId: "m1",
            value: "plain_uncertainty",
          },
        ],
        unresolved: [],
      }),
    );

    expect(validateAttachmentResolutionOutput(parsed, input).attachments).toHaveLength(2);
  });

  it("validates reason attachments without letting reason create new predicates", () => {
    const input = toAttachmentResolutionInput("12の夜はバイトだから無理", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("t2", "夜", "target_time_of_day", 3, 4),
      candidate("r1", "バイト", "reason_marker", 5, 8),
      candidate("a1", "無理", "availability_negative", 9, 11),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "availability_target",
            sourceId: "a1",
            targetId: "t2",
            confidence: 0.93,
          },
          {
            type: "reason_predicate",
            sourceId: "r1",
            targetId: "a1",
            confidence: 0.9,
          },
        ],
        features: [
          {
            type: "reason_mode",
            sourceId: "r1",
            value: "explicit_reason",
          },
        ],
        unresolved: [],
      }),
    );

    const output = validateAttachmentResolutionOutput(parsed, input);
    expect(output.attachments.some((attachment) => attachment.type === "reason_predicate")).toBe(true);
  });

  it("validates comparison scope and preference target separately", () => {
    const input = toAttachmentResolutionInput("11と12なら12がいい", [
      candidate("t1", "11", "target_date", 0, 2),
      candidate("t2", "12", "target_date", 3, 5),
      candidate("c1", "なら", "particle_condition", 5, 7),
      candidate("p1", "12がいい", "preference_positive_marker", 7, 12),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "comparison_scope",
            sourceId: "p1",
            targetIds: ["t1", "t2"],
            confidence: 0.88,
          },
          {
            type: "preference_target",
            sourceId: "p1",
            targetId: "t2",
            confidence: 0.93,
          },
        ],
        features: [
          {
            type: "preference_mode",
            sourceId: "p1",
            value: "comparative",
          },
        ],
        unresolved: [],
      }),
    );

    const output = validateAttachmentResolutionOutput(parsed, input);
    expect(output.attachments.some((attachment) => attachment.type === "comparison_scope")).toBe(true);
    expect(output.attachments.some((attachment) => attachment.type === "preference_target")).toBe(true);
  });

  it("validates absolute preference without comparison", () => {
    const input = toAttachmentResolutionInput("12がいい", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("p1", "12がいい", "preference_positive_marker", 0, 5),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "preference_target",
            sourceId: "p1",
            targetId: "t1",
            confidence: 0.95,
          },
        ],
        features: [
          {
            type: "preference_mode",
            sourceId: "p1",
            value: "absolute",
          },
        ],
        unresolved: [],
      }),
    );

    expect(validateAttachmentResolutionOutput(parsed, input).attachments).toEqual([
      {
        type: "preference_target",
        sourceId: "p1",
        targetId: "t1",
        confidence: 0.95,
      },
    ]);
  });

  it("validates residual clause relations", () => {
    const input = toAttachmentResolutionInput("5日は午前が無理、あとはいける", [
      candidate("t1", "5日", "target_date", 0, 2, 0),
      candidate("t2", "午前", "target_time_of_day", 3, 5, 0),
      candidate("a1", "無理", "availability_negative", 6, 8, 0),
      candidate("r1", "あとは", "scope_residual", 9, 12, 1),
      candidate("a2", "いける", "availability_positive", 12, 15, 1),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "availability_target",
            sourceId: "a1",
            targetId: "t2",
            confidence: 0.9,
          },
          {
            type: "clause_relation",
            sourceId: "a2",
            targetId: "a1",
            relationKind: "residual",
            confidence: 0.82,
          },
        ],
        features: [],
        unresolved: [],
      }),
    );

    expect(validateAttachmentResolutionOutput(parsed, input).attachments.some((attachment) => {
      return attachment.type === "clause_relation" && attachment.relationKind === "residual";
    })).toBe(true);
  });

  it("validates exception-style clause relations", () => {
    const input = toAttachmentResolutionInput("平日は無理、ただ金曜夜ならいける", [
      candidate("t1", "平日", "target_weekday_group", 0, 2, 0),
      candidate("a1", "無理", "availability_negative", 3, 5, 0),
      candidate("x1", "ただ", "conjunction_contrast", 6, 8, 1),
      candidate("t2", "金曜", "target_weekday", 8, 10, 1),
      candidate("t3", "夜", "target_time_of_day", 10, 11, 1),
      candidate("c1", "なら", "conditional_marker", 11, 13, 1),
      candidate("a2", "いける", "availability_positive", 13, 16, 1),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "availability_target",
            sourceId: "a1",
            targetId: "t1",
            confidence: 0.96,
          },
          {
            type: "availability_target",
            sourceId: "a2",
            targetId: "t3",
            confidence: 0.91,
          },
          {
            type: "clause_relation",
            sourceId: "a2",
            targetId: "a1",
            relationKind: "exception",
            confidence: 0.85,
          },
        ],
        features: [],
        unresolved: [],
      }),
    );

    const output = validateAttachmentResolutionOutput(parsed, input);
    expect(output.attachments.some((attachment) => attachment.type === "clause_relation" && attachment.relationKind === "exception")).toBe(true);
  });

  it("preserves ambiguity without forcing final meaning", () => {
    const input = toAttachmentResolutionInput("12はたぶん無理", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("m1", "たぶん", "uncertainty_marker", 2, 5),
      candidate("a1", "無理", "availability_negative", 5, 7),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "availability_target",
            sourceId: "a1",
            targetId: "t1",
            confidence: 0.94,
          },
          {
            type: "modifier_predicate",
            sourceId: "m1",
            targetId: "a1",
            confidence: 0.9,
          },
        ],
        features: [
          {
            type: "uncertainty_mode",
            sourceId: "m1",
            value: "plain_uncertainty",
          },
        ],
        unresolved: [],
      }),
    );

    const output = validateAttachmentResolutionOutput(parsed, input);
    expect(output.features).toEqual([
      {
        type: "uncertainty_mode",
        sourceId: "m1",
        value: "plain_uncertainty",
      },
    ]);
  });

  it("rejects non-JSON and fenced JSON", () => {
    expect(() => parseAttachmentResolutionResponse("これは relation です")).toThrow(
      "LLM response was not valid JSON.",
    );
    expect(() => parseAttachmentResolutionResponse("```json\n{}\n```")).toThrow(
      "LLM response was not valid JSON.",
    );
  });

  it("rejects candidate ids that do not exist", () => {
    const input = toAttachmentResolutionInput("12はいける", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("a1", "いける", "availability_positive", 2, 5),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "availability_target",
            sourceId: "a999",
            targetId: "t1",
            confidence: 0.9,
          },
        ],
        features: [],
        unresolved: [],
      }),
    );

    expect(() => validateAttachmentResolutionOutput(parsed, input)).toThrow(
      "sourceId must reference an existing candidate id.",
    );
  });

  it("rejects unsupported reason codes and extra fields by validation", () => {
    const input = toAttachmentResolutionInput("12がいい", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("p1", "12がいい", "preference_positive_marker", 0, 5),
    ]);

    const parsed = parseAttachmentResolutionResponse(
      JSON.stringify({
        attachments: [
          {
            type: "preference_target",
            sourceId: "p1",
            targetId: "t1",
            confidence: 0.9,
            extra: true,
          },
        ],
        features: [],
        unresolved: [],
      }),
    );

    expect(() => validateAttachmentResolutionOutput(parsed, input)).toThrow();
  });

  it("wraps valid JSON from the Ollama caller", async () => {
    const input = toAttachmentResolutionInput("12はいける", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("a1", "いける", "availability_positive", 2, 5),
    ]);

    const result = await resolveAttachmentsWithLlm(input, {
      fetchImpl: createMockFetchWithContent(
        JSON.stringify({
          attachments: [
            {
              type: "availability_target",
              sourceId: "a1",
              targetId: "t1",
              confidence: 0.97,
            },
          ],
          features: [],
          unresolved: [],
        }),
      ),
    });

    expect(result.error).toBeNull();
    expect(result.output?.attachments).toEqual([
      {
        type: "availability_target",
        sourceId: "a1",
        targetId: "t1",
        confidence: 0.97,
      },
    ]);
  });

  it("falls back safely on invalid attachment output", async () => {
    const input = toAttachmentResolutionInput("12はいける", [
      candidate("t1", "12", "target_date", 0, 2),
      candidate("a1", "いける", "availability_positive", 2, 5),
    ]);

    const result = await resolveAttachmentsWithLlm(input, {
      fetchImpl: createMockFetchWithContent("not json"),
    });

    expect(result.output).toBeNull();
    expect(result.error?.stage).toBe("parse");
  });
});
