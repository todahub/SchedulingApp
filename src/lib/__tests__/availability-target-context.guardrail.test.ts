import { describe, expect, it, vi } from "vitest";
import {
  buildAvailabilityInterpretationExecutionInput,
} from "@/lib/availability-comment-interpretation";
import { interpretAvailabilityCommentSubmissionWithOllama } from "@/lib/availability-comment-interpretation-server";
import { buildAvailabilityCommentInterpretationUserPrompt } from "@/lib/availability-comment-interpretation-prompt";
import {
  type CommentLabelCompletionOutput,
} from "@/lib/comment-labeler";
import type { AttachmentResolutionInput, AttachmentResolutionOutput } from "@/lib/comment-labeler/attachment-types";
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

function parseMockOllamaBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? "{}")) as {
    format?: {
      properties?: Record<string, unknown>;
    };
    messages?: Array<{ role: string; content: string }>;
  };
}

function isLabelCompletionRequest(body: ReturnType<typeof parseMockOllamaBody>) {
  return Object.prototype.hasOwnProperty.call(body.format?.properties ?? {}, "segments");
}

function isAttachmentResolutionRequest(body: ReturnType<typeof parseMockOllamaBody>) {
  const properties = body.format?.properties ?? {};
  return (
    Object.prototype.hasOwnProperty.call(properties, "attachments") &&
    Object.prototype.hasOwnProperty.call(properties, "features") &&
    Object.prototype.hasOwnProperty.call(properties, "unresolved")
  );
}

function buildLabelCompletionPayloadFromRequest(
  body: ReturnType<typeof parseMockOllamaBody>,
  resolveLabels: (segmentText: string) => string[],
): CommentLabelCompletionOutput {
  const segmentItems = ((body.format?.properties?.segments as { items?: { properties?: Record<string, unknown> } })?.items ??
    {}) as {
    properties?: Record<string, unknown>;
  };
  const segmentIds =
    ((segmentItems.properties?.segmentId as { enum?: string[] })?.enum ?? []) as string[];
  const segmentTexts =
    ((segmentItems.properties?.text as { enum?: string[] })?.enum ?? []) as string[];

  return {
    segments: segmentIds.map((segmentId, index) => ({
      segmentId,
      text: segmentTexts[index] ?? "",
      labels: resolveLabels(segmentTexts[index] ?? ""),
    })),
  };
}

function findAttachmentCandidateId(
  input: AttachmentResolutionInput,
  options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
    clauseIndex?: number;
  },
) {
  const matches = input.candidates.filter((candidate) => {
    const labelMatch = !options.label || candidate.label === options.label;
    const textMatch =
      !options.text ||
      (typeof options.text === "string" ? candidate.text === options.text : options.text.test(candidate.text));
    const clauseMatch = options.clauseIndex === undefined || candidate.clauseIndex === options.clauseIndex;
    return labelMatch && textMatch && clauseMatch;
  });
  const match = matches[options.nth ?? 0];

  if (!match) {
    throw new Error(
      `Attachment candidate not found for label=${String(options.label)} text=${String(options.text)} clause=${String(options.clauseIndex)} nth=${String(options.nth ?? 0)} in "${input.comment}"`,
    );
  }

  return match.id;
}

function parseStructuredInputFromUserPrompt<T>(body: ReturnType<typeof parseMockOllamaBody>) {
  const userPrompt = body.messages?.[1]?.content ?? "";
  const inputMarker = "入力:\n";
  const inputMarkerIndex = userPrompt.indexOf(inputMarker);
  const jsonStart = userPrompt.indexOf("{", inputMarkerIndex >= 0 ? inputMarkerIndex : 0);
  const outputMarkerIndex = userPrompt.indexOf("\n\n出力形式:", jsonStart);

  if (jsonStart < 0) {
    throw new Error(`Structured input JSON not found in prompt:\n${userPrompt}`);
  }

  const jsonText =
    outputMarkerIndex > jsonStart
      ? userPrompt.slice(jsonStart, outputMarkerIndex).trim()
      : userPrompt.slice(jsonStart).trim();

  return JSON.parse(jsonText) as T;
}

