import { describe, expect, it, vi } from "vitest";
import {
  buildAvailabilityInterpretationExecutionInput,
} from "@/lib/availability-comment-interpretation";
import { interpretAvailabilityCommentSubmissionWithOllama } from "@/lib/availability-comment-interpretation-server";
import { buildAvailabilityCommentInterpretationUserPrompt } from "@/lib/availability-comment-interpretation-prompt";
import type { LlmInterpretationOutput } from "@/lib/availability-interpretation";
import type { EventCandidateRecord } from "@/lib/domain";

function buildDiscreteDayCandidates(days: number[]): EventCandidateRecord[] {
  return days.map((day, index) => ({
    id: `candidate-${day}`,
    eventId: "event-april",
    date: `2026-04-${String(day).padStart(2, "0")}`,
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: `2026-04-${String(day).padStart(2, "0")}`,
    endDate: `2026-04-${String(day).padStart(2, "0")}`,
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: index + 1,
  }));
}

function findTokenIndex(
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
  options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
  },
) {
  const matches = executionInput.tokens.filter((token) => {
    const labelMatch = !options.label || token.label === options.label;
    const textMatch =
      !options.text ||
      (typeof options.text === "string" ? token.text === options.text : options.text.test(token.text));

    return labelMatch && textMatch;
  });
  const match = matches[options.nth ?? 0];

  if (!match) {
    throw new Error(
      `Token not found for label=${String(options.label)} text=${String(options.text)} nth=${String(options.nth ?? 0)} in "${executionInput.originalText}"`,
    );
  }

  return match.index;
}

function findTargetGroupId(
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
  expectedTexts: string[],
) {
  const group = executionInput.grouping.targetGroups.find((candidate) =>
    JSON.stringify(candidate.tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]?.text ?? "")) ===
      JSON.stringify(expectedTexts),
  );

  if (!group) {
    throw new Error(`Target group ${JSON.stringify(expectedTexts)} not found in "${executionInput.originalText}"`);
  }

  return group.id;
}

function buildResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => ({
      message: {
        content: JSON.stringify(payload),
      },
    }),
  };
}

async function runSubmissionScenario(args: {
  comment: string;
  candidates: EventCandidateRecord[];
  graph: LlmInterpretationOutput;
}) {
  let comparisonUserPrompt: string | null = null;

  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      format?: { properties?: Record<string, unknown> };
      messages?: Array<{ role?: string; content?: string }>;
    };
    const properties = body.format?.properties ?? {};

    if (Object.prototype.hasOwnProperty.call(properties, "selectedHypothesisId")) {
      return buildResponse({
        selectedHypothesisId: null,
        confidence: "medium",
      });
    }

    if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
      comparisonUserPrompt =
        body.messages?.find((message) => message.role === "user")?.content ?? null;
      return buildResponse({
        judgments: [],
        warnings: [],
      });
    }

    return buildResponse(args.graph);
  });

  const result = await interpretAvailabilityCommentSubmissionWithOllama(args.comment, args.candidates, {
    fetchImpl: fetchMock as typeof fetch,
    model: "mock-model",
  });

  return {
    fetchMock,
    result,
    debugGraph: JSON.parse(result.autoInterpretation.debugGraphJson ?? "{\"links\":[]}"),
    comparisonUserPrompt,
  };
}

