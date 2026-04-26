import { describe, expect, it, vi } from "vitest";
import {
  buildAvailabilityInterpretationExecutionInput,
  buildAvailabilityInterpretationExecutionInputForGroupingHypothesis,
  buildAvailabilityInterpretationExecutionInputFromLabeledComment,
  buildDerivedResponseFromAvailabilityInterpretation,
} from "@/lib/availability-comment-interpretation";
import {
  buildComparisonPreferenceInterpretationInput,
} from "@/lib/comparison-preference-interpretation";
import {
  interpretAvailabilityCommentSubmissionWithOllama,
  interpretAvailabilityCommentWithOllama,
} from "@/lib/availability-comment-interpretation-server";
import {
  applyLlmLabelCompletion,
  extractUnlabeledSegments,
  labelCommentText,
  toAttachmentResolutionInputFromLabeledComment,
  type CommentLabelCompletionOutput,
} from "@/lib/comment-labeler";
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

function buildDiscreteDayCandidates(days: number[], timeSlotKey: "all_day" | "day" | "night" = "all_day"): EventCandidateRecord[] {
  return days.map((day, index) => ({
    id: `candidate-${day}-${timeSlotKey}`,
    eventId: "event-april",
    date: `2026-04-${String(day).padStart(2, "0")}`,
    timeSlotKey,
    selectionMode: "range",
    dateType: "single",
    startDate: `2026-04-${String(day).padStart(2, "0")}`,
    endDate: `2026-04-${String(day).padStart(2, "0")}`,
    selectedDates: [],
    timeType: timeSlotKey === "all_day" ? "all_day" : "fixed",
    startTime: timeSlotKey === "night" ? "18:00" : timeSlotKey === "day" ? "12:00" : null,
    endTime: timeSlotKey === "night" ? "22:00" : timeSlotKey === "day" ? "17:00" : null,
    note: null,
    sortOrder: index + 1,
  }));
}

function buildRangeCandidate(
  startDay: number,
  endDay: number,
  timeSlotKey: "all_day" | "unspecified" | "night" = "all_day",
): EventCandidateRecord[] {
  return [
    {
      id: `candidate-range-${startDay}-${endDay}-${timeSlotKey}`,
      eventId: "event-april",
      date: `2026-04-${String(startDay).padStart(2, "0")}`,
      timeSlotKey,
      selectionMode: "range",
      dateType: startDay === endDay ? "single" : "range",
      startDate: `2026-04-${String(startDay).padStart(2, "0")}`,
      endDate: `2026-04-${String(endDay).padStart(2, "0")}`,
      selectedDates: [],
      timeType: timeSlotKey === "all_day" ? "all_day" : timeSlotKey === "unspecified" ? "unspecified" : "fixed",
      startTime: timeSlotKey === "night" ? "18:00" : null,
      endTime: timeSlotKey === "night" ? "22:00" : null,
      note: null,
      sortOrder: 1,
    },
  ];
}

function buildFixedTimeCandidates(
  entries: Array<{
    day: number;
    timeSlotKey: "morning" | "day" | "night";
  }>,
): EventCandidateRecord[] {
  return entries.map((entry, index) => ({
    id: `candidate-${entry.day}-${entry.timeSlotKey}`,
    eventId: "event-april",
    date: `2026-04-${String(entry.day).padStart(2, "0")}`,
    timeSlotKey: entry.timeSlotKey,
    selectionMode: "range",
    dateType: "single",
    startDate: `2026-04-${String(entry.day).padStart(2, "0")}`,
    endDate: `2026-04-${String(entry.day).padStart(2, "0")}`,
    selectedDates: [],
    timeType: "fixed",
    startTime: entry.timeSlotKey === "morning" ? "09:00" : entry.timeSlotKey === "day" ? "13:00" : "18:00",
    endTime: entry.timeSlotKey === "morning" ? "12:00" : entry.timeSlotKey === "day" ? "17:00" : "22:00",
    note: null,
    sortOrder: index + 1,
  }));
}

function findClauseTargetGroupId(
  comment: string,
  candidates: EventCandidateRecord[],
  clausePattern: RegExp,
  hypothesisId: string,
  expectedTexts: string[],
) {
  const input = buildComparisonPreferenceInterpretationInput(comment, candidates);
  const clause = input.relevantClauses.find((candidate) => clausePattern.test(candidate.text));

  if (!clause) {
    throw new Error(`Relevant clause not found for ${String(clausePattern)} in "${comment}"`);
  }

  const hypothesis = clause.groupingHypotheses.find((candidate) => candidate.hypothesisId === hypothesisId);

  if (!hypothesis) {
    throw new Error(`Hypothesis ${hypothesisId} not found for clause "${clause.text}"`);
  }

  const targetGroup = hypothesis.targetGroups.find(
    (candidate) => JSON.stringify(candidate.texts) === JSON.stringify(expectedTexts),
  );

  if (!targetGroup) {
    throw new Error(
      `Target group ${JSON.stringify(expectedTexts)} not found in hypothesis ${hypothesisId} for clause "${clause.text}"`,
    );
  }

  return targetGroup.id;
}

