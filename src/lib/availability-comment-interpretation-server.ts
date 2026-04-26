import {
  AvailabilityInterpretationParseError,
  validateAvailabilityInterpretationOutput,
  type LlmInterpretationOutput,
} from "@/lib/availability-interpretation";
import {
  buildAvailabilityInterpretationExecutionInputForGroupingHypothesis,
  buildAutoInterpretationResult,
  buildAvailabilityInterpretationExecutionInput,
  buildDerivedResponseFromAvailabilityInterpretation,
  type AvailabilityInterpretationExecutionInput,
} from "@/lib/availability-comment-interpretation";
import {
  buildComparisonPreferenceInterpretationInput,
  buildAutoInterpretationPreferencesFromJudgments,
  buildRankingPreferenceSignalsFromJudgments,
  hasComparisonPreferenceCandidateMaterial,
  interpretComparisonPreferencesForInput,
} from "@/lib/comparison-preference-interpretation";
import {
  AVAILABILITY_GROUPING_SELECTION_SYSTEM_PROMPT,
  AVAILABILITY_COMMENT_INTERPRETATION_SYSTEM_PROMPT,
  buildAvailabilityGroupingSelectionUserPrompt,
  buildAvailabilityCommentInterpretationUserPrompt,
  buildAvailabilityCommentInterpretationRepairPrompt,
} from "@/lib/availability-comment-interpretation-prompt";
import type {
  AutoInterpretationResult,
  EventCandidateRecord,
  ParsedCommentConstraint,
  ParticipantAnswerRecord,
} from "@/lib/domain";

type InterpretAvailabilityCommentOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
};

export type AvailabilityCommentSubmissionInterpretation = {
  autoInterpretation: AutoInterpretationResult;
  parsedConstraints: ParsedCommentConstraint[];
  answers: ParticipantAnswerRecord[];
  usedDefault: boolean;
  defaultReason: "empty" | "unparsed" | null;
};

const EMPTY_GRAPH: LlmInterpretationOutput = {
  links: [],
};

class AvailabilityGraphRequestError extends Error {
  constructor(
    message: string,
    readonly lastGraphJson?: string,
  ) {
    super(message);
    this.name = "AvailabilityGraphRequestError";
  }
}

const INTEGER_INDEX_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "integer" },
  minItems: 1,
} as const;

const OPTIONAL_INTEGER_INDEX_ARRAY_SCHEMA = {
  ...INTEGER_INDEX_ARRAY_SCHEMA,
} as const;

const OPTIONAL_STRING_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
} as const;

const TARGET_CONTEXT_REFERENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: [
        "contrast_availability_context",
        "conditional_choice_scope",
        "comparison_marker_scope",
        "exception_or_residual_scope",
        "none",
      ],
    },
    hint: {
      type: "string",
      enum: ["comparison_candidate", "preference_context", "condition_context", "none"],
    },
    relatedTargetGroupIds: OPTIONAL_STRING_ARRAY_SCHEMA,
    relatedClauseGroupIds: OPTIONAL_STRING_ARRAY_SCHEMA,
    markerTokenIndexes: OPTIONAL_INTEGER_INDEX_ARRAY_SCHEMA,
  },
  required: ["kind", "hint"],
} as const;

const TARGET_CONTEXT_BINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    targetTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
    relationContext: {
      type: "array",
      items: TARGET_CONTEXT_REFERENCE_SCHEMA,
      minItems: 1,
    },
    supportingContext: {
      type: "array",
      items: TARGET_CONTEXT_REFERENCE_SCHEMA,
      minItems: 1,
    },
  },
  required: ["targetTokenIndexes"],
} as const;

