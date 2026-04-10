import { describe, expect, it, vi } from "vitest";
import { buildAvailabilityInterpretationExecutionInput } from "@/lib/availability-comment-interpretation";
import { interpretAvailabilityCommentWithOllama } from "@/lib/availability-comment-interpretation-server";
import type { EventCandidateRecord } from "@/lib/domain";

function buildCandidates(): EventCandidateRecord[] {
  return [
    {
      id: "candidate-april",
      eventId: "event-april",
      date: "2026-04-01",
      timeSlotKey: "all_day",
      selectionMode: "range",
      dateType: "range",
      startDate: "2026-04-01",
      endDate: "2026-04-12",
      selectedDates: [],
      timeType: "all_day",
      startTime: null,
      endTime: null,
      note: null,
      sortOrder: 10,
    },
  ];
}

describe("availability comment auto interpretation", () => {
  it("builds grouping input, calls Ollama, validates the graph, and produces structured rules", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [4],
                modifierTokenIndexes: [2, 3],
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: [6],
                availabilityTokenIndexes: [8],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("5日はたぶんいける、6日は無理ではない", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      baseUrl: "http://127.0.0.1:11434/api",
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      format: Record<string, unknown>;
      messages: Array<{ role: string; content: string }>;
    };

    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(body.model).toBe("mock-model");
    expect(body.stream).toBe(false);
    expect(body.format).toBeTruthy();
    expect(body.messages[0]?.content).toContain("condition_for");
    expect(body.messages[1]?.content).toContain('"targetGroups"');
    expect(body.messages[1]?.content).toContain('"availabilityGroups"');

    expect(result.status).toBe("success");
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]).toMatchObject({
      targetText: "5日",
      availabilityText: "いける",
      modifierTexts: ["たぶん", "たぶん"],
    });
    expect(result.rules[1]).toMatchObject({
      targetText: "6日",
      availabilityText: "無理ではない",
    });
  });

  it("keeps residual interpretation tied to prior target groups only when the graph is explicit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "applies_to",
                targetTokenIndexes: [0],
                availabilityTokenIndexes: [2],
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: [4, 6],
                availabilityTokenIndexes: [7],
                confidence: "high",
              },
              {
                relation: "applies_to",
                targetTokenIndexes: [10],
                availabilityTokenIndexes: [11],
                confidence: "medium",
              },
              {
                relation: "residual_of",
                sourceTokenIndexes: [10],
                targetTokenIndexes: [0, 4, 6],
                markerTokenIndexes: [8, 9],
                confidence: "medium",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("平日は無理、5日は午前が無理、あとはいける", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.status).toBe("success");
    expect(result.rules[2]?.targetText).toBe("あとは");
    expect(result.rules[2]?.residualOfTokenIndexes).toEqual([0, 4, 6]);
    expect(result.rules[2]?.notes).toContain("残り範囲: 平日 / 5日 / 午前 の残り");
  });

  it("canonicalizes dropped semantic modifiers onto applies_to before validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [0],
                  availabilityTokenIndexes: [4],
                  confidence: "high",
                },
                {
                  relation: "applies_to",
                  targetTokenIndexes: [6],
                  availabilityTokenIndexes: [8],
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [0],
                  availabilityTokenIndexes: [4],
                  modifierTokenIndexes: [2, 3],
                  confidence: "high",
                },
                {
                  relation: "applies_to",
                  targetTokenIndexes: [6],
                  availabilityTokenIndexes: [8],
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      });

    const result = await interpretAvailabilityCommentWithOllama("5日はたぶんいける、6日は無理ではない", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
    expect(result.rules[0]?.modifierTexts).toEqual(["たぶん", "たぶん"]);
  });

  it("canonicalizes flattened exception clauses into scope applies_to and exception_to", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [0, 2],
                  availabilityTokenIndexes: [4],
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              links: [
                {
                  relation: "applies_to",
                  targetTokenIndexes: [3],
                  availabilityTokenIndexes: [4],
                  confidence: "high",
                },
                {
                  relation: "exception_to",
                  sourceTokenIndexes: [3],
                  targetTokenIndexes: [0, 2],
                  confidence: "high",
                },
              ],
            }),
          },
        }),
      });

    const result = await interpretAvailabilityCommentWithOllama("金曜の夜以外はいける", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
    expect(result.rules[0]).toMatchObject({
      targetText: "以外は",
      availabilityText: "いける",
      exceptionTargetTokenIndexes: [0, 2],
    });
    expect(result.rules[0]?.notes).toContain("除外対象: 金曜 / 夜");
  });

  it("fails safely when Ollama returns invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: "not-json",
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("平日は無理", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.rules).toEqual([]);
    expect(result.failureReason).toContain("valid JSON");
  });

  it("fails safely when Ollama returns a forbidden relation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            links: [
              {
                relation: "condition_for",
                sourceTokenIndexes: [0],
                targetTokenIndexes: [3],
                markerTokenIndexes: [1, 2],
                confidence: "high",
              },
            ],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("平日ならいけるけど金曜は厳しい", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toContain("Only applies_to, contrast_with, residual_of, and exception_to are supported.");
  });

  it("builds composite target groups deterministically before calling the model", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput("5日は午前が無理", buildCandidates());

    expect(executionInput.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "5日", "target_date"],
      [1, "は", "particle_topic"],
      [2, "午前", "target_time_of_day"],
      [3, "無理", "availability_negative"],
    ]);
    expect(executionInput.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0, 2] }]);
    expect(executionInput.grouping.availabilityGroups).toEqual([{ id: "ag1", tokenIndexes: [3] }]);
    expect(executionInput.grouping.clauseGroups).toEqual([
      {
        id: "cg1",
        tokenIndexes: [0, 2, 3],
        anchorGroupId: "tg1",
        availabilityGroupId: "ag1",
        appliesToTargetTokenIndexes: [0, 2],
        contextTargetGroupIds: ["tg1"],
        contextTargetGroups: [{ id: "tg1", tokenIndexes: [0, 2] }],
        semanticModifierTokenIndexes: [],
      },
    ]);
  });
});
