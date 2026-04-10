import { describe, expect, it } from "vitest";
import { labelCommentText } from "@/lib/comment-labeler";
import {
  AvailabilityInterpretationParseError,
  buildAvailabilityInterpretationMessages,
  buildAvailabilityInterpretationPrompt,
  parseAvailabilityInterpretationResponse,
  toLlmInterpretationInput,
} from "@/lib/availability-interpretation";

const aprilRange = { start: "2026-04-01", end: "2026-04-30" } as const;

function tokenIndexFor(
  input: ReturnType<typeof toLlmInterpretationInput>,
  label: string,
  text: string,
) {
  const token = input.tokens.find((candidate) => candidate.label === label && candidate.text === text);

  expect(token).toBeDefined();

  return token!.index;
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
    const input = toLlmInterpretationInput(labelCommentText("平日は無理だけど土日はいける", { eventDateRange: aprilRange }));
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

  it("parses valid JSON into a token-indexed interpretation", () => {
    const input = toLlmInterpretationInput(labelCommentText("5日は無理、あとはいける", { eventDateRange: aprilRange }));
    const dateIndex = tokenIndexFor(input, "target_date", "5日");
    const negativeIndex = tokenIndexFor(input, "availability_negative", "無理");
    const commaIndex = tokenIndexFor(input, "punctuation_boundary", "、");
    const residualIndex = tokenIndexFor(input, "scope_residual", "あとは");
    const positiveIndex = tokenIndexFor(input, "availability_positive", "いける");

    const parsed = parseAvailabilityInterpretationResponse(
      JSON.stringify({
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: [dateIndex],
            availabilityTokenIndexes: [negativeIndex],
            confidence: "high",
          },
          {
            relation: "applies_to",
            targetTokenIndexes: [residualIndex],
            availabilityTokenIndexes: [positiveIndex],
            confidence: "medium",
          },
          {
            relation: "residual_of",
            sourceTokenIndexes: [residualIndex],
            targetTokenIndexes: [dateIndex],
            markerTokenIndexes: [commaIndex],
            confidence: "medium",
          },
        ],
        ambiguities: ["Residual scope is anchored by the explicit scope token."],
      }),
      input,
    );

    expect(parsed).toEqual({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [dateIndex],
          availabilityTokenIndexes: [negativeIndex],
          confidence: "high",
        },
        {
          relation: "applies_to",
          targetTokenIndexes: [residualIndex],
          availabilityTokenIndexes: [positiveIndex],
          confidence: "medium",
        },
        {
          relation: "residual_of",
          sourceTokenIndexes: [residualIndex],
          targetTokenIndexes: [dateIndex],
          markerTokenIndexes: [commaIndex],
          confidence: "medium",
        },
      ],
      ambiguities: ["Residual scope is anchored by the explicit scope token."],
    });
  });

  it("rejects invalid relation and confidence values", () => {
    const input = toLlmInterpretationInput(labelCommentText("5日は無理", { eventDateRange: aprilRange }));

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
    const input = toLlmInterpretationInput(labelCommentText("5日は無理", { eventDateRange: aprilRange }));

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
    const input = toLlmInterpretationInput(labelCommentText("5日は無理", { eventDateRange: aprilRange }));

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
});