async function runSubmissionScenario(args: {
  comment: string;
  candidates: EventCandidateRecord[];
  buildAttachmentOutput: (input: AttachmentResolutionInput) => AttachmentResolutionOutput;
}) {
  let comparisonUserPrompt: string | null = null;

  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = parseMockOllamaBody(init);
    const properties = body.format?.properties ?? {};

    if (isLabelCompletionRequest(body)) {
      return buildResponse(buildLabelCompletionPayloadFromRequest(body, () => ["none"]));
    }

    if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
      comparisonUserPrompt =
        body.messages?.find((message) => message.role === "user")?.content ?? null;
      return buildResponse({
        judgments: [],
        warnings: [],
      });
    }

    if (isAttachmentResolutionRequest(body)) {
      return buildResponse(args.buildAttachmentOutput(parseStructuredInputFromUserPrompt<AttachmentResolutionInput>(body)));
    }

    throw new Error(`Unexpected request body: ${JSON.stringify(body)}`);
  });

  const result = await interpretAvailabilityCommentSubmissionWithOllama(args.comment, args.candidates, {
    fetchImpl: fetchMock as typeof fetch,
    model: "mock-model",
  });

  return {
    fetchMock,
    result,
    debugGraph: JSON.parse(result.autoInterpretation.debugGraphJson ?? "{\"attachments\":[]}"),
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
    const targetTokenIndex = findTokenIndex(executionInput, { label: "target_numeric_candidate", text: /12/ });
    const group11Id = findTargetGroupId(executionInput, ["11"]);

    const { result, debugGraph, comparisonUserPrompt } = await runSubmissionScenario({
      comment: "11も行けるけど12の方がいい",
      candidates,
      buildAttachmentOutput: (input) => {
        const day11Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "11" });
        const day12Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "12" });
        const availableId = findAttachmentCandidateId(input, { label: "availability_positive", text: /行ける/ });
        const betterId = findAttachmentCandidateId(input, { label: "preference_positive_marker", text: /がいい/ });

        return {
          attachments: [
            { type: "availability_target", sourceId: availableId, targetId: day11Id, confidence: 0.98 },
            { type: "preference_target", sourceId: betterId, targetId: day12Id, confidence: 0.94 },
            { type: "comparison_scope", sourceId: betterId, targetIds: [day11Id], confidence: 0.88 },
          ],
          features: [],
          unresolved: [],
        };
      },
    });

    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.rules[0]).toMatchObject({
      targetText: "11",
      availabilityLabel: "availability_positive",
    });
    expect(result.autoInterpretation.targetContexts).toEqual([
      expect.objectContaining({
        targetTokenIndexes: [targetTokenIndex],
        relationContext: [
          expect.objectContaining({
            hint: "comparison_candidate",
            relatedTargetGroupIds: [group11Id],
          }),
        ],
      }),
    ]);
    expect(debugGraph.attachments).toHaveLength(3);
    expect(comparisonUserPrompt).toContain('"targetContexts"');
  });

  it("keeps conditional choice scope for 11,12なら13がいい without deciding the comparison", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12, 13]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("11,12なら13がいい", candidates);
    const targetTokenIndex = findTokenIndex(executionInput, { label: "target_numeric_candidate", text: /13/ });
    const conditionMarkerIndex = findTokenIndex(executionInput, { label: "conditional_marker", text: /なら/ });
    const leftTargetGroupId = findTargetGroupId(executionInput, ["11"]);
    const middleTargetGroupId = findTargetGroupId(executionInput, ["12"]);

    const { result, debugGraph, comparisonUserPrompt } = await runSubmissionScenario({
      comment: "11,12なら13がいい",
      candidates,
      buildAttachmentOutput: (input) => {
        const day11Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "11" });
        const day12Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "12" });
        const day13Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "13" });
        const betterId = findAttachmentCandidateId(input, { label: "preference_positive_marker", text: /がいい/ });

        return {
          attachments: [
            { type: "preference_target", sourceId: betterId, targetId: day13Id, confidence: 0.95 },
            { type: "comparison_scope", sourceId: betterId, targetIds: [day11Id, day12Id], confidence: 0.9 },
          ],
          features: [],
          unresolved: [],
        };
      },
    });

    expect(result.parsedConstraints).toEqual([]);
    expect(result.autoInterpretation.targetContexts).toEqual([
      expect.objectContaining({
        targetTokenIndexes: [targetTokenIndex],
        relationContext: [
          expect.objectContaining({
            kind: "conditional_choice_scope",
            relatedTargetGroupIds: [leftTargetGroupId, middleTargetGroupId],
            markerTokenIndexes: expect.arrayContaining([conditionMarkerIndex]),
            hint: "comparison_candidate",
          }),
        ],
      }),
    ]);
    expect(debugGraph.attachments).toHaveLength(2);
    expect(comparisonUserPrompt).toContain('"targetContexts"');
    expect(comparisonUserPrompt).toContain('"conditional_choice_scope"');
  });

  it("keeps comparison marker scope for 11より12がいい without turning it into availability", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("11より12がいい", candidates);
    const targetTokenIndex = findTokenIndex(executionInput, { label: "target_numeric_candidate", text: /12/ });
    const comparisonMarkerIndex = findTokenIndex(executionInput, { label: "comparison_marker", text: /より/ });
    const leftTargetGroupId = findTargetGroupId(executionInput, ["11"]);

    const { result, debugGraph } = await runSubmissionScenario({
      comment: "11より12がいい",
      candidates,
      buildAttachmentOutput: (input) => {
        const day11Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "11" });
        const day12Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "12" });
        const betterId = findAttachmentCandidateId(input, { label: "preference_positive_marker", text: /がいい/ });

        return {
          attachments: [
            { type: "preference_target", sourceId: betterId, targetId: day12Id, confidence: 0.95 },
            { type: "comparison_scope", sourceId: betterId, targetIds: [day11Id], confidence: 0.9 },
          ],
          features: [],
          unresolved: [],
        };
      },
    });

    expect(result.parsedConstraints).toEqual([]);
    expect(result.autoInterpretation.targetContexts?.[0]).toMatchObject({
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
    const targetTokenIndex = findTokenIndex(executionInput, { label: "target_numeric_candidate", text: /11/ });
    const modifierTokenIndex = findTokenIndex(executionInput, { label: "conditional_marker", text: /なら/ });

    const { result, debugGraph } = await runSubmissionScenario({
      comment: "11なら行ける",
      candidates,
      buildAttachmentOutput: (input) => {
        const day11Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "11" });
        const availableId = findAttachmentCandidateId(input, { label: "availability_positive", text: /行ける/ });
        const conditionalId = findAttachmentCandidateId(input, { label: "conditional_marker", text: /なら/ });

        return {
          attachments: [
            { type: "availability_target", sourceId: availableId, targetId: day11Id, confidence: 0.98 },
            { type: "modifier_predicate", sourceId: conditionalId, targetId: availableId, confidence: 0.92 },
          ],
          features: [],
          unresolved: [],
        };
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
    expect(result.autoInterpretation.targetContexts).toBeUndefined();
    expect(debugGraph.attachments).toHaveLength(2);
  });

  it("keeps existing negative availability and adds comparison-candidate context for 11は無理、12の方がいい", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("11は無理、12の方がいい", candidates);
    const negativeTargetTokenIndex = findTokenIndex(executionInput, { label: "target_numeric_candidate", text: /11/ });
    const preferredTargetTokenIndex = findTokenIndex(executionInput, { label: "target_numeric_candidate", text: /12/ });
    const comparisonMarkerIndex = findTokenIndex(executionInput, { label: "comparison_marker", text: /方が/ });
    const negativeTargetGroupId = findTargetGroupId(executionInput, ["11"]);

    const { result, debugGraph, comparisonUserPrompt } = await runSubmissionScenario({
      comment: "11は無理、12の方がいい",
      candidates,
      buildAttachmentOutput: (input) => {
        const day11Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "11" });
        const day12Id = findAttachmentCandidateId(input, { label: "target_numeric_candidate", text: "12" });
        const impossibleId = findAttachmentCandidateId(input, { label: "availability_negative", text: /無理/ });
        const betterId = findAttachmentCandidateId(input, { label: "preference_positive_marker", text: /がいい/ });

        return {
          attachments: [
            { type: "availability_target", sourceId: impossibleId, targetId: day11Id, confidence: 0.98 },
            { type: "preference_target", sourceId: betterId, targetId: day12Id, confidence: 0.95 },
            { type: "comparison_scope", sourceId: betterId, targetIds: [day11Id], confidence: 0.9 },
          ],
          features: [],
          unresolved: [],
        };
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
    expect(result.autoInterpretation.targetContexts?.[0]).toMatchObject({
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
    expect(comparisonUserPrompt).toContain('"availabilityRules"');
    expect(comparisonUserPrompt).toContain('"availability_negative"');
  });
});
