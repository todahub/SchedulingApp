import { describe, expect, it, vi } from "vitest";
import {
  buildAvailabilityInterpretationExecutionInput,
  buildAvailabilityInterpretationExecutionInputForGroupingHypothesis,
} from "@/lib/availability-comment-interpretation";
import { interpretAvailabilityCommentSubmissionWithOllama } from "@/lib/availability-comment-interpretation-server";
import type { LlmInterpretationOutput } from "@/lib/availability-interpretation";
import type { AttachmentResolutionInput, AttachmentResolutionOutput } from "@/lib/comment-labeler/attachment-types";
import type { AvailabilityCommentSubmissionInterpretation } from "@/lib/availability-comment-interpretation-server";
import type { EventCandidateRecord } from "@/lib/domain";

type GraphContext = {
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>;
  findTokenIndex: (options: {
    label?: string;
    text?: string | RegExp;
    nth?: number;
  }) => number;
  findTokenIndexes: (options: {
    label?: string;
    text?: string | RegExp;
  }) => number[];
};

type VisibilityScenario = {
  name: string;
  input: string;
  candidates: EventCandidateRecord[];
  buildGraph: (context: GraphContext) => LlmInterpretationOutput;
  selectGroupingHypothesisId?: (
    executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
  ) => string | null;
};

type VisibilitySnapshot = {
  input: string;
  selectedGroupingHypothesisId: string | null;
  stages: {
    labeledTokens: Array<{
      index: number;
      text: string;
      label: string;
      start: number;
      end: number;
      normalizedText?: string;
    }>;
    targets: Array<{
      id: string;
      tokenIndexes: number[];
      texts: Array<string | undefined>;
      labels: Array<string | undefined>;
    }>;
    groupingHypotheses: Array<{
      id: string;
      kind: string;
      note: string;
    }>;
    graph: LlmInterpretationOutput;
    attachments: Array<{
      targetText: string;
      targetLabels: string[];
      availabilityText: string;
      availabilityLabel: string;
      modifierTexts: string[];
      modifierLabels: string[];
      notes: string[];
    }>;
    interpretedAvailability: AvailabilityCommentSubmissionInterpretation["autoInterpretation"]["resolvedCandidateStatuses"];
    parsedConstraints: AvailabilityCommentSubmissionInterpretation["parsedConstraints"];
    answers: AvailabilityCommentSubmissionInterpretation["answers"];
    autoInterpretationStatus: AvailabilityCommentSubmissionInterpretation["autoInterpretation"]["status"];
    failureReason: AvailabilityCommentSubmissionInterpretation["autoInterpretation"]["failureReason"];
    ambiguities: string[];
    usedDefault: boolean;
    defaultReason: "empty" | "unparsed" | null;
  };
};

function buildAllDayCandidate(day: number): EventCandidateRecord {
  const date = `2026-04-${String(day).padStart(2, "0")}`;

  return {
    id: `candidate-${day}-all_day`,
    eventId: "event-april",
    date,
    timeSlotKey: "all_day",
    selectionMode: "range",
    dateType: "single",
    startDate: date,
    endDate: date,
    selectedDates: [],
    timeType: "all_day",
    startTime: null,
    endTime: null,
    note: null,
    sortOrder: day,
  };
}

function buildFixedTimeCandidate(
  day: number,
  timeSlotKey: "morning" | "night",
  startTime: string,
  endTime: string,
): EventCandidateRecord {
  const date = `2026-04-${String(day).padStart(2, "0")}`;

  return {
    id: `candidate-${day}-${timeSlotKey}`,
    eventId: "event-april",
    date,
    timeSlotKey,
    selectionMode: "range",
    dateType: "single",
    startDate: date,
    endDate: date,
    selectedDates: [],
    timeType: "fixed",
    startTime,
    endTime,
    note: null,
    sortOrder: day,
  };
}