function findComparisonTriggerTokenIndex(
  comment: string,
  candidates: EventCandidateRecord[],
  options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
  },
) {
  const input = buildComparisonPreferenceInterpretationInput(comment, candidates);
  const matches = input.tokens.filter((token) => {
    const labelMatch = !options.label || token.label === options.label;
    const textMatch =
      !options.text ||
      (typeof options.text === "string" ? token.text === options.text : options.text.test(token.text));

    return labelMatch && textMatch;
  });
  const match = matches[options.nth ?? 0];

  if (!match) {
    throw new Error(
      `Token not found for label=${String(options.label)} text=${String(options.text)} nth=${String(options.nth ?? 0)} in "${comment}"`,
    );
  }

  return match.index;
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

function mockOllamaResponse(payload: unknown) {
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

function buildCompletedLabeledComment(
  comment: string,
  candidates: EventCandidateRecord[],
  resolveLabels: (segmentText: string) => string[],
) {
  const eventDateRange =
    candidates.length > 0
      ? {
          startDate: candidates[0]!.startDate,
          endDate: candidates[0]!.endDate,
        }
      : undefined;
  const base = labelCommentText(comment, eventDateRange ? { eventDateRange } : undefined);
  const completionOutput = {
    segments: extractUnlabeledSegments(base).map((segment) => ({
      segmentId: segment.segmentId,
      text: segment.text,
      labels: resolveLabels(segment.text),
    })),
  } satisfies CommentLabelCompletionOutput;

  return applyLlmLabelCompletion(base, completionOutput);
}

function isAttachmentResolutionRequest(body: ReturnType<typeof parseMockOllamaBody>) {
  const properties = body.format?.properties ?? {};
  return (
    Object.prototype.hasOwnProperty.call(properties, "attachments") &&
    Object.prototype.hasOwnProperty.call(properties, "features") &&
    Object.prototype.hasOwnProperty.call(properties, "unresolved")
  );
}

function buildAttachmentInputForComment(
  comment: string,
  candidates: EventCandidateRecord[],
  resolveLabels: (segmentText: string) => string[] = () => ["none"],
) {
  return toAttachmentResolutionInputFromLabeledComment(
    buildCompletedLabeledComment(comment, candidates, resolveLabels),
  );
}

function findAttachmentCandidateId(
  input: ReturnType<typeof buildAttachmentInputForComment>,
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

function buildSingleTargetPreferencePayload(args: {
  comment: string;
  candidates: EventCandidateRecord[];
  expectedTexts: string[];
  level: "preferred" | "strong_preferred" | "avoid";
  clausePattern?: RegExp;
  notes?: string | null;
}) {
  const input = buildComparisonPreferenceInterpretationInput(args.comment, args.candidates);
  const clause =
    input.relevantClauses.find((candidate) => (args.clausePattern ?? /[\s\S]+/u).test(candidate.text)) ??
    input.relevantClauses[0];

  if (!clause) {
    throw new Error(`Relevant clause not found for "${args.comment}"`);
  }

  const hypothesis = clause.groupingHypotheses.find((candidate) => candidate.hypothesisId === "gh-default") ?? clause.groupingHypotheses[0];

  if (!hypothesis) {
    throw new Error(`Grouping hypothesis not found for "${args.comment}"`);
  }

  const targetGroup = hypothesis.targetGroups.find(
    (candidate) => JSON.stringify(candidate.texts) === JSON.stringify(args.expectedTexts),
  );

  if (!targetGroup) {
    throw new Error(
      `Target group ${JSON.stringify(args.expectedTexts)} not found for "${args.comment}" under hypothesis ${hypothesis.hypothesisId}`,
    );
  }

  const triggerTokenIndexes = clause.triggerTokenIndexes.length > 0 ? clause.triggerTokenIndexes : [clause.tokenIndexes[0]!];
  const isAvoid = args.level === "avoid";

  return {
    judgments: [
      {
        groupingHypothesisId: hypothesis.hypothesisId,
        kind: "preference",
        comparedTargetGroupIds: [targetGroup.id],
        preferredTargetGroupId: isAvoid ? null : targetGroup.id,
        dispreferredTargetGroupIds: isAvoid ? [targetGroup.id] : [],
        relation: isAvoid ? "less_preferred" : "preferred",
        strength: args.level === "strong_preferred" ? "strong" : "weak",
        confidence: "high",
        triggerTokenIndexes,
        supportingClauseIndexes: [clause.clauseIndex],
        notes: args.notes ?? null,
      },
    ],
    warnings: [],
  };
}

describe("availability comment auto interpretation", () => {
  it("builds grouping input, calls Ollama, validates the graph, and produces structured rules", async () => {
    const attachmentInput = buildAttachmentInputForComment("5日はたぶんいける、6日は無理ではない", buildCandidates());
    const dayFiveId = findAttachmentCandidateId(attachmentInput, { label: "target_date", text: /5/ });
    const daySixId = findAttachmentCandidateId(attachmentInput, { label: "target_date", text: /6/ });
    const maybeId = findAttachmentCandidateId(attachmentInput, { label: "uncertainty_marker", text: /たぶん/ });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いける/ });
    const notImpossibleId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /無理ではない/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: availableId,
                targetId: dayFiveId,
                confidence: 0.97,
              },
              {
                type: "modifier_predicate",
                sourceId: maybeId,
                targetId: availableId,
                confidence: 0.92,
              },
              {
                type: "availability_target",
                sourceId: notImpossibleId,
                targetId: daySixId,
                confidence: 0.95,
              },
            ],
            features: [
              {
                type: "uncertainty_mode",
                sourceId: maybeId,
                value: "plain_uncertainty",
              },
            ],
            unresolved: [],
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
    expect(body.messages[0]?.content).toContain("候補どうしの係り受けだけ");
    expect(body.messages[0]?.content).toContain("新しい日付、新しい可否、新しい理由、新しい希望を作ってはいけません。");
    expect(body.messages[1]?.content).toContain('"comment": "5日はたぶんいける、6日は無理ではない"');
    expect(body.messages[1]?.content).toContain('"label": "availability_positive"');

    expect(result.status).toBe("success");
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]).toMatchObject({
      targetText: "5日",
      availabilityText: "いける",
      modifierTexts: ["たぶん"],
    });
    expect(result.rules[1]).toMatchObject({
      targetText: "6日",
      availabilityText: "無理ではない",
    });
  });

  it("builds submission-ready answers and parsed constraints from the validated auto graph", async () => {
    const attachmentInput = buildAttachmentInputForComment("5日は無理", buildCandidates());
    const dayFiveId = findAttachmentCandidateId(attachmentInput, { label: "target_date", text: /5/ });
    const impossibleId = findAttachmentCandidateId(attachmentInput, { label: "availability_negative", text: /無理/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: impossibleId,
                targetId: dayFiveId,
                confidence: 0.97,
              },
            ],
            features: [],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("5日は無理", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.usedDefault).toBe(false);
    expect(result.defaultReason).toBeNull();
    expect(result.parsedConstraints).toHaveLength(1);
    expect(result.parsedConstraints[0]).toMatchObject({
      level: "hard_no",
      source: "auto_llm",
      reasonText: "5日は無理",
    });
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]?.availabilityKey).toBe("no");
  });

  it("treats 12ならいける as conditional availability without using condition_for", async () => {
    const attachmentInput = buildAttachmentInputForComment("12ならいける", buildDiscreteDayCandidates([12]));
    const dayTwelveId = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: /12/ });
    const conditionalId = findAttachmentCandidateId(attachmentInput, { label: "conditional_marker", text: /なら/ });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いける/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: availableId,
                targetId: dayTwelveId,
                confidence: 0.97,
              },
              {
                type: "modifier_predicate",
                sourceId: conditionalId,
                targetId: availableId,
                confidence: 0.93,
              },
            ],
            features: [
              {
                type: "uncertainty_mode",
                sourceId: conditionalId,
                value: "condition_like",
              },
            ],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("12ならいける", buildDiscreteDayCandidates([12]), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules[0]).toMatchObject({
      targetText: "12",
      availabilityText: "いける",
      modifierLabels: ["conditional_marker"],
    });
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({
        targetValue: "2026-04-12",
        level: "conditional",
      }),
    ]);
  });

  it("keeps residual interpretation tied to prior target groups only when the graph is explicit", async () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "平日は無理、5日は午前が無理、あとはいける",
      buildCandidates(),
    );
    const weekdayIndex = findTokenIndex(executionInput, { label: "target_weekday_group", text: /平日/ });
    const dayFiveIndex = findTokenIndex(executionInput, { label: "target_date", text: /5/ });
    const morningIndex = findTokenIndex(executionInput, { label: "target_time_of_day", text: /午前/ });
    const residualIndex = findTokenIndex(executionInput, { label: "scope_residual" });
    const positiveIndex = findTokenIndex(executionInput, { label: "availability_positive", text: /いける/ });
    const negativeIndexes = [
      findTokenIndex(executionInput, { label: "availability_negative", text: /無理/, nth: 0 }),
      findTokenIndex(executionInput, { label: "availability_negative", text: /無理/, nth: 1 }),
    ];
    const residualMarkers = executionInput.tokens
      .filter((token) => token.index < residualIndex && (token.label === "punctuation_boundary" || token.label === "conjunction_parallel"))
      .slice(-2)
      .map((token) => token.index);
    const attachmentInput = buildAttachmentInputForComment(
      "平日は無理、5日は午前が無理、あとはいける",
      buildCandidates(),
    );
    const weekdayId = findAttachmentCandidateId(attachmentInput, { label: "target_weekday_group", text: /平日/ });
    const morningId = findAttachmentCandidateId(attachmentInput, { label: "target_time_of_day", text: /午前/ });
    const firstNegativeId = findAttachmentCandidateId(attachmentInput, { label: "availability_negative", text: /無理/, nth: 0 });
    const secondNegativeId = findAttachmentCandidateId(attachmentInput, { label: "availability_negative", text: /無理/, nth: 1 });
    const positiveId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いける/ });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: firstNegativeId,
                targetId: weekdayId,
                confidence: 0.98,
              },
              {
                type: "availability_target",
                sourceId: secondNegativeId,
                targetId: morningId,
                confidence: 0.98,
              },
              {
                type: "clause_relation",
                sourceId: positiveId,
                targetId: secondNegativeId,
                relationKind: "residual",
                confidence: 0.82,
              },
            ],
            features: [],
            unresolved: [],
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
    expect(result.rules[2]?.residualOfTokenIndexes).toEqual(
      expect.arrayContaining([weekdayIndex, dayFiveIndex, morningIndex]),
    );
    expect(result.rules[2]?.notes?.some((note) => /平日/.test(note) && /5日/.test(note) && /午前/.test(note))).toBe(
      true,
    );
  });

  it("keeps prior target context for residual clauses even across sentence boundaries", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "10〜13は無理です。12日の夜ならいけます。それ以外は大丈夫です。",
      buildRangeCandidate(1, 20),
    );
    const residualClause = executionInput.grouping.clauseGroups.find((group) =>
      group.appliesToTargetTokenIndexes.some((tokenIndex) => executionInput.tokens[tokenIndex]?.label === "scope_residual"),
    );

    expect(residualClause?.appliesToTargetTokenIndexes).toEqual([12]);
    expect(residualClause?.contextTargetGroups).toEqual([
      { id: "tg1", tokenIndexes: [0] },
      { id: "tg2", tokenIndexes: [5, 7] },
    ]);
  });

  it("canonicalizes residual clauses when the model omits residual_of for a clear prior target set", async () => {
    const candidates = [
      ...buildDiscreteDayCandidates([10, 11, 12, 13, 14], "all_day"),
      ...buildDiscreteDayCandidates([12], "night"),
    ];
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "10〜13は無理です。ただ、12日の夜ならいけます。それ以外は大丈夫です。",
      candidates,
    );
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);
      const properties = body.format?.properties ?? {};

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(buildLabelCompletionPayloadFromRequest(body, () => ["none"]));
      }

      if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
        return mockOllamaResponse({ judgments: [], warnings: [] });
      }

      const attachmentInput = parseStructuredInputFromUserPrompt<ReturnType<typeof buildAttachmentInputForComment>>(body);
      const rangeId = findAttachmentCandidateId(attachmentInput, { label: "target_date_range", text: /10〜13/ });
      const nightId = findAttachmentCandidateId(attachmentInput, { label: "target_time_of_day", text: /夜/ });
      const negativeId = findAttachmentCandidateId(attachmentInput, { label: "availability_negative", text: /無理/ });
      const positiveThenId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いけます/ });

      return mockOllamaResponse({
        attachments: [
          {
            type: "availability_target",
            sourceId: negativeId,
            targetId: rangeId,
            confidence: 0.98,
          },
          {
            type: "availability_target",
            sourceId: positiveThenId,
            targetId: nightId,
            confidence: 0.95,
          },
        ],
        features: [],
        unresolved: [],
      });
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(
      "10〜13は無理です。ただ、12日の夜ならいけます。それ以外は大丈夫です。",
      candidates,
      {
        fetchImpl: fetchMock as typeof fetch,
        model: "mock-model",
      },
    );

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(3);
    expect(result.autoInterpretation.rules[2]?.targetText).toBe("それ以外は");
    expect(result.autoInterpretation.rules[2]?.residualOfTokenIndexes).toEqual([0, 7, 9]);
    expect(result.parsedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetValue: "2026-04-10", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-11", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-12", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-13", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-12_night", level: "conditional" }),
        expect.objectContaining({ targetValue: "2026-04-14", level: "strong_yes" }),
      ]),
    );
  });

  it("builds grouping hypotheses for mixed-separator date lists", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "行ける日は11,12、13,14だけ",
      buildRangeCandidate(1, 20),
    );

    expect(executionInput.grouping.targetGroups.map((group) => group.tokenIndexes)).toEqual([[2], [4], [6], [8]]);
    expect(executionInput.groupingHypotheses).toHaveLength(5);
    expect(
      executionInput.groupingHypotheses.some(
        (hypothesis) =>
          hypothesis.kind === "merge_list_cluster" &&
          hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "2,4,6,8"),
      ),
    ).toBe(true);
    expect(
      executionInput.groupingHypotheses.some(
        (hypothesis) =>
          hypothesis.kind === "split_list_cluster" &&
          hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "2,4") &&
          hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "6,8"),
      ),
    ).toBe(true);
  });

  it("can anchor an availability clause to a selected post-predicate target group", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput(
      "行ける日は11,12、13,14だけ",
      buildRangeCandidate(1, 20),
    );
    const splitHypothesis = executionInput.groupingHypotheses.find(
      (hypothesis) =>
        hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "2,4") &&
        hypothesis.grouping.targetGroups.some((group) => group.tokenIndexes.join(",") === "6,8"),
    );
    const selected = buildAvailabilityInterpretationExecutionInputForGroupingHypothesis(
      executionInput,
      splitHypothesis?.id ?? null,
    );

    expect(selected.grouping.clauseGroups[0]?.appliesToTargetTokenIndexes).toEqual([2, 4]);
  });

  it("selects a grouping hypothesis before relation generation when alternatives exist", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12, 13, 14]);
    const attachmentInput = buildAttachmentInputForComment(
      "行ける日は11,12、13,14は無理",
      candidates,
    );
    const day11Id = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: "11" });
    const day12Id = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: "12" });
    const day13Id = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: "13" });
    const day14Id = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: "14" });
    const positiveId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /行ける/ });
    const negativeId = findAttachmentCandidateId(attachmentInput, { label: "availability_negative", text: /無理/ });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);
      const properties = body.format?.properties ?? {};

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(buildLabelCompletionPayloadFromRequest(body, () => ["none"]));
      }

      return mockOllamaResponse({
        attachments: [
          {
            type: "availability_target",
            sourceId: positiveId,
            targetId: day11Id,
            confidence: 0.95,
          },
          {
            type: "availability_target",
            sourceId: positiveId,
            targetId: day12Id,
            confidence: 0.95,
          },
          {
            type: "availability_target",
            sourceId: negativeId,
            targetId: day13Id,
            confidence: 0.95,
          },
          {
            type: "availability_target",
            sourceId: negativeId,
            targetId: day14Id,
            confidence: 0.95,
          },
        ],
        features: [],
        unresolved: [],
      });
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(
      "行ける日は11,12、13,14は無理",
      candidates,
      {
        fetchImpl: fetchMock as typeof fetch,
        model: "mock-model",
      },
    );

    expect(result.autoInterpretation.rules).toHaveLength(4);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.autoInterpretation.status).toBe("success");
    expect(result.parsedConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetValue: "2026-04-11", level: "strong_yes" }),
        expect.objectContaining({ targetValue: "2026-04-12", level: "strong_yes" }),
        expect.objectContaining({ targetValue: "2026-04-13", level: "hard_no" }),
        expect.objectContaining({ targetValue: "2026-04-14", level: "hard_no" }),
      ]),
    );
  });

  it("canonicalizes dropped semantic modifiers onto applies_to before validation", async () => {
    const attachmentInput = buildAttachmentInputForComment("5日はたぶんいける、6日は無理ではない", buildCandidates());
    const dayFiveId = findAttachmentCandidateId(attachmentInput, { label: "target_date", text: /5/ });
    const daySixId = findAttachmentCandidateId(attachmentInput, { label: "target_date", text: /6/ });
    const maybeId = findAttachmentCandidateId(attachmentInput, { label: "uncertainty_marker", text: /たぶん/ });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いける/ });
    const notImpossibleId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /無理ではない/ });
    const fetchMock = vi.fn().mockResolvedValue(
      mockOllamaResponse({
        attachments: [
          {
            type: "availability_target",
            sourceId: availableId,
            targetId: dayFiveId,
            confidence: 0.97,
          },
          {
            type: "modifier_predicate",
            sourceId: maybeId,
            targetId: availableId,
            confidence: 0.9,
          },
          {
            type: "availability_target",
            sourceId: notImpossibleId,
            targetId: daySixId,
            confidence: 0.96,
          },
        ],
        features: [],
        unresolved: [],
      }),
    );

    const result = await interpretAvailabilityCommentWithOllama("5日はたぶんいける、6日は無理ではない", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
    expect(result.rules[0]?.modifierTexts).toEqual(["たぶん"]);
  });

  it("deduplicates identical applies_to links before building UI rules", async () => {
    const attachmentInput = buildAttachmentInputForComment("18日はたぶんいける", buildCandidates());
    const day18Id = findAttachmentCandidateId(attachmentInput, { label: "target_date", text: /18/ });
    const maybeId = findAttachmentCandidateId(attachmentInput, { label: "uncertainty_marker", text: /たぶん/ });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いける/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: availableId,
                targetId: day18Id,
                confidence: 0.97,
              },
              {
                type: "availability_target",
                sourceId: availableId,
                targetId: day18Id,
                confidence: 0.97,
              },
            ],
            features: [],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("18日はたぶんいける", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.status).toBe("success");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      targetText: "18日",
      availabilityText: "いける",
      modifierTexts: ["たぶん"],
    });
  });

  it("canonicalizes flattened exception clauses into scope applies_to and exception_to", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(buildLabelCompletionPayloadFromRequest(body, () => ["none"]));
      }

      return mockOllamaResponse({
        attachments: [],
        features: [],
        unresolved: [],
      });
    });

    const result = await interpretAvailabilityCommentWithOllama("金曜の夜以外はいける", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
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
            attachments: [
              {
                type: "unsupported_relation",
                sourceId: "a1",
                targetId: "t1",
                confidence: 0.9,
              },
            ],
            features: [],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("平日ならいけるけど金曜は厳しい", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toContain("attachment type is unsupported");
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

  it("keeps safe bare numeric targets for availability, limit, and exception clauses", () => {
    const conditional = buildAvailabilityInterpretationExecutionInput("10ならいける", buildCandidates());
    const limited = buildAvailabilityInterpretationExecutionInput("10だけいける", buildCandidates());
    const exceptive = buildAvailabilityInterpretationExecutionInput("10以外無理", buildCandidates());

    expect(conditional.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10", "target_numeric_candidate"],
      [1, "なら", "conditional_marker"],
      [2, "なら", "particle_condition"],
      [3, "いける", "availability_positive"],
    ]);
    expect(conditional.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0] }]);

    expect(limited.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10", "target_numeric_candidate"],
      [1, "だけ", "particle_limit"],
      [2, "いける", "availability_positive"],
    ]);
    expect(limited.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0] }]);

    expect(exceptive.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10", "target_numeric_candidate"],
      [1, "以外", "scope_exception"],
      [2, "無理", "availability_negative"],
    ]);
    expect(exceptive.grouping.exceptionScopeGroups).toEqual([{ id: "eg1", tokenIndexes: [1] }]);
  });

  it("keeps bare numeric date targets attached when a time-of-day target is also present", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput("10は昼ならいける", buildCandidates());

    expect(executionInput.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10", "target_numeric_candidate"],
      [1, "は", "particle_topic"],
      [2, "昼", "target_time_of_day"],
      [3, "なら", "conditional_marker"],
      [4, "なら", "particle_condition"],
      [5, "いける", "availability_positive"],
    ]);
    expect(executionInput.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0, 2] }]);
  });

  it("builds LLM-derived preferences from richer desire markers without converting them to availability", async () => {
    const candidates = buildDiscreteDayCandidates([10, 12]);
    const idealFetchMock = vi.fn().mockResolvedValue(
      mockOllamaResponse(
        buildSingleTargetPreferencePayload({
          comment: "10が理想",
          candidates,
          expectedTexts: ["10"],
          level: "strong_preferred",
        }),
      ),
    );
    const ideal = await interpretAvailabilityCommentSubmissionWithOllama("10が理想", candidates, {
      fetchImpl: idealFetchMock as typeof fetch,
      model: "mock-model",
    });
    const helpfulFetchMock = vi.fn().mockResolvedValue(
      mockOllamaResponse(
        buildSingleTargetPreferencePayload({
          comment: "10だと助かる",
          candidates,
          expectedTexts: ["10"],
          level: "preferred",
        }),
      ),
    );
    const helpful = await interpretAvailabilityCommentSubmissionWithOllama("10だと助かる", candidates, {
      fetchImpl: helpfulFetchMock as typeof fetch,
      model: "mock-model",
    });
    const possibleFetchMock = vi.fn().mockResolvedValue(
      mockOllamaResponse(
        buildSingleTargetPreferencePayload({
          comment: "可能なら10",
          candidates,
          expectedTexts: ["10"],
          level: "preferred",
        }),
      ),
    );
    const possible = await interpretAvailabilityCommentSubmissionWithOllama("可能なら10", candidates, {
      fetchImpl: possibleFetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(ideal.autoInterpretation.status).toBe("failed");
    expect(ideal.autoInterpretation.rules).toHaveLength(0);
    expect(ideal.autoInterpretation.preferences[0]).toMatchObject({
      targetText: "10",
      level: "strong_preferred",
    });
    expect(ideal.parsedConstraints).toEqual([]);
    expect(ideal.usedDefault).toBe(true);

    expect(helpful.autoInterpretation.preferences[0]).toMatchObject({
      targetText: "10",
      level: "preferred",
    });
    expect(helpful.parsedConstraints).toEqual([]);

    expect(possible.autoInterpretation.preferences[0]).toMatchObject({
      targetText: "10",
      level: "preferred",
    });
    expect(possible.parsedConstraints).toEqual([]);
  });

  it("expands bare numeric exception clauses without inventing a direct negative on the excluded day", () => {
    const candidates = buildDiscreteDayCandidates([9, 10, 11]);
    const executionInput = buildAvailabilityInterpretationExecutionInput("10以外無理", candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.exceptionScopeGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
          {
            relation: "exception_to",
            sourceTokenIndexes: executionInput.grouping.exceptionScopeGroups[0]!.tokenIndexes,
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(derived.usedDefault).toBe(false);
    expect(derived.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual(["2026-04-09", "2026-04-11"]);
    expect(derived.parsedConstraints.every((constraint) => constraint.level === "hard_no")).toBe(true);
  });

  it("does not collapse multiple explicit slash dates onto the candidate start date", () => {
    const candidates = buildCandidates();
    const executionInput = buildAvailabilityInterpretationExecutionInput("4/8は 4/9は 行ける", candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(derived.usedDefault).toBe(false);
    expect(derived.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual(["2026-04-08", "2026-04-09"]);
    expect(derived.answers[0]?.selectedDates).toEqual(["2026-04-08", "2026-04-09"]);
  });

  it("keeps a single slash date as that exact day instead of the month start", () => {
    const candidates = buildCandidates();
    const executionInput = buildAvailabilityInterpretationExecutionInput("4/10はいけます", candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(derived.parsedConstraints[0]?.targetValue).toBe("2026-04-10");
    expect(derived.parsedConstraints[0]?.targetValue).not.toBe("2026-04-01");
  });

  it("keeps a zero-padded slash date as that exact day instead of the month start", () => {
    const candidates = buildCandidates();
    const executionInput = buildAvailabilityInterpretationExecutionInput("04/12は無理", candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(derived.parsedConstraints[0]).toMatchObject({
      targetValue: "2026-04-12",
      level: "hard_no",
    });
  });

  it("keeps month-day and day-only dates on their matched day instead of the month start", () => {
    const candidates = buildCandidates();
    const monthDayExecutionInput = buildAvailabilityInterpretationExecutionInput("4月8日いける", candidates);
    const monthDayDerived = buildDerivedResponseFromAvailabilityInterpretation(
      monthDayExecutionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: monthDayExecutionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: monthDayExecutionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );
    const dayOnlyExecutionInput = buildAvailabilityInterpretationExecutionInput("8日いける", candidates);
    const dayOnlyDerived = buildDerivedResponseFromAvailabilityInterpretation(
      dayOnlyExecutionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: dayOnlyExecutionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: dayOnlyExecutionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      candidates,
    );

    expect(monthDayDerived.parsedConstraints[0]?.targetValue).toBe("2026-04-08");
    expect(dayOnlyDerived.parsedConstraints[0]?.targetValue).toBe("2026-04-08");
    expect(monthDayDerived.parsedConstraints[0]?.targetValue).not.toBe("2026-04-01");
    expect(dayOnlyDerived.parsedConstraints[0]?.targetValue).not.toBe("2026-04-01");
  });

  it("keeps day-range targets and time-of-day targets together for range clauses", () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput("10-13の夜ならいけます", buildDiscreteDayCandidates([10, 11, 12, 13], "night"));

    expect(executionInput.tokens.map((token) => [token.index, token.text, token.label])).toEqual([
      [0, "10-13", "target_date_range"],
      [1, "の", "particle_link"],
      [2, "夜", "target_time_of_day"],
      [3, "なら", "conditional_marker"],
      [4, "なら", "particle_condition"],
      [5, "いけます", "availability_positive"],
    ]);
    expect(executionInput.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0, 2] }]);
  });

  it("expands a date-range applies_to into all matched candidate dates", async () => {
    const candidates = buildDiscreteDayCandidates([10, 11, 12, 13], "night");
    const attachmentInput = buildAttachmentInputForComment("10-13の夜ならいけます", candidates);
    const rangeId = findAttachmentCandidateId(attachmentInput, { label: "target_date_range", text: /10-13/ });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いけます/ });
    const conditionalId = findAttachmentCandidateId(attachmentInput, { label: "conditional_marker", text: /なら/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: availableId,
                targetId: rangeId,
                confidence: 0.98,
              },
            ],
            features: [],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("10-13の夜ならいけます", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.parsedConstraints).toHaveLength(4);
    expect(result.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual([
      "2026-04-10_night",
      "2026-04-11_night",
      "2026-04-12_night",
      "2026-04-13_night",
    ]);
  });

  it("keeps concrete time-of-day targets when a range candidate uses unspecified time", async () => {
    const candidates = buildRangeCandidate(10, 13, "unspecified");
    const attachmentInput = buildAttachmentInputForComment("10-13の夜ならいけます", candidates);
    const rangeId = findAttachmentCandidateId(attachmentInput, { label: "target_date_range", text: /10-13/ });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いけます/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: availableId,
                targetId: rangeId,
                confidence: 0.98,
              },
            ],
            features: [],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("10-13の夜ならいけます", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual([
      "2026-04-10_night",
      "2026-04-11_night",
      "2026-04-12_night",
      "2026-04-13_night",
    ]);
  });

  it("expands a negative date-range applies_to into all matched candidate dates", async () => {
    const candidates = buildDiscreteDayCandidates([10, 11, 12, 13]);
    const attachmentInput = buildAttachmentInputForComment("10〜13は無理です", candidates);
    const rangeId = findAttachmentCandidateId(attachmentInput, { label: "target_date_range", text: /10〜13/ });
    const impossibleId = findAttachmentCandidateId(attachmentInput, { label: "availability_negative", text: /無理/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: impossibleId,
                targetId: rangeId,
                confidence: 0.98,
              },
            ],
            features: [],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("10〜13は無理です", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.parsedConstraints).toHaveLength(4);
    expect(result.parsedConstraints.every((constraint) => constraint.level === "hard_no")).toBe(true);
    expect(result.parsedConstraints.map((constraint) => constraint.targetValue)).toEqual([
      "2026-04-10",
      "2026-04-11",
      "2026-04-12",
      "2026-04-13",
    ]);
  });

  it("does not invent a complement when only one side of a month-part statement is explicit", async () => {
    const attachmentInput = buildAttachmentInputForComment("前半はきついです", buildCandidates());
    const monthPartId = findAttachmentCandidateId(attachmentInput, { label: "target_month_part", text: /前半/ });
    const negativeId = findAttachmentCandidateId(attachmentInput, { label: "availability_negative", text: /きつい/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: negativeId,
                targetId: monthPartId,
                confidence: 0.98,
              },
            ],
            features: [],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentWithOllama("前半はきついです", buildCandidates(), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.status).toBe("success");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.targetText).toBe("前半");
  });

  it("returns LLM-derived preference interpretations even when no availability token exists", async () => {
    const candidates = buildDiscreteDayCandidates([10, 11, 12]);
    const fetchMock = vi.fn().mockResolvedValue(
      mockOllamaResponse(
        buildSingleTargetPreferencePayload({
          comment: "できたら10がいいです",
          candidates,
          expectedTexts: ["10"],
          level: "preferred",
        }),
      ),
    );
    const result = await interpretAvailabilityCommentSubmissionWithOllama("できたら10がいいです", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("failed");
    expect(result.autoInterpretation.rules).toHaveLength(0);
    expect(result.autoInterpretation.preferences).toHaveLength(1);
    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText: "10",
      level: "preferred",
    });
    expect(result.parsedConstraints).toEqual([]);
    expect(result.usedDefault).toBe(true);
    expect(result.answers.every((answer) => answer.availabilityKey === "yes")).toBe(true);
  });

  it("does not deterministically finalize preference-only comments before comparison/preference LLM runs", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const fetchMock = vi.fn().mockRejectedValue(new Error("comparison-preference offline"));

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11がいい", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.rules).toEqual([]);
    expect(result.autoInterpretation.preferences).toEqual([]);
    expect(result.autoInterpretation.comparisonPreferenceSignals).toBeUndefined();
    expect(result.parsedConstraints).toEqual([]);
    expect(result.usedDefault).toBe(true);
  });

  it("keeps availability and preference separate when both are present", async () => {
    const candidates = buildDiscreteDayCandidates([10, 12]);
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);
      const properties = body.format?.properties ?? {};

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(buildLabelCompletionPayloadFromRequest(body, () => ["none"]));
      }

      if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
        return mockOllamaResponse({ judgments: [], warnings: [] });
      }

       const attachmentInput = parseStructuredInputFromUserPrompt<ReturnType<typeof buildAttachmentInputForComment>>(body);
       const date10Id = findAttachmentCandidateId(attachmentInput, { label: "target_date", text: /4\/10/ });
       const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いけます/ });

      return mockOllamaResponse({
        attachments: [
          {
            type: "availability_target",
            sourceId: availableId,
            targetId: date10Id,
            confidence: 0.98,
          },
        ],
        features: [],
        unresolved: [],
      });
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("4/10はいけますが、できれば12の方がいいです", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.preferences).toEqual([]);
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({ intent: "availability", targetValue: "2026-04-10" }),
    ]);
  });

  it("keeps availability and preference separate even when they refer to the same date", async () => {
    const candidates = buildDiscreteDayCandidates([10]);
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);
      const properties = body.format?.properties ?? {};

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(buildLabelCompletionPayloadFromRequest(body, () => ["none"]));
      }

      if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
        return mockOllamaResponse(
          buildSingleTargetPreferencePayload({
            comment: "4/10はたぶんいけます。できたら10がいいです",
            candidates,
            expectedTexts: ["10"],
            level: "preferred",
            clausePattern: /できたら10がいいです/u,
          }),
        );
      }

      const attachmentInput = parseStructuredInputFromUserPrompt<ReturnType<typeof buildAttachmentInputForComment>>(body);
      const date10Id = findAttachmentCandidateId(attachmentInput, { label: "target_date", text: /4\/10/ });
      const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いけます/ });

      return mockOllamaResponse({
        attachments: [
          {
            type: "availability_target",
            sourceId: availableId,
            targetId: date10Id,
            confidence: 0.98,
          },
        ],
        features: [],
        unresolved: [],
      });
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("4/10はたぶんいけます。できたら10がいいです", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.preferences).toHaveLength(1);
    expect(result.autoInterpretation.rules[0]).toMatchObject({
      targetText: "4/10",
      availabilityText: "いけます",
    });
    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText: "10",
      level: "preferred",
    });
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({ intent: "availability", targetValue: "2026-04-10" }),
    ]);
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]?.availabilityKey).toBe("yes");
  });

  it.each([
    { input: "11がいい", targetText: "11", level: "preferred" },
    { input: "11が第一希望", targetText: "11", level: "strong_preferred" },
    { input: "11がベスト", targetText: "11", level: "strong_preferred" },
    { input: "11だと嬉しい", targetText: "11", level: "preferred" },
    { input: "11だと助かる", targetText: "11", level: "preferred" },
    { input: "できれば11がいい", targetText: "11", level: "preferred" },
    { input: "11に行きたい", targetText: "11", level: "preferred" },
    { input: "11を優先したい", targetText: "11", level: "strong_preferred" },
    { input: "11は避けたい", targetText: "11", level: "avoid" },
    { input: "11はできれば避けたい", targetText: "11", level: "avoid" },
    { input: "11なら嬉しい", targetText: "11", level: "preferred" },
  ] as const)("lifts %s into autoInterpretation.preferences from comparison/preference LLM without emitting preference constraints", async ({ input, targetText, level }) => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const fetchMock = vi.fn().mockResolvedValue(
      mockOllamaResponse(
        buildSingleTargetPreferencePayload({
          comment: input,
          candidates,
          expectedTexts: [targetText],
          level,
        }),
      ),
    );
    const result = await interpretAvailabilityCommentSubmissionWithOllama(input, candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.preferences).toHaveLength(1);
    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText,
      level,
    });
    expect(result.parsedConstraints.some((constraint) => constraint.intent === "preference")).toBe(false);
  });

  it("keeps explicit-date-backed preference targets when the LLM returns a single-target preference judgment", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const fetchMock = vi.fn().mockResolvedValue(
      mockOllamaResponse(
        buildSingleTargetPreferencePayload({
          comment: "11を優先したい",
          candidates,
          expectedTexts: ["11"],
          level: "strong_preferred",
        }),
      ),
    );
    const result = await interpretAvailabilityCommentSubmissionWithOllama("11を優先したい", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText: "11",
      targetTokenIndexes: [],
      targetNormalizedTexts: ["2026-04-11"],
      notes: [],
    });
  });

  it("keeps unsupported soft-preference phrases out of preference structures for now", async () => {
    const results = await Promise.all(
      ["11でもいい", "11でも大丈夫", "11でも構わない"].map((input) =>
        interpretAvailabilityCommentSubmissionWithOllama(input, buildDiscreteDayCandidates([11, 12]), {
          fetchImpl: vi.fn() as typeof fetch,
          model: "mock-model",
        }),
      ),
    );

    expect(results.every((result) => (result.autoInterpretation.preferences ?? []).length === 0)).toBe(true);
  });

  it("does not promote plain availability clauses into preference structures", async () => {
    const executionInput = buildAvailabilityInterpretationExecutionInput("11ならいける", buildDiscreteDayCandidates([11]));
    const attachmentInput = buildAttachmentInputForComment("11ならいける", buildDiscreteDayCandidates([11]));
    const day11Id = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: "11" });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いける/ });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);
      const properties = body.format?.properties ?? {};

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(buildLabelCompletionPayloadFromRequest(body, () => ["none"]));
      }

      if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
        return mockOllamaResponse({ judgments: [] });
      }

      return mockOllamaResponse({
        attachments: [
          {
            type: "availability_target",
            sourceId: availableId,
            targetId: day11Id,
            confidence: 0.98,
          },
        ],
        features: [],
        unresolved: [],
      });
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11ならいける", buildDiscreteDayCandidates([11]), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(executionInput.grouping.targetGroups).toEqual([{ id: "tg1", tokenIndexes: [0] }]);
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.preferences).toEqual([]);
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({ intent: "availability", targetValue: "2026-04-11", level: "conditional" }),
    ]);
  });

  it("keeps availability and preference side by side without turning preference into parsed constraints", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const attachmentInput = buildAttachmentInputForComment("11なら行けるしありがたい", candidates);
    const day11Id = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: "11" });
    const conditionalId = findAttachmentCandidateId(attachmentInput, { label: "conditional_marker", text: /なら/ });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /行ける/ });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);
      const properties = body.format?.properties ?? {};

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(buildLabelCompletionPayloadFromRequest(body, () => ["none"]));
      }

      if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
        return mockOllamaResponse(
          buildSingleTargetPreferencePayload({
            comment: "11なら行けるしありがたい",
            candidates,
            expectedTexts: ["11"],
            level: "preferred",
            clausePattern: /11なら行けるしありがたい/u,
          }),
        );
      }

      return mockOllamaResponse({
        attachments: [
          {
            type: "availability_target",
            sourceId: availableId,
            targetId: day11Id,
            confidence: 0.98,
          },
          {
            type: "modifier_predicate",
            sourceId: conditionalId,
            targetId: availableId,
            confidence: 0.92,
          },
        ],
        features: [],
        unresolved: [],
      });
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11なら行けるしありがたい", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(result.autoInterpretation.preferences).toHaveLength(1);
    expect(result.autoInterpretation.preferences?.[0]).toMatchObject({
      targetText: "11",
      level: "preferred",
    });
    expect(result.parsedConstraints).toEqual([
      expect.objectContaining({ intent: "availability", targetValue: "2026-04-11", level: "conditional" }),
    ]);
  });

  it("pipes llm-completed reason labels into the availability interpretation request without changing dictionary labels", async () => {
    const comment = "11はバ先で無理";
    const candidates = buildDiscreteDayCandidates([11]);
    const completedLabeledComment = buildCompletedLabeledComment(comment, candidates, (segmentText) =>
      segmentText.includes("バ先") ? ["reason_marker"] : ["none"],
    );
    const attachmentInput = toAttachmentResolutionInputFromLabeledComment(completedLabeledComment);
    const targetId = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: "11" });
    const negativeId = findAttachmentCandidateId(attachmentInput, { label: "availability_negative", text: /無理/u });
    const reasonId = findAttachmentCandidateId(attachmentInput, { label: "reason_marker", text: /バ先/u });
    const attachmentPrompts: string[] = [];

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);
      const properties = body.format?.properties ?? {};
      const userPrompt = body.messages?.[1]?.content ?? "";

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(
          buildLabelCompletionPayloadFromRequest(body, (segmentText) =>
            segmentText.includes("バ先") ? ["reason_marker"] : ["none"],
          ),
        );
      }

      if (isAttachmentResolutionRequest(body)) {
        attachmentPrompts.push(userPrompt);
      }

      return mockOllamaResponse({
        attachments: [
          {
            type: "availability_target",
            sourceId: negativeId,
            targetId,
            confidence: 0.97,
          },
          {
            type: "reason_predicate",
            sourceId: reasonId,
            targetId: negativeId,
            confidence: 0.93,
          },
        ],
        features: [],
        unresolved: [],
      });
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(comment, candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.status).toBe("success");
    expect(result.autoInterpretation.rules).toHaveLength(1);
    expect(attachmentPrompts.some((prompt) => prompt.includes('"text": "バ先で"') && prompt.includes('"label": "reason_marker"'))).toBe(true);
    expect(attachmentPrompts.some((prompt) => prompt.includes('"text": "無理"') && prompt.includes('"label": "availability_negative"'))).toBe(true);
  });

  it("pipes llm-completed preference labels into the comparison-preference request without rewriting confirmed labels", async () => {
    const comment = "11がいいしハピ寄り";
    const candidates = buildDiscreteDayCandidates([11]);
    const completedLabeledComment = buildCompletedLabeledComment(comment, candidates, (segmentText) =>
      segmentText.includes("ハピ寄り") ? ["preference_positive_marker"] : ["none"],
    );
    const comparisonPrompts: string[] = [];

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = parseMockOllamaBody(init);
      const properties = body.format?.properties ?? {};
      const userPrompt = body.messages?.[1]?.content ?? "";

      if (isLabelCompletionRequest(body)) {
        return mockOllamaResponse(
          buildLabelCompletionPayloadFromRequest(body, (segmentText) =>
            segmentText.includes("ハピ寄り") ? ["preference_positive_marker"] : ["none"],
          ),
        );
      }

      if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
        comparisonPrompts.push(userPrompt);
        return mockOllamaResponse(
          buildSingleTargetPreferencePayload({
            comment,
            candidates,
            expectedTexts: ["11"],
            level: "preferred",
            clausePattern: /11がいいしハピ寄り/u,
          }),
        );
      }

      return mockOllamaResponse({ attachments: [], features: [], unresolved: [] });
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(comment, candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.preferences).toEqual([
      expect.objectContaining({
        targetText: "11",
        level: "preferred",
      }),
    ]);
    expect(result.autoInterpretation.rules).toEqual([]);
    expect(comparisonPrompts.some((prompt) => prompt.includes("ハピ寄り") && prompt.includes("preference_positive_marker"))).toBe(true);
    expect(comparisonPrompts.some((prompt) => prompt.includes('"text": "11"'))).toBe(true);
  });

  it("can keep a later preference clause even when an earlier availability clause is not fully anchored", async () => {
    const candidates = buildDiscreteDayCandidates([11, 12]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockOllamaResponse({
          attachments: [],
          features: [],
          unresolved: [],
        }),
      )
      .mockResolvedValueOnce(
        mockOllamaResponse(
          buildSingleTargetPreferencePayload({
            comment: "11もいけるけど12がいい",
            candidates,
            expectedTexts: ["12"],
            level: "preferred",
            clausePattern: /12がいい/u,
          }),
        ),
      );

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11もいけるけど12がいい", candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.preferences).toEqual([
      expect.objectContaining({
        targetText: "12",
        level: "preferred",
      }),
    ]);
    expect(result.parsedConstraints.some((constraint) => constraint.intent === "preference")).toBe(false);
  });

  it("wires comparison judgments into autoInterpretation comparisonPreferenceSignals in the main submission flow", async () => {
    const candidates = buildDiscreteDayCandidates([10, 11]);
    const comment = "10と11なら11がいい";
    const mergedHypothesisId = "gh-merge-1";
    const comparedSetId = findClauseTargetGroupId(comment, candidates, /10と11なら11がいい/u, mergedHypothesisId, ["10", "11"]);
    const preferredId = findClauseTargetGroupId(comment, candidates, /10と11なら11がいい/u, mergedHypothesisId, ["11"]);
    const conditionIndex = findComparisonTriggerTokenIndex(comment, candidates, { label: "conditional_marker", text: "なら" });
    const markerIndex = findComparisonTriggerTokenIndex(comment, candidates, { label: "preference_positive_marker", text: /がいい/ });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        format?: { properties?: Record<string, unknown> };
      };
      const properties = body.format?.properties ?? {};

      if (Object.prototype.hasOwnProperty.call(properties, "selectedHypothesisId")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              content: JSON.stringify({
                selectedHypothesisId: null,
                confidence: "medium",
              }),
            },
          }),
        };
      }

      if (Object.prototype.hasOwnProperty.call(properties, "judgments")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              content: JSON.stringify({
                judgments: [
                  {
                    groupingHypothesisId: mergedHypothesisId,
                    kind: "comparison",
                    comparedTargetGroupIds: [comparedSetId, preferredId],
                    preferredTargetGroupId: preferredId,
                    dispreferredTargetGroupIds: [comparedSetId],
                    relation: "better_than",
                    strength: "strong",
                    confidence: "high",
                    triggerTokenIndexes: [conditionIndex, markerIndex],
                    supportingClauseIndexes: [0],
                    notes: null,
                  },
                ],
                warnings: [],
              }),
            },
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              attachments: [],
              features: [],
              unresolved: [],
            }),
          },
        }),
      };
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(comment, candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.autoInterpretation.comparisonPreferenceSignals).toEqual([
      expect.objectContaining({
        targetGroupId: preferredId,
        targetType: "date",
        targetValue: "2026-04-11",
        signal: "preferred",
      }),
    ]);
  });

  it("does not attach comparisonPreferenceSignals for plain availability comments", async () => {
    const attachmentInput = buildAttachmentInputForComment("11ならいける", buildDiscreteDayCandidates([11]));
    const day11Id = findAttachmentCandidateId(attachmentInput, { label: "target_numeric_candidate", text: "11" });
    const availableId = findAttachmentCandidateId(attachmentInput, { label: "availability_positive", text: /いける/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            attachments: [
              {
                type: "availability_target",
                sourceId: availableId,
                targetId: day11Id,
                confidence: 0.98,
              },
            ],
            features: [],
            unresolved: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama("11ならいける", buildDiscreteDayCandidates([11]), {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.autoInterpretation.comparisonPreferenceSignals).toBeUndefined();
  });

  it("attaches date_time comparison signals and safely skips unsupported group-level signals", async () => {
    const candidates = buildFixedTimeCandidates([
      { day: 10, timeSlotKey: "morning" },
      { day: 11, timeSlotKey: "day" },
    ]);
    const comment = "10日の午前より11日の午後の方がいい";
    const worseId = findClauseTargetGroupId(comment, candidates, /10日の午前より11日の午後/u, "gh-default", ["10日", "午前"]);
    const preferredId = findClauseTargetGroupId(comment, candidates, /10日の午前より11日の午後/u, "gh-default", ["11日", "午後"]);
    const markerIndex = findComparisonTriggerTokenIndex(comment, candidates, { label: "comparison_marker", text: /より|方が/ });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            judgments: [
              {
                groupingHypothesisId: "gh-default",
                kind: "comparison",
                comparedTargetGroupIds: [worseId, preferredId],
                preferredTargetGroupId: preferredId,
                dispreferredTargetGroupIds: [worseId],
                relation: "better_than",
                strength: "strong",
                confidence: "high",
                triggerTokenIndexes: [markerIndex],
                supportingClauseIndexes: [0],
                notes: null,
              },
            ],
            warnings: [],
          }),
        },
      }),
    });

    const result = await interpretAvailabilityCommentSubmissionWithOllama(comment, candidates, {
      fetchImpl: fetchMock as typeof fetch,
      model: "mock-model",
    });

    expect(result.autoInterpretation.comparisonPreferenceSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetGroupId: preferredId,
          targetType: "date_time",
          targetValue: "2026-04-11_day",
          signal: "preferred",
        }),
        expect.objectContaining({
          targetGroupId: worseId,
          targetType: "date_time",
          targetValue: "2026-04-10_morning",
          signal: "dispreferred",
        }),
      ]),
    );
  });
});
