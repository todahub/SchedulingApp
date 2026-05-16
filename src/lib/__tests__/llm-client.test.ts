import { describe, expect, it, vi } from "vitest";
import { requestStructuredJsonFromLlm, StructuredLlmRequestError } from "@/lib/llm-client";

describe("requestStructuredJsonFromLlm", () => {
  it("retries transient Gemini 503 failures and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () =>
          JSON.stringify({
            error: {
              message: "This model is currently experiencing high demand.",
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"attachments":[],"features":[],"unresolved":[]}',
                    },
                  ],
                },
              },
            ],
          }),
      });

    const response = await requestStructuredJsonFromLlm(
      {
        provider: "gemini",
        fetchImpl: fetchMock as unknown as typeof fetch,
        baseUrl: "https://example.invalid/v1beta/models",
        apiKey: "test-key",
        model: "gemini-2.5-flash",
        timeoutMs: 100,
        maxAttempts: 2,
      },
      {
        systemPrompt: "Return JSON only.",
        userPrompt: "Test",
        schema: {
          type: "object",
          properties: {
            attachments: { type: "array", items: { type: "object" } },
            features: { type: "array", items: { type: "object" } },
            unresolved: { type: "array", items: { type: "object" } },
          },
          required: ["attachments", "features", "unresolved"],
        },
      },
    );

    expect(response).toBe('{"attachments":[],"features":[],"unresolved":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient Gemini 400 failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            message: "Bad request.",
          },
        }),
    });

    await expect(
      requestStructuredJsonFromLlm(
        {
          provider: "gemini",
          fetchImpl: fetchMock as unknown as typeof fetch,
          baseUrl: "https://example.invalid/v1beta/models",
          apiKey: "test-key",
          model: "gemini-2.5-flash",
          timeoutMs: 100,
          maxAttempts: 3,
        },
        {
          systemPrompt: "Return JSON only.",
          userPrompt: "Test",
          schema: {
            type: "object",
            properties: {},
          },
        },
      ),
    ).rejects.toBeInstanceOf(StructuredLlmRequestError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