function createGraphContext(
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
): GraphContext {
  return {
    executionInput,
    findTokenIndex: ({ label, text, nth = 0 }) => {
      const matches = executionInput.tokens.filter((token) => {
        const labelMatch = !label || token.label === label;
        const textMatch =
          !text ||
          (typeof text === "string" ? token.text === text : text.test(token.text));
        return labelMatch && textMatch;
      });
      const match = matches[nth];

      if (!match) {
        throw new Error(
          `Token not found for label=${String(label)} text=${String(text)} nth=${nth} in "${executionInput.originalText}"`,
        );
      }

      return match.index;
    },
    findTokenIndexes: ({ label, text }) =>
      executionInput.tokens
        .filter((token) => {
          const labelMatch = !label || token.label === label;
          const textMatch =
            !text ||
            (typeof text === "string" ? token.text === text : text.test(token.text));
          return labelMatch && textMatch;
        })
        .map((token) => token.index),
  };
}

function summarizeRules(
  interpretation: AvailabilityCommentSubmissionInterpretation["autoInterpretation"],
) {
  return interpretation.rules.map((rule) => ({
    targetText: rule.targetText,
    targetLabels: rule.targetLabels,
    availabilityText: rule.availabilityText,
    availabilityLabel: rule.availabilityLabel,
    modifierTexts: rule.modifierTexts,
    modifierLabels: rule.modifierLabels,
    notes: rule.notes,
  }));
}

function buildResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      message: {
        content,
      },
    }),
  };
}

function parseMockOllamaBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? "{}")) as {
    format?: { properties?: Record<string, unknown> };
    messages?: Array<{ role: string; content: string }>;
  };
}

function isLabelCompletionRequest(body: ReturnType<typeof parseMockOllamaBody>) {
  return Object.prototype.hasOwnProperty.call(body.format?.properties ?? {}, "segments");
}