const OLLAMA_RELATION_GRAPH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    links: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              relation: {
                type: "string",
                enum: ["applies_to"],
              },
              targetTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              availabilityTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              modifierTokenIndexes: OPTIONAL_INTEGER_INDEX_ARRAY_SCHEMA,
              confidence: {
                type: "string",
                enum: ["high", "medium"],
              },
              note: {
                type: "string",
              },
            },
            required: ["relation", "targetTokenIndexes", "availabilityTokenIndexes", "confidence"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              relation: {
                type: "string",
                enum: ["contrast_with"],
              },
              sourceTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              targetTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              markerTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              confidence: {
                type: "string",
                enum: ["high", "medium"],
              },
              note: {
                type: "string",
              },
            },
            required: [
              "relation",
              "sourceTokenIndexes",
              "targetTokenIndexes",
              "markerTokenIndexes",
              "confidence",
            ],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              relation: {
                type: "string",
                enum: ["residual_of"],
              },
              sourceTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              targetTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              markerTokenIndexes: OPTIONAL_INTEGER_INDEX_ARRAY_SCHEMA,
              confidence: {
                type: "string",
                enum: ["high", "medium"],
              },
              note: {
                type: "string",
              },
            },
            required: ["relation", "sourceTokenIndexes", "targetTokenIndexes", "confidence"],
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              relation: {
                type: "string",
                enum: ["exception_to"],
              },
              sourceTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              targetTokenIndexes: INTEGER_INDEX_ARRAY_SCHEMA,
              confidence: {
                type: "string",
                enum: ["high", "medium"],
              },
              note: {
                type: "string",
              },
            },
            required: ["relation", "sourceTokenIndexes", "targetTokenIndexes", "confidence"],
          },
        ],
      },
    },
    targetContexts: {
      type: "array",
      items: TARGET_CONTEXT_BINDING_SCHEMA,
    },
    ambiguities: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
  required: ["links"],
} as const;

const OLLAMA_GROUPING_SELECTION_SCHEMA_BASE = {
  type: "object",
  additionalProperties: false,
  properties: {
    selectedHypothesisId: {
      oneOf: [{ type: "string" }, { type: "null" }],
    },
    confidence: {
      type: "string",
      enum: ["high", "medium"],
    },
  },
  required: ["selectedHypothesisId", "confidence"],
} as const;

async function attachComparisonPreferenceSignals(
  autoInterpretation: AutoInterpretationResult,
  comment: string,
  candidates: EventCandidateRecord[],
  options: InterpretAvailabilityCommentOptions,
) {
  try {
    const comparisonPreferenceInput = buildComparisonPreferenceInterpretationInput(comment, candidates, {
      availabilityRules: autoInterpretation.rules,
      targetContexts: autoInterpretation.targetContexts,
    });

    if (
      comparisonPreferenceInput.relevantClauses.length === 0 ||
      !hasComparisonPreferenceCandidateMaterial(comparisonPreferenceInput)
    ) {
      return autoInterpretation;
    }

    const comparisonPreferenceResult = await interpretComparisonPreferencesForInput(comparisonPreferenceInput, {
      fetchImpl: options.fetchImpl,
      baseUrl: options.baseUrl,
      model: options.model,
    });

    if (comparisonPreferenceResult.relevantClauseIndexes.length === 0) {
      return autoInterpretation;
    }

    const preferences = buildAutoInterpretationPreferencesFromJudgments(
      comparisonPreferenceInput,
      comparisonPreferenceResult.judgments,
    );
    const comparisonPreferenceSignals = buildRankingPreferenceSignalsFromJudgments(
      comparisonPreferenceInput,
      comparisonPreferenceResult.judgments,
    );

    return {
      ...autoInterpretation,
      preferences,
      ...(comparisonPreferenceSignals.length > 0 ? { comparisonPreferenceSignals } : {}),
      ...(autoInterpretation.rules.length === 0 && preferences.length > 0
        ? {
            failureReason: "可否ルールは作れませんでしたが、希望情報は抽出できました。",
          }
        : {}),
    } satisfies AutoInterpretationResult;
  } catch {
    return autoInterpretation;
  }
}

export async function interpretAvailabilityCommentWithOllama(
  comment: string,
  candidates: EventCandidateRecord[],
  options: InterpretAvailabilityCommentOptions = {},
): Promise<AutoInterpretationResult> {
  const submissionInterpretation = await interpretAvailabilityCommentSubmissionWithOllama(comment, candidates, options);

  return submissionInterpretation.autoInterpretation;
}

