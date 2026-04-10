import { describe, expect, it } from "vitest";
import { labelCommentText } from "@/lib/comment-labeler";
import {
  AvailabilityInterpretationParseError,
  buildAvailabilityInterpretationMessages,
  buildAvailabilityInterpretationPrompt,
  parseAvailabilityInterpretationResponse,
  toLlmInterpretationInput,
  validateAvailabilityInterpretationOutput,
} from "@/lib/availability-interpretation";

const aprilRange = { start: "2026-04-01", end: "2026-04-30" } as const;

function inputFor(comment: string) {
  return toLlmInterpretationInput(labelCommentText(comment, { eventDateRange: aprilRange }));
}

function expectTokens(
  input: ReturnType<typeof toLlmInterpretationInput>,
  expected: Array<{ index: number; text: string; label: string }>,
) {
  expect(input.tokens.map(({ index, text, label }) => ({ index, text, label }))).toEqual(expected);
}

function parseGraph(
  input: ReturnType<typeof toLlmInterpretationInput>,
  output: Record<string, unknown>,
) {
  return parseAvailabilityInterpretationResponse(JSON.stringify(output), input);
}

describe("availability interpretation guardrails", () => {
  it("converts labeled comments into index-addressable LLM input", () => {
    const labeled = labelCommentText("5日は無理、あとはいける", { eventDateRange: aprilRange });
    const input = toLlmInterpretationInput(labeled);

    expect(input.originalText).toBe("5日は無理、あとはいける");
    expect(input.tokens.map((token) => token.index)).toEqual(input.tokens.map((_, index) => index));
    expect(input.tokens[0]).toMatchObject({
      index: 0,
      text: "5日",
      label: "target_date",
      start: 0,
      end: 2,
    });
    expect("source" in input.tokens[0]!).toBe(false);
  });

  it("builds prompts that forbid free reinterpretation and require JSON-only index output", () => {
    const input = inputFor("平日は無理だけど土日はいける");
    const { system, user } = buildAvailabilityInterpretationMessages(input);
    const prompt = buildAvailabilityInterpretationPrompt(input);

    expect(system).toContain("Your job is relation interpretation only.");
    expect(system).toContain("Do not create any new date, weekday, time-of-day, target, or availability value.");
    expect(system).toContain('Do not turn "金曜" into a concrete calendar date.');
    expect(system).toContain('Do not turn "5日" into a different date.');
    expect(system).toContain("Return JSON only. No markdown. No code fences.");
    expect(system).toContain('Do not invent merged spans such as "5日午前"; use existing token indexes instead.');
    expect(user).toContain('- 0 | "平日" | target_weekday_group');
    expect(prompt).toContain("[system]");
    expect(prompt).toContain("[user]");
  });

  it("fixes the graph for 平日は無理", () => {
    const input = inputFor("平日は無理");

    expectTokens(input, [
      { index: 0, text: "平日", label: "target_weekday_group" },
      { index: 1, text: "は", label: "particle_topic" },
      { index: 2, text: "無理", label: "availability_negative" },
    ]);

    const parsed = parseGraph(input, {
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [0],
          availabilityTokenIndexes: [2],
          confidence: "high",
        },
      ],
    });

    expect(parsed).toEqual({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [0],
          availabilityTokenIndexes: [2],
          confidence: "high",
        },
      ],
    });
    expect(parsed.ambiguities).toBeUndefined();
  });

  it("fixes the graph for 5日は午前が無理 with a composite target group", () => {
    const input = inputFor("5日は午前が無理");

    expectTokens(input, [
      { index: 0, text: "5日", label: "target_date" },
      { index: 1, text: "は", label: "particle_topic" },
      { index: 2, text: "午前", label: "target_time_of_day" },
      { index: 3, text: "無理", label: "availability_negative" },
    ]);

    const parsed = parseGraph(input, {
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [0, 2],
          availabilityTokenIndexes: [3],
          confidence: "high",
        },
      ],
    });

    expect(parsed).toEqual({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [0, 2],
          availabilityTokenIndexes: [3],
          confidence: "high",
        },
      ],
    });
  });

  it("fixes the graph for あとはいける without forcing residual_of", () => {
    const input = inputFor("あとはいける");

    expectTokens(input, [
      { index: 0, text: "あとは", label: "conjunction_parallel" },
      { index: 1, text: "あとは", label: "scope_residual" },
      { index: 2, text: "いける", label: "availability_positive" },
    ]);

    const parsed = parseGraph(input, {
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [1],
          availabilityTokenIndexes: [2],
          confidence: "medium",
        },
      ],
      ambiguities: ["Residual scope has no explicit antecedent target set in the input."],
    });

    expect(parsed).toEqual({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [1],
          availabilityTokenIndexes: [2],
          confidence: "medium",
        },
      ],
      ambiguities: ["Residual scope has no explicit antecedent target set in the input."],
    });
    expect(parsed.links.some((link) => link.relation === "residual_of")).toBe(false);
  });

  it("fixes the graph for 平日は無理、5日は午前が無理、あとはいける with an explicit residual antecedent set", () => {
    const input = inputFor("平日は無理、5日は午前が無理、あとはいける");

    expectTokens(input, [
      { index: 0, text: "平日", label: "target_weekday_group" },
      { index: 1, text: "は", label: "particle_topic" },
      { index: 2, text: "無理", label: "availability_negative" },
      { index: 3, text: "、", label: "punctuation_boundary" },
      { index: 4, text: "5日", label: "target_date" },
      { index: 5, text: "は", label: "particle_topic" },
      { index: 6, text: "午前", label: "target_time_of_day" },
      { index: 7, text: "無理", label: "availability_negative" },
      { index: 8, text: "、", label: "punctuation_boundary" },
      { index: 9, text: "あとは", label: "conjunction_parallel" },
      { index: 10, text: "あとは", label: "scope_residual" },
      { index: 11, text: "いける", label: "availability_positive" },
    ]);

    const parsed = parseGraph(input, {
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
    });

    expect(parsed).toEqual({
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
    });
    expect(parsed.ambiguities).toBeUndefined();
  });

  it("fixes the graph for 平日ならいけるけど金曜は厳しい without generating condition_for", () => {
    const input = inputFor("平日ならいけるけど金曜は厳しい");

    expectTokens(input, [
      { index: 0, text: "平日", label: "target_weekday_group" },
      { index: 1, text: "なら", label: "conditional_marker" },
      { index: 2, text: "なら", label: "particle_condition" },
      { index: 3, text: "いける", label: "availability_positive" },
      { index: 4, text: "けど", label: "conjunction_contrast" },
      { index: 5, text: "金曜", label: "target_weekday" },
      { index: 6, text: "は", label: "particle_topic" },
      { index: 7, text: "厳しい", label: "availability_negative" },
    ]);

    const parsed = parseGraph(input, {
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [0],
          availabilityTokenIndexes: [3],
          confidence: "high",
        },
        {
          relation: "applies_to",
          targetTokenIndexes: [5],
          availabilityTokenIndexes: [7],
          confidence: "high",
        },
        {
          relation: "contrast_with",
          sourceTokenIndexes: [0, 3],
          targetTokenIndexes: [5, 7],
          markerTokenIndexes: [4],
          confidence: "high",
        },
      ],
    });

    expect(parsed).toEqual({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [0],
          availabilityTokenIndexes: [3],
          confidence: "high",
        },
        {
          relation: "applies_to",
          targetTokenIndexes: [5],
          availabilityTokenIndexes: [7],
          confidence: "high",
        },
        {
          relation: "contrast_with",
          sourceTokenIndexes: [0, 3],
          targetTokenIndexes: [5, 7],
          markerTokenIndexes: [4],
          confidence: "high",
        },
      ],
    });
    expect(parsed.links.some((link) => link.relation === "condition_for")).toBe(false);
  });

  it("fixes the graph for 金曜の夜以外はいける with exception_to", () => {
    const input = inputFor("金曜の夜以外はいける");

    expectTokens(input, [
      { index: 0, text: "金曜", label: "target_weekday" },
      { index: 1, text: "の", label: "particle_link" },
      { index: 2, text: "夜", label: "target_time_of_day" },
      { index: 3, text: "以外は", label: "scope_exception" },
      { index: 4, text: "いける", label: "availability_positive" },
    ]);

    const parsed = parseGraph(input, {
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
    });

    expect(parsed).toEqual({
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
    });
    expect(parsed.links.some((link) => link.relation === "exception_to")).toBe(true);
  });

  it("fixes the graph for 5日はたぶんいける、6日は無理ではない using applies_to modifiers", () => {
    const input = inputFor("5日はたぶんいける、6日は無理ではない");

    expectTokens(input, [
      { index: 0, text: "5日", label: "target_date" },
      { index: 1, text: "は", label: "particle_topic" },
      { index: 2, text: "たぶん", label: "emphasis_marker" },
      { index: 3, text: "たぶん", label: "uncertainty_marker" },
      { index: 4, text: "いける", label: "availability_positive" },
      { index: 5, text: "、", label: "punctuation_boundary" },
      { index: 6, text: "6日", label: "target_date" },
      { index: 7, text: "は", label: "particle_topic" },
      { index: 8, text: "無理ではない", label: "availability_positive" },
    ]);

    const parsed = parseGraph(input, {
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
    });

    expect(parsed).toEqual({
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
    });
    expect(parsed.links.some((link) => link.relation === "modifies")).toBe(false);
  });

  it("rejects invalid relation and confidence values", () => {
    const input = inputFor("5日は無理");

    expect(() =>
      parseAvailabilityInterpretationResponse(
        JSON.stringify({
          links: [
            {
              relation: "invented_relation",
              targetTokenIndexes: [0],
              availabilityTokenIndexes: [2],
              confidence: "high",
            },
          ],
        }),
        input,
      ),
    ).toThrow(AvailabilityInterpretationParseError);

    expect(() =>
      parseAvailabilityInterpretationResponse(
        JSON.stringify({
          links: [
            {
              relation: "applies_to",
              targetTokenIndexes: [0],
              availabilityTokenIndexes: [2],
              confidence: "certain",
            },
          ],
        }),
        input,
      ),
    ).toThrow(AvailabilityInterpretationParseError);
  });

  it("rejects out-of-range indexes and missing required fields", () => {
    const input = inputFor("5日は無理");

    expect(() =>
      parseAvailabilityInterpretationResponse(
        JSON.stringify({
          links: [
            {
              relation: "applies_to",
              targetTokenIndexes: [99],
              availabilityTokenIndexes: [2],
              confidence: "high",
            },
          ],
        }),
        input,
      ),
    ).toThrow(/out of range/);

    expect(() =>
      parseAvailabilityInterpretationResponse(
        JSON.stringify({
          links: [
            {
              relation: "applies_to",
              targetTokenIndexes: [0],
              confidence: "high",
            },
          ],
        }),
        input,
      ),
    ).toThrow(/availabilityTokenIndexes/);
  });

  it("rejects applies_to links that point availability indexes at non-availability tokens", () => {
    const input = inputFor("5日は無理");

    expect(() =>
      parseAvailabilityInterpretationResponse(
        JSON.stringify({
          links: [
            {
              relation: "applies_to",
              targetTokenIndexes: [0],
              availabilityTokenIndexes: [1],
              confidence: "high",
            },
          ],
        }),
        input,
      ),
    ).toThrow(/availability tokens/);
  });

  it("rejects modifies links in this phase", () => {
    const input = inputFor("5日はたぶんいける");

    expect(() =>
      validateAvailabilityInterpretationOutput(
        {
          links: [
            {
              relation: "modifies",
              sourceTokenIndexes: [1],
              targetTokenIndexes: [2],
              confidence: "high",
            },
          ],
        },
        input,
      ),
    ).toThrow(/must not be "modifies"/);
  });

  it("rejects residual_of links that point at scope or availability tokens", () => {
    const input = inputFor("平日は無理、5日は午前が無理、あとはいける");

    expect(() =>
      validateAvailabilityInterpretationOutput(
        {
          links: [
            {
              relation: "residual_of",
              sourceTokenIndexes: [10],
              targetTokenIndexes: [0, 10, 11],
              confidence: "medium",
            },
          ],
        },
        input,
      ),
    ).toThrow(/target tokens/);
  });

  it("rejects exception_to links that point back to scope_exception itself", () => {
    const input = inputFor("金曜の夜以外はいける");

    expect(() =>
      validateAvailabilityInterpretationOutput(
        {
          links: [
            {
              relation: "exception_to",
              sourceTokenIndexes: [3],
              targetTokenIndexes: [3],
              confidence: "high",
            },
          ],
        },
        input,
      ),
    ).toThrow(/target tokens/);
  });

  it("rejects applies_to modifierTokenIndexes that are not semantic nuance markers", () => {
    const input = inputFor("平日ならいける");

    expect(() =>
      validateAvailabilityInterpretationOutput(
        {
          links: [
            {
              relation: "applies_to",
              targetTokenIndexes: [0],
              availabilityTokenIndexes: [3],
              modifierTokenIndexes: [1],
              confidence: "high",
            },
          ],
        },
        input,
      ),
    ).toThrow(/semantic modifier tokens/);
  });
});