function isAttachmentResolutionRequest(body: ReturnType<typeof parseMockOllamaBody>) {
  const properties = body.format?.properties ?? {};
  return (
    (
      Object.prototype.hasOwnProperty.call(properties, "attachments") ||
      (
        Object.prototype.hasOwnProperty.call(properties, "availabilityAttachments") &&
        Object.prototype.hasOwnProperty.call(properties, "modifierAttachments") &&
        Object.prototype.hasOwnProperty.call(properties, "reasonAttachments") &&
        Object.prototype.hasOwnProperty.call(properties, "comparisonScopes") &&
        Object.prototype.hasOwnProperty.call(properties, "preferenceAttachments") &&
        Object.prototype.hasOwnProperty.call(properties, "clauseRelations")
      )
    ) &&
    Object.prototype.hasOwnProperty.call(properties, "features") &&
    Object.prototype.hasOwnProperty.call(properties, "unresolved")
  );
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

function areSameIndexes(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function indexAttachmentCandidates(
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>,
  attachmentInput: AttachmentResolutionInput,
) {
  const tokenQueues = new Map<string, number[]>();

  for (const token of executionInput.tokens) {
    const key = `${token.start}:${token.end}:${token.label}:${token.text}`;
    const queue = tokenQueues.get(key) ?? [];
    queue.push(token.index);
    tokenQueues.set(key, queue);
  }

  return attachmentInput.candidates.map((candidate) => {
    const key = `${candidate.start}:${candidate.end}:${candidate.label}:${candidate.text}`;
    const queue = tokenQueues.get(key) ?? [];
    const tokenIndex = queue.shift() ?? null;

    return {
      ...candidate,
      tokenIndex,
    };
  });
}

function buildAttachmentResolutionPayloadFromGraph(args: {
  executionInput: ReturnType<typeof buildAvailabilityInterpretationExecutionInput>;
  attachmentInput: AttachmentResolutionInput;
  graph: LlmInterpretationOutput;
}): AttachmentResolutionOutput {
  const indexedCandidates = indexAttachmentCandidates(args.executionInput, args.attachmentInput);

  const findCandidateIdForTokenIndex = (tokenIndex: number) => {
    const candidate = indexedCandidates.find(
      (entry) =>
        entry.tokenIndex === tokenIndex &&
        (entry.label.startsWith("target_") ||
          entry.label === "scope_exception" ||
          entry.label === "scope_residual" ||
          entry.label === "availability_positive" ||
          entry.label === "availability_negative" ||
          entry.label === "availability_unknown" ||
          entry.label === "uncertainty_marker" ||
          entry.label === "conditional_marker" ||
          entry.label === "hypothetical_marker" ||
          entry.label === "negation_marker" ||
          entry.label === "strength_marker" ||
          entry.label === "weak_commitment_marker"),
    );

    if (!candidate) {
      throw new Error(`Attachment candidate not found for token index ${tokenIndex} in "${args.executionInput.originalText}"`);
    }

    return candidate.id;
  };

  const selectRepresentativeTargetCandidateId = (tokenIndexes: number[]) => {
    const candidates = indexedCandidates
      .filter(
        (candidate) =>
          candidate.tokenIndex !== null &&
          tokenIndexes.includes(candidate.tokenIndex) &&
          (candidate.label.startsWith("target_") ||
            candidate.label === "scope_exception" ||
            candidate.label === "scope_residual"),
      )
      .sort((left, right) => (right.tokenIndex ?? -1) - (left.tokenIndex ?? -1));

    return candidates[0]?.id ?? null;
  };

  const resolveTargetIds = (tokenIndexes: number[]) => {
    const normalized = [...new Set(tokenIndexes)].sort((left, right) => left - right);
    const exactGroup = args.executionInput.grouping.targetGroups.find((group) =>
      areSameIndexes(group.tokenIndexes, normalized),
    );

    if (exactGroup) {
      const candidateId = selectRepresentativeTargetCandidateId(exactGroup.tokenIndexes);
      return candidateId ? [candidateId] : [];
    }

    const subsetGroups = args.executionInput.grouping.targetGroups.filter((group) =>
      group.tokenIndexes.every((tokenIndex) => normalized.includes(tokenIndex)),
    );
    const subsetUnion = [...new Set(subsetGroups.flatMap((group) => group.tokenIndexes))].sort(
      (left, right) => left - right,
    );

    if (subsetGroups.length > 0 && areSameIndexes(subsetUnion, normalized)) {
      return subsetGroups
        .map((group) => selectRepresentativeTargetCandidateId(group.tokenIndexes))
        .filter((candidateId): candidateId is string => typeof candidateId === "string");
    }

    return normalized
      .map((tokenIndex) => selectRepresentativeTargetCandidateId([tokenIndex]))
      .filter((candidateId): candidateId is string => typeof candidateId === "string");
  };

  const attachments: AttachmentResolutionOutput["attachments"] = [];

  for (const link of args.graph.links) {
    if (link.relation !== "applies_to") {
      continue;
    }

    const availabilitySourceId = findCandidateIdForTokenIndex(link.availabilityTokenIndexes[0]!);
    const targetIds = resolveTargetIds(link.targetTokenIndexes);

    for (const targetId of targetIds) {
      attachments.push({
        type: "availability_target",
        sourceId: availabilitySourceId,
        targetId,
        confidence: link.confidence === "high" ? 0.98 : 0.82,
      });
    }

    for (const modifierTokenIndex of link.modifierTokenIndexes ?? []) {
      const modifierSourceId = findCandidateIdForTokenIndex(modifierTokenIndex);
      attachments.push({
        type: "modifier_predicate",
        sourceId: modifierSourceId,
        targetId: availabilitySourceId,
        confidence: 0.9,
      });
    }
  }

  return {
    attachments: attachments.filter((attachment, index, source) => {
      const key = JSON.stringify(attachment);
      return source.findIndex((candidate) => JSON.stringify(candidate) === key) === index;
    }),
    features: [],
    unresolved: [],
  };
}

async function buildAvailabilityPipelineVisibilitySnapshot(
  scenario: VisibilityScenario,
): Promise<VisibilitySnapshot> {
  const baseExecutionInput = buildAvailabilityInterpretationExecutionInput(
    scenario.input,
    scenario.candidates,
  );
  const selectedGroupingHypothesisId =
    scenario.selectGroupingHypothesisId?.(baseExecutionInput) ?? null;
  const selectedExecutionInput = selectedGroupingHypothesisId
    ? buildAvailabilityInterpretationExecutionInputForGroupingHypothesis(
        baseExecutionInput,
        selectedGroupingHypothesisId,
      )
    : baseExecutionInput;
  const graph = scenario.buildGraph(createGraphContext(selectedExecutionInput));

  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = parseMockOllamaBody(init);
    const isGroupingSelectionRequest =
      Boolean(body.format?.properties) &&
      Object.prototype.hasOwnProperty.call(body.format.properties, "selectedHypothesisId");

    if (isGroupingSelectionRequest) {
      return buildResponse(
        JSON.stringify({
          selectedHypothesisId,
          confidence: "high",
        }),
      );
    }

    if (isLabelCompletionRequest(body)) {
      return buildResponse(JSON.stringify({ segments: [] }));
    }

    if (isAttachmentResolutionRequest(body)) {
      return buildResponse(
        JSON.stringify(
          buildAttachmentResolutionPayloadFromGraph({
            executionInput: selectedExecutionInput,
            attachmentInput: parseStructuredInputFromUserPrompt<AttachmentResolutionInput>(body),
            graph,
          }),
        ),
      );
    }

    return buildResponse(JSON.stringify({ judgments: [], warnings: [] }));
  });

  const interpretation = await interpretAvailabilityCommentSubmissionWithOllama(
    scenario.input,
    scenario.candidates,
    {
      fetchImpl: fetchMock as typeof fetch,
      baseUrl: "http://127.0.0.1:11434/api",
      model: "mock-model",
    },
  );

  return {
    input: scenario.input,
    selectedGroupingHypothesisId,
    stages: {
      labeledTokens: selectedExecutionInput.tokens.map((token) => ({
        index: token.index,
        text: token.text,
        label: token.label,
        start: token.start,
        end: token.end,
        ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
      })),
      targets: selectedExecutionInput.grouping.targetGroups.map((group) => ({
        id: group.id,
        tokenIndexes: group.tokenIndexes,
        texts: group.tokenIndexes.map((index) => selectedExecutionInput.tokens[index]?.text),
        labels: group.tokenIndexes.map((index) => selectedExecutionInput.tokens[index]?.label),
      })),
      groupingHypotheses: selectedExecutionInput.groupingHypotheses.map((hypothesis) => ({
        id: hypothesis.id,
        kind: hypothesis.kind,
        note: hypothesis.note,
      })),
      graph,
      attachments: summarizeRules(interpretation.autoInterpretation),
      interpretedAvailability: interpretation.autoInterpretation.resolvedCandidateStatuses ?? [],
      parsedConstraints: interpretation.parsedConstraints,
      answers: interpretation.answers,
      autoInterpretationStatus: interpretation.autoInterpretation.status,
      failureReason: interpretation.autoInterpretation.failureReason,
      ambiguities: interpretation.autoInterpretation.ambiguities,
      usedDefault: interpretation.usedDefault,
      defaultReason: interpretation.defaultReason,
    },
  };
}