export async function interpretAvailabilityCommentSubmissionWithOllama(
  comment: string,
  candidates: EventCandidateRecord[],
  options: InterpretAvailabilityCommentOptions = {},
): Promise<AvailabilityCommentSubmissionInterpretation> {
  const trimmed = comment.trim();
  const baseExecutionInput = buildAvailabilityInterpretationExecutionInput(trimmed, candidates);
  const executionInput =
    baseExecutionInput.groupingHypotheses.length > 1
      ? await selectGroupingHypothesisForExecutionInput(baseExecutionInput, options)
      : baseExecutionInput;

  if (!trimmed) {
    const derived = buildDerivedResponseFromAvailabilityInterpretation(executionInput, EMPTY_GRAPH, candidates);
    const autoInterpretation = await attachComparisonPreferenceSignals(
      {
        status: "skipped",
        sourceComment: comment,
        rules: [],
        ambiguities: [],
        failureReason: "コメント未入力のため自動解釈を実行しませんでした。",
      },
      comment,
      candidates,
      options,
    );

    return {
      autoInterpretation,
      parsedConstraints: derived.parsedConstraints,
      answers: derived.answers,
      usedDefault: derived.usedDefault,
      defaultReason: derived.defaultReason,
    };
  }

  if (
    executionInput.grouping.availabilityGroups.length === 0 &&
    !hasAvailabilityTargetContextCandidateMaterial(executionInput)
  ) {
    const autoInterpretation = buildAutoInterpretationResult(executionInput, EMPTY_GRAPH, candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(executionInput, EMPTY_GRAPH, candidates);

    if (autoInterpretation.status === "success" || (autoInterpretation.preferences?.length ?? 0) > 0) {
      return {
        autoInterpretation: await attachComparisonPreferenceSignals(autoInterpretation, trimmed, candidates, options),
        parsedConstraints: derived.parsedConstraints,
        answers: derived.answers,
        usedDefault: derived.usedDefault,
        defaultReason: derived.defaultReason,
      };
    }

    return {
      autoInterpretation: await attachComparisonPreferenceSignals(
        {
          status: "failed",
          sourceComment: trimmed,
          rules: [],
          ambiguities: [],
          failureReason: "可否トークンが見つからず、自動解釈を開始できませんでした。",
        },
        trimmed,
        candidates,
        options,
      ),
      parsedConstraints: derived.parsedConstraints,
      answers: derived.answers,
      usedDefault: derived.usedDefault,
      defaultReason: derived.defaultReason,
    };
  }

  let graphJson: string | null = null;

  try {
    const { graph: parsed, lastGraphJson } = await requestAndValidateAvailabilityGraph(executionInput, options, (jsonText) =>
      parseAndNormalizeAvailabilityGraphResponse(jsonText, executionInput),
    );
    graphJson = lastGraphJson;
    const autoInterpretation = await attachComparisonPreferenceSignals(
      buildAutoInterpretationResult(executionInput, parsed, candidates),
      trimmed,
      candidates,
      options,
    );
    const derived = buildDerivedResponseFromAvailabilityInterpretation(executionInput, parsed, candidates);

    return {
      autoInterpretation,
      parsedConstraints: derived.parsedConstraints,
      answers: derived.answers,
      usedDefault: derived.usedDefault,
      defaultReason: derived.defaultReason,
    };
  } catch (error) {
    const failureReason =
      error instanceof AvailabilityInterpretationParseError
        ? error.message
        : error instanceof AvailabilityGraphRequestError
          ? error.message
          : error instanceof Error
          ? error.message
          : "Ollama から有効な自動解釈結果を取得できませんでした。";
    const debugGraphJson = error instanceof AvailabilityGraphRequestError ? error.lastGraphJson : graphJson;
    const derived = buildDerivedResponseFromAvailabilityInterpretation(executionInput, EMPTY_GRAPH, candidates);
    const autoInterpretation = buildAutoInterpretationResult(executionInput, EMPTY_GRAPH, candidates);

    return {
      autoInterpretation: await attachComparisonPreferenceSignals(
        {
          ...autoInterpretation,
          status: "failed",
          sourceComment: trimmed,
          failureReason,
          ...(debugGraphJson ? { debugGraphJson } : {}),
        },
        trimmed,
        candidates,
        options,
      ),
      parsedConstraints: derived.parsedConstraints,
      answers: derived.answers,
      usedDefault: derived.usedDefault,
      defaultReason: derived.defaultReason,
    };
  }
}

function hasAvailabilityTargetContextCandidateMaterial(
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  if (executionInput.grouping.targetGroups.length < 2) {
    return false;
  }

  return executionInput.tokens.some((token) => isContextMarkerLabel(token.label));
}

async function requestAndValidateAvailabilityGraph(
  executionInput: AvailabilityInterpretationExecutionInput,
  options: InterpretAvailabilityCommentOptions,
  parseGraph: (jsonText: string) => LlmInterpretationOutput,
) {
  const initialGraphJson = await requestAvailabilityGraph(executionInput, options, {
    userPrompt: buildAvailabilityCommentInterpretationUserPrompt(executionInput),
  });

  try {
    const parsed = parseGraph(initialGraphJson);
    assertRuntimeGraphIsSupported(parsed, executionInput);
    return {
      graph: parsed,
      lastGraphJson: initialGraphJson,
    };
  } catch (error) {
    if (!(error instanceof AvailabilityInterpretationParseError)) {
      throw error;
    }

    const repairedGraphJson = await requestAvailabilityGraph(executionInput, options, {
      userPrompt: buildAvailabilityCommentInterpretationRepairPrompt({
        input: executionInput,
        invalidResponse: initialGraphJson,
        validationError: error.message,
      }),
    });
    try {
      const repaired = parseGraph(repairedGraphJson);
      assertRuntimeGraphIsSupported(repaired, executionInput);
      return {
        graph: repaired,
        lastGraphJson: repairedGraphJson,
      };
    } catch (repairError) {
      if (repairError instanceof AvailabilityInterpretationParseError) {
        throw new AvailabilityGraphRequestError(repairError.message, repairedGraphJson);
      }

      throw repairError;
    }
  }
}

async function selectGroupingHypothesisForExecutionInput(
  executionInput: AvailabilityInterpretationExecutionInput,
  options: InterpretAvailabilityCommentOptions,
) {
  try {
    const responseText = await requestOllamaJson(options, {
      systemPrompt: AVAILABILITY_GROUPING_SELECTION_SYSTEM_PROMPT,
      userPrompt: buildAvailabilityGroupingSelectionUserPrompt(executionInput),
      format: {
        ...OLLAMA_GROUPING_SELECTION_SCHEMA_BASE,
        properties: {
          ...OLLAMA_GROUPING_SELECTION_SCHEMA_BASE.properties,
          selectedHypothesisId: {
            oneOf: [
              {
                type: "string",
                enum: executionInput.groupingHypotheses.map((hypothesis) => hypothesis.id),
              },
              { type: "null" },
            ],
          },
        },
      },
    });
    const parsed = JSON.parse(responseText) as { selectedHypothesisId?: string | null };
    const selectedId =
      typeof parsed.selectedHypothesisId === "string" &&
      executionInput.groupingHypotheses.some((hypothesis) => hypothesis.id === parsed.selectedHypothesisId)
        ? parsed.selectedHypothesisId
        : null;

    return selectedId
      ? buildAvailabilityInterpretationExecutionInputForGroupingHypothesis(executionInput, selectedId)
      : executionInput;
  } catch {
    return executionInput;
  }
}

async function requestAvailabilityGraph(
  executionInput: AvailabilityInterpretationExecutionInput,
  options: InterpretAvailabilityCommentOptions,
  prompts: {
    userPrompt: string;
  },
) {
  return requestOllamaJson(options, {
    systemPrompt: AVAILABILITY_COMMENT_INTERPRETATION_SYSTEM_PROMPT,
    userPrompt: prompts.userPrompt,
    format: OLLAMA_RELATION_GRAPH_SCHEMA,
  });
}

async function requestOllamaJson(
  options: InterpretAvailabilityCommentOptions,
  prompts: {
    systemPrompt: string;
    userPrompt: string;
    format: Record<string, unknown>;
  },
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeOllamaBaseUrl(options.baseUrl ?? process.env.OLLAMA_BASE_URL);
  const model = options.model ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b";
  const response = await fetchImpl(`${baseUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: prompts.format,
      options: {
        temperature: 0,
      },
      messages: [
        {
          role: "system",
          content: prompts.systemPrompt,
        },
        {
          role: "user",
          content: prompts.userPrompt,
        },
      ],
    }),
  });

  const payload = (await response.json()) as {
    error?: string;
    message?: {
      content?: string;
    };
  };

  if (!response.ok) {
    throw new Error(payload.error ?? `Ollama request failed with status ${response.status}.`);
  }

  const content = payload.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Ollama response did not contain JSON content.");
  }

  return content.trim();
}

function assertRuntimeGraphIsSupported(
  graph: LlmInterpretationOutput,
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  if (graph.links.some((link) => link.relation === "modifies" || link.relation === "condition_for")) {
    throw new AvailabilityInterpretationParseError("Only applies_to, contrast_with, residual_of, and exception_to are supported.");
  }

  if (graph.links.some((link) => link.confidence === "low")) {
    throw new AvailabilityInterpretationParseError('Low-confidence relations are not accepted. Return {"links":[]} instead.');
  }

  assertScopeAnchorsArePreserved(graph, executionInput);
  assertSemanticModifiersArePreserved(graph, executionInput);
  assertTargetContextsAreSupported(graph, executionInput);
}

function normalizeOllamaBaseUrl(value: string | undefined) {
  const normalized = (value?.trim() || "http://127.0.0.1:11434/api").replace(/\/+$/u, "");

  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
}

function parseAndNormalizeAvailabilityGraphResponse(
  jsonText: string,
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AvailabilityInterpretationParseError("Availability interpretation response must be valid JSON.");
  }

  const normalized = normalizeModelGraphCandidate(parsed, executionInput);

  const validated = validateAvailabilityInterpretationOutput(normalized, {
    originalText: executionInput.originalText,
    tokens: executionInput.tokens,
  });

  return deduplicateInterpretationGraph(validated);
}

function deduplicateInterpretationGraph(graph: LlmInterpretationOutput): LlmInterpretationOutput {
  const seen = new Set<string>();
  const links = graph.links.filter((link) => {
    const key = JSON.stringify(link);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return links.length === graph.links.length ? graph : { ...graph, links };
}

function assertScopeAnchorsArePreserved(
  graph: LlmInterpretationOutput,
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  const genericScopeGroupsById = new Map(executionInput.grouping.scopeGroups.map((group) => [group.id, group]));
  const availabilityGroupsById = new Map(
    executionInput.grouping.availabilityGroups.map((group) => [group.id, group]),
  );

  for (const clauseGroup of executionInput.grouping.clauseGroups) {
    if (!clauseGroup.anchorGroupId) {
      continue;
    }

    const scopeGroup = genericScopeGroupsById.get(clauseGroup.anchorGroupId);
    const availabilityGroup = availabilityGroupsById.get(clauseGroup.availabilityGroupId);

    if (!scopeGroup || !availabilityGroup) {
      continue;
    }

    const isResidualScope = executionInput.grouping.residualScopeGroups.some((group) =>
      sameIndexes(group.tokenIndexes, scopeGroup.tokenIndexes),
    );
    const isExceptionScope = executionInput.grouping.exceptionScopeGroups.some((group) =>
      sameIndexes(group.tokenIndexes, scopeGroup.tokenIndexes),
    );

    if (!isResidualScope && !isExceptionScope) {
      continue;
    }

    const appliesToLinks = graph.links.filter(
      (link): link is Extract<LlmInterpretationOutput["links"][number], { relation: "applies_to" }> =>
        link.relation === "applies_to" && sameIndexes(link.availabilityTokenIndexes, availabilityGroup.tokenIndexes),
    );

    if (!appliesToLinks.some((link) => sameIndexes(link.targetTokenIndexes, scopeGroup.tokenIndexes))) {
      throw new AvailabilityInterpretationParseError(
        `Scope-anchored clause for ${formatIndexes(scopeGroup.tokenIndexes)} must use applies_to with the scope group as target.`,
      );
    }

    if (appliesToLinks.some((link) => !sameIndexes(link.targetTokenIndexes, scopeGroup.tokenIndexes))) {
      throw new AvailabilityInterpretationParseError(
        `Scope-anchored clause for ${formatIndexes(scopeGroup.tokenIndexes)} must not attach the same availability directly to a non-scope target.`,
      );
    }

    if (scopeGroup.tokenIndexes.length === 1) {
      const scopeIndex = scopeGroup.tokenIndexes[0]!;
      const candidateTargetGroups = executionInput.grouping.targetGroups.filter(
        (group) =>
          group.tokenIndexes.every((tokenIndex) => clauseGroup.tokenIndexes.includes(tokenIndex)) &&
          Math.max(...group.tokenIndexes) < scopeIndex,
      );

      if (
        isExceptionScope &&
        candidateTargetGroups.length === 1 &&
        !graph.links.some(
          (link) =>
            link.relation === "exception_to" &&
            sameIndexes(link.sourceTokenIndexes, scopeGroup.tokenIndexes) &&
            sameIndexes(link.targetTokenIndexes, candidateTargetGroups[0]!.tokenIndexes),
        )
      ) {
        throw new AvailabilityInterpretationParseError(
          `Explicit exception scope ${formatIndexes(scopeGroup.tokenIndexes)} must include exception_to to the explicit target group.`,
        );
      }
    }
  }
}

function assertSemanticModifiersArePreserved(
  graph: LlmInterpretationOutput,
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  const targetAndScopeGroups = [...executionInput.grouping.targetGroups, ...executionInput.grouping.scopeGroups];

  for (const link of graph.links) {
    if (link.relation !== "applies_to") {
      continue;
    }

    const availabilityGroup = executionInput.grouping.availabilityGroups.find((group) =>
      sameIndexes(group.tokenIndexes, link.availabilityTokenIndexes),
    );
    const anchorGroup = targetAndScopeGroups.find((group) => sameIndexes(group.tokenIndexes, link.targetTokenIndexes));

    if (!availabilityGroup || !anchorGroup) {
      continue;
    }

    const clauseGroup = executionInput.grouping.clauseGroups.find(
      (group) => group.availabilityGroupId === availabilityGroup.id && group.anchorGroupId === anchorGroup.id,
    );

    if (!clauseGroup) {
      continue;
    }

    const expectedModifierIndexes = clauseGroup.tokenIndexes.filter(
      (tokenIndex) =>
        !anchorGroup.tokenIndexes.includes(tokenIndex) && !availabilityGroup.tokenIndexes.includes(tokenIndex),
    );

    if (expectedModifierIndexes.length > 0 && !sameIndexes(expectedModifierIndexes, link.modifierTokenIndexes ?? [])) {
      throw new AvailabilityInterpretationParseError(
        `applies_to for ${formatIndexes(link.targetTokenIndexes)} must preserve semantic modifier indexes ${formatIndexes(expectedModifierIndexes)}.`,
      );
    }
  }
}

function assertTargetContextsAreSupported(
  graph: LlmInterpretationOutput,
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  const targetGroupIds = new Set(executionInput.grouping.targetGroups.map((group) => group.id));
  const clauseGroupIds = new Set(executionInput.grouping.clauseGroups.map((group) => group.id));

  for (const [index, targetContext] of (graph.targetContexts ?? []).entries()) {
    const matchedTargetGroup = executionInput.grouping.targetGroups.find((group) =>
      sameIndexes(group.tokenIndexes, targetContext.targetTokenIndexes),
    );

    if (!matchedTargetGroup) {
      throw new AvailabilityInterpretationParseError(
        `targetContexts[${index}].targetTokenIndexes must match an existing target group.`,
      );
    }

    for (const [contextIndex, contextReference] of [
      ...(targetContext.relationContext ?? []).map((entry) => ({ bucket: "relationContext", entry })),
      ...(targetContext.supportingContext ?? []).map((entry) => ({ bucket: "supportingContext", entry })),
    ].entries()) {
      if ((contextReference.relatedTargetGroupIds ?? []).some((groupId) => !targetGroupIds.has(groupId))) {
        throw new AvailabilityInterpretationParseError(
          `targetContexts[${index}] contains unknown relatedTargetGroupIds in context ${contextIndex}.`,
        );
      }

      if ((contextReference.relatedClauseGroupIds ?? []).some((groupId) => !clauseGroupIds.has(groupId))) {
        throw new AvailabilityInterpretationParseError(
          `targetContexts[${index}] contains unknown relatedClauseGroupIds in context ${contextIndex}.`,
        );
      }

      if (
        (contextReference.markerTokenIndexes ?? []).some(
          (tokenIndex) => !isContextMarkerLabel(executionInput.tokens[tokenIndex]?.label),
        )
      ) {
        throw new AvailabilityInterpretationParseError(
          `targetContexts[${index}] markerTokenIndexes must reference supported comparison/context markers.`,
        );
      }
    }
  }
}

function sameIndexes(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return false;
  }

  const normalizedLeft = [...left].sort((a, b) => a - b);
  const normalizedRight = [...right].sort((a, b) => a - b);

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function formatIndexes(indexes: number[]) {
  return `[${[...indexes].sort((a, b) => a - b).join(", ")}]`;
}

function normalizeModelGraphCandidate(
  value: unknown,
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  if (!isRecord(value) || !Array.isArray(value.links)) {
    return value;
  }

  const normalizedLinks: unknown[] = [];

  for (const rawLink of value.links) {
    if (!isRecord(rawLink)) {
      normalizedLinks.push(rawLink);
      continue;
    }

    if (rawLink.relation !== "applies_to") {
      normalizedLinks.push(rawLink);
      continue;
    }

    const targetTokenIndexes = normalizeIndexArray(rawLink.targetTokenIndexes);
    const availabilityTokenIndexes = normalizeIndexArray(rawLink.availabilityTokenIndexes);
    const modifierTokenIndexes = normalizeIndexArray(rawLink.modifierTokenIndexes);

    if (!targetTokenIndexes || !availabilityTokenIndexes) {
      normalizedLinks.push(rawLink);
      continue;
    }

    const clauseGroup = executionInput.grouping.clauseGroups.find((group) => {
      const clauseAvailabilityTokenIndexes =
        executionInput.grouping.availabilityGroups.find((availabilityGroup) => availabilityGroup.id === group.availabilityGroupId)
          ?.tokenIndexes ?? [];

      if (!sameIndexes(clauseAvailabilityTokenIndexes, availabilityTokenIndexes)) {
        return false;
      }

      const candidateTargets = [
        group.appliesToTargetTokenIndexes,
        [...group.appliesToTargetTokenIndexes, ...group.semanticModifierTokenIndexes],
        ...group.contextTargetGroups.map((contextTargetGroup) => contextTargetGroup.tokenIndexes),
      ].filter((indexes) => indexes.length > 0);

      return candidateTargets.some((indexes) => sameIndexes(indexes, targetTokenIndexes));
    });

    if (!clauseGroup) {
      normalizedLinks.push(rawLink);
      continue;
    }

    const nextLink = {
      ...rawLink,
      targetTokenIndexes,
      availabilityTokenIndexes,
      ...(modifierTokenIndexes ? { modifierTokenIndexes } : {}),
    } as Record<string, unknown>;

    const expectedTarget = clauseGroup.appliesToTargetTokenIndexes;
    const expectedModifiers = clauseGroup.semanticModifierTokenIndexes;
    const explicitContextTarget =
      clauseGroup.contextTargetGroups.length === 1 ? clauseGroup.contextTargetGroups[0]?.tokenIndexes : undefined;
    const residualContextTarget = sortIndexes(
      clauseGroup.contextTargetGroups.flatMap((contextTargetGroup) => contextTargetGroup.tokenIndexes),
    );

    if (sameIndexes(targetTokenIndexes, [...expectedTarget, ...expectedModifiers]) && expectedModifiers.length > 0) {
      nextLink.targetTokenIndexes = expectedTarget;
      nextLink.modifierTokenIndexes = expectedModifiers;
    } else if (sameIndexes(targetTokenIndexes, expectedTarget) && expectedModifiers.length > 0) {
      nextLink.modifierTokenIndexes = sameIndexes(modifierTokenIndexes ?? [], expectedModifiers)
        ? modifierTokenIndexes
        : expectedModifiers;
    } else if (
      explicitContextTarget &&
      expectedTarget.length === 1 &&
      isScopeExceptionIndex(expectedTarget[0]!, executionInput) &&
      sameIndexes(targetTokenIndexes, explicitContextTarget)
    ) {
      nextLink.targetTokenIndexes = expectedTarget;
    }

    normalizedLinks.push(nextLink);

    if (
      explicitContextTarget &&
      expectedTarget.length === 1 &&
      isScopeExceptionIndex(expectedTarget[0]!, executionInput) &&
      !value.links.some(
        (candidate) =>
          isRecord(candidate) &&
          candidate.relation === "exception_to" &&
          sameIndexes(normalizeIndexArray(candidate.sourceTokenIndexes) ?? [], expectedTarget) &&
          sameIndexes(normalizeIndexArray(candidate.targetTokenIndexes) ?? [], explicitContextTarget),
      )
    ) {
      normalizedLinks.push({
        relation: "exception_to",
        sourceTokenIndexes: expectedTarget,
        targetTokenIndexes: explicitContextTarget,
        confidence: typeof rawLink.confidence === "string" ? rawLink.confidence : "high",
      });
    }

    if (
      residualContextTarget.length > 0 &&
      expectedTarget.length === 1 &&
      isScopeResidualIndex(expectedTarget[0]!, executionInput) &&
      !value.links.some(
        (candidate) =>
          isRecord(candidate) &&
          candidate.relation === "residual_of" &&
          sameIndexes(normalizeIndexArray(candidate.sourceTokenIndexes) ?? [], expectedTarget),
      )
    ) {
      normalizedLinks.push({
        relation: "residual_of",
        sourceTokenIndexes: expectedTarget,
        targetTokenIndexes: residualContextTarget,
        confidence: typeof rawLink.confidence === "string" ? rawLink.confidence : "high",
      });
    }
  }

  return {
    ...value,
    links: normalizedLinks,
  };
}

function normalizeIndexArray(value: unknown) {
  if (!Array.isArray(value) || value.some((entry) => !Number.isInteger(entry))) {
    return undefined;
  }

  return sortIndexes(value.map((entry) => Number(entry)));
}

function sortIndexes(indexes: number[]) {
  return [...new Set(indexes)].sort((left, right) => left - right);
}

function isScopeExceptionIndex(tokenIndex: number, executionInput: AvailabilityInterpretationExecutionInput) {
  return executionInput.tokens[tokenIndex]?.label === "scope_exception";
}

function isScopeResidualIndex(tokenIndex: number, executionInput: AvailabilityInterpretationExecutionInput) {
  return executionInput.tokens[tokenIndex]?.label === "scope_residual";
}

function isContextMarkerLabel(label: string | undefined) {
  return (
    label === "comparison_marker" ||
    label === "preference_positive_marker" ||
    label === "preference_negative_marker" ||
    label === "emotion_weak_accept_marker" ||
    label === "conditional_marker" ||
    label === "particle_condition" ||
    label === "conjunction_contrast" ||
    label === "scope_exception" ||
    label === "scope_residual"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