describe("availability relation/supporting context guardrails", () => {
  it("mentions targetContexts as optional comparison-candidate material in the runtime availability prompt", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "11は無理、12の方がいい",
      buildDiscreteDayCandidates([11, 12]),
    );
    const prompt = buildAvailabilityCommentInterpretationUserPrompt(executionInput);

    expect(prompt).toContain("targetContexts");
    expect(prompt).toContain("comparison_candidate");
    expect(prompt).toContain("relationContext / supportingContext");
  });

  it("keeps current availability behavior while preserving later comparison-candidate context for 11も行けるけど12の方がいい", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("11も行けるけど12の方がいい", candidates);
    const targetTokenIndex = findTokenIndex(executionInput, { label: "target_date", text: /12/ });
    const contrastMarkerIndex = findTokenIndex(executionInput, { label: "conjunction_contrast", text: /けど/ });
    const availabilityClauseGroupId = executionInput.grouping.clauseGroups[0]?.id;

    expect(availabilityClauseGroupId).toBeTruthy();

    const { result, debugGraph, comparisonUserPrompt } = await runSubmissionScenario({
      comment: "11も行けるけど12の方がいい",
      candidates,
      graph: {
        links: [],
        targetContexts: [
          {
            targetTokenIndexes: [targetTokenIndex],
            supportingContext: [
              {
                kind: "contrast_availability_context",
                relatedClauseGroupIds: [availabilityClauseGroupId!],
                markerTokenIndexes: [contrastMarkerIndex],
                hint: "comparison_candidate",
              },
            ],
          },
        ],
      },
    });

    expect(result.autoInterpretation.rules).toEqual([]);
    expect(result.autoInterpretation.targetContexts).toEqual(debugGraph.targetContexts);
    expect(debugGraph.targetContexts).toEqual([
      expect.objectContaining({
        targetTokenIndexes: [targetTokenIndex],
        supportingContext: [
          expect.objectContaining({
            kind: "contrast_availability_context",
            relatedClauseGroupIds: [availabilityClauseGroupId],
            markerTokenIndexes: [contrastMarkerIndex],
            hint: "comparison_candidate",
          }),
        ],
      }),
    ]);
    expect(comparisonUserPrompt).toContain('"targetContexts"');
  });

  it("keeps conditional choice scope for 11,12なら13がいい without deciding the comparison", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12, 13]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("11,12なら13がいい", candidates);
    const targetTokenIndex = findTokenIndex(executionInput, { label: "target_date", text: /13/ });
    const conditionMarkerIndex = findTokenIndex(executionInput, { label: "conditional_marker", text: /なら/ });
    const leftTargetGroupId = findTargetGroupId(executionInput, ["11"]);
    const middleTargetGroupId = findTargetGroupId(executionInput, ["12"]);

    const { result, debugGraph, comparisonUserPrompt } = await runSubmissionScenario({
      comment: "11,12なら13がいい",
      candidates,
      graph: {
        links: [],
        targetContexts: [
          {
            targetTokenIndexes: [targetTokenIndex],
            relationContext: [
              {
                kind: "conditional_choice_scope",
                relatedTargetGroupIds: [leftTargetGroupId, middleTargetGroupId],
                markerTokenIndexes: [conditionMarkerIndex],
                hint: "comparison_candidate",
              },
            ],
          },
        ],
      },
    });

    expect(result.parsedConstraints).toEqual([]);
    expect(result.autoInterpretation.targetContexts).toEqual(debugGraph.targetContexts);
    expect(debugGraph.targetContexts).toEqual([
      expect.objectContaining({
        targetTokenIndexes: [targetTokenIndex],
        relationContext: [
          expect.objectContaining({
            kind: "conditional_choice_scope",
            relatedTargetGroupIds: [leftTargetGroupId, middleTargetGroupId],
            markerTokenIndexes: [conditionMarkerIndex],
            hint: "comparison_candidate",
          }),
        ],
      }),
    ]);
    expect(comparisonUserPrompt).toContain('"targetContexts"');
    expect(comparisonUserPrompt).toContain('"conditional_choice_scope"');
  });

  it("keeps comparison marker scope for 11より12がいい without turning it into availability", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("11より12がいい", candidates);
    const targetTokenIndex = findTokenIndex(executionInput, { label: "target_date", text: /12/ });
    const comparisonMarkerIndex = findTokenIndex(executionInput, { label: "comparison_marker", text: /より/ });
    const leftTargetGroupId = findTargetGroupId(executionInput, ["11"]);

    const { result, debugGraph } = await runSubmissionScenario({
      comment: "11より12がいい",
      candidates,
      graph: {
        links: [],
        targetContexts: [
          {
            targetTokenIndexes: [targetTokenIndex],
            relationContext: [
              {
                kind: "comparison_marker_scope",
                relatedTargetGroupIds: [leftTargetGroupId],
                markerTokenIndexes: [comparisonMarkerIndex],
                hint: "comparison_candidate",
              },
            ],
          },
        ],
      },
    });

    expect(result.parsedConstraints).toEqual([]);
    expect(debugGraph.targetContexts?.[0]).toMatchObject({
      targetTokenIndexes: [targetTokenIndex],
      relationContext: [
        expect.objectContaining({
          kind: "comparison_marker_scope",
          relatedTargetGroupIds: [leftTargetGroupId],
          markerTokenIndexes: [comparisonMarkerIndex],
          hint: "comparison_candidate",
        }),
      ],
    });
  });

  it("does not emit comparison-candidate context for plain conditional availability", async () => {
    const candidates = buildDiscreteDayCandidates([11]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("11なら行ける", candidates);
    const targetTokenIndex = findTokenIndex(executionInput, { label: "target_date", text: /11/ });
    const availabilityTokenIndex = findTokenIndex(executionInput, { label: "availability_positive", text: /行ける/ });
    const modifierTokenIndex = findTokenIndex(executionInput, { label: "conditional_marker", text: /なら/ });

    const { result, debugGraph } = await runSubmissionScenario({
      comment: "11なら行ける",
      candidates,
      graph: {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: [targetTokenIndex],
            availabilityTokenIndexes: [availabilityTokenIndex],
            modifierTokenIndexes: [modifierTokenIndex],
            confidence: "high",
          },
        ],
      },
    });

    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({
        intent: "availability",
        targetValue: "2026-04-11",
        level: "conditional",
      }),
    ]);
    expect(debugGraph.targetContexts).toBeUndefined();
  });

  it("keeps existing negative availability and adds comparison-candidate context for 11は無理、12の方がいい", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("11は無理、12の方がいい", candidates);
    const negativeTargetTokenIndex = findTokenIndex(executionInput, { label: "target_date", text: /11/ });
    const negativeAvailabilityTokenIndex = findTokenIndex(executionInput, { label: "availability_negative", text: /無理/ });
    const preferredTargetTokenIndex = findTokenIndex(executionInput, { label: "target_date", text: /12/ });
    const comparisonMarkerIndex = findTokenIndex(executionInput, { label: "comparison_marker", text: /方が/ });
    const negativeTargetGroupId = findTargetGroupId(executionInput, ["11"]);

    const { result, debugGraph } = await runSubmissionScenario({
      comment: "11は無理、12の方がいい",
      candidates,
      graph: {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: [negativeTargetTokenIndex],
            availabilityTokenIndexes: [negativeAvailabilityTokenIndex],
            confidence: "high",
          },
        ],
        targetContexts: [
          {
            targetTokenIndexes: [preferredTargetTokenIndex],
            relationContext: [
              {
                kind: "comparison_marker_scope",
                relatedTargetGroupIds: [negativeTargetGroupId],
                markerTokenIndexes: [comparisonMarkerIndex],
                hint: "comparison_candidate",
              },
            ],
          },
        ],
      },
    });

    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.rules[0]).toMatchObject({
      targetText: "11",
      availabilityLabel: "availability_negative",
    });
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({
        intent: "availability",
        targetValue: "2026-04-11",
      }),
    ]);
    expect(debugGraph.targetContexts?.[0]).toMatchObject({
      targetTokenIndexes: [preferredTargetTokenIndex],
      relationContext: [
        expect.objectContaining({
          kind: "comparison_marker_scope",
          relatedTargetGroupIds: [negativeTargetGroupId],
          markerTokenIndexes: [comparisonMarkerIndex],
          hint: "comparison_candidate",
        }),
      ],
    });
  });
});