const scenarios: VisibilityScenario[] = [
  {
    name: "10か12ならいける",
    input: "10か12ならいける",
    candidates: [buildAllDayCandidate(10), buildAllDayCandidate(12)],
    buildGraph: ({ findTokenIndexes, findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: findTokenIndexes({ label: "target_numeric_candidate" }),
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          modifierTokenIndexes: [findTokenIndex({ label: "conditional_marker", text: /なら/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "12ならいける",
    input: "12ならいける",
    candidates: [buildAllDayCandidate(12)],
    buildGraph: ({ findTokenIndex }) => ({
      links: [
        {
          relation: "applies_to",
          targetTokenIndexes: [findTokenIndex({ label: "target_numeric_candidate", text: /12/ })],
          availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
          modifierTokenIndexes: [findTokenIndex({ label: "conditional_marker", text: /なら/ })],
          confidence: "high",
        },
      ],
    }),
  },
  {
    name: "金曜の夜以外はいける",
    input: "金曜の夜以外はいける",
    candidates: [
      buildAllDayCandidate(9),
      buildFixedTimeCandidate(10, "night", "18:00", "22:00"),
      buildAllDayCandidate(11),
    ],
    buildGraph: ({ findTokenIndex }) => {
      const scopeExceptionIndex = findTokenIndex({ label: "scope_exception" });

      return {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: [scopeExceptionIndex],
            availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
            confidence: "high",
          },
          {
            relation: "exception_to",
            sourceTokenIndexes: [scopeExceptionIndex],
            targetTokenIndexes: [
              findTokenIndex({ label: "target_weekday", text: /金曜/ }),
              findTokenIndex({ label: "target_time_of_day", text: /夜/ }),
            ],
            confidence: "high",
          },
        ],
      };
    },
  },
  {
    name: "平日は無理、5日は午前が無理、あとはいける",
    input: "平日は無理、5日は午前が無理、あとはいける",
    candidates: [
      buildAllDayCandidate(3),
      buildAllDayCandidate(4),
      buildFixedTimeCandidate(5, "morning", "09:00", "12:00"),
      buildAllDayCandidate(6),
    ],
    buildGraph: ({ findTokenIndex }) => {
      const weekdayIndex = findTokenIndex({ label: "target_weekday_group", text: /平日/ });
      const dayFiveIndex = findTokenIndex({ label: "target_date", text: /5/ });
      const morningIndex = findTokenIndex({ label: "target_time_of_day", text: /午前/ });
      const residualIndex = findTokenIndex({ label: "scope_residual" });
      const negativeIndexes = [
        findTokenIndex({ label: "availability_negative", text: /無理/, nth: 0 }),
        findTokenIndex({ label: "availability_negative", text: /無理/, nth: 1 }),
      ];

      return {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: [weekdayIndex],
            availabilityTokenIndexes: [negativeIndexes[0]!],
            confidence: "high",
          },
          {
            relation: "applies_to",
            targetTokenIndexes: [dayFiveIndex, morningIndex],
            availabilityTokenIndexes: [negativeIndexes[1]!],
            confidence: "high",
          },
          {
            relation: "applies_to",
            targetTokenIndexes: [residualIndex],
            availabilityTokenIndexes: [findTokenIndex({ label: "availability_positive", text: /いける/ })],
            confidence: "medium",
          },
          {
            relation: "residual_of",
            sourceTokenIndexes: [residualIndex],
            targetTokenIndexes: [weekdayIndex, dayFiveIndex, morningIndex],
            confidence: "medium",
          },
        ],
      };
    },
  },
];

describe("availability interpretation visibility", () => {
  it.each(scenarios)("logs pipeline visibility for $name", async (scenario) => {
    const snapshot = await buildAvailabilityPipelineVisibilitySnapshot(scenario);

    console.log(
      `\n[availability-interpretation.visibility] ${scenario.name}\n${JSON.stringify(snapshot, null, 2)}`,
    );

    expect(snapshot.input).toBe(scenario.input);
    expect(Array.isArray(snapshot.stages.labeledTokens)).toBe(true);
    expect(Array.isArray(snapshot.stages.targets)).toBe(true);
    expect(Array.isArray(snapshot.stages.attachments)).toBe(true);
    expect(Array.isArray(snapshot.stages.interpretedAvailability)).toBe(true);
  });
});
