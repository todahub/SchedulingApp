import {
  buildAvailabilityInterpretationExecutionInput,
  type AvailabilityInterpretationExecutionInput,
} from "@/lib/availability-comment-interpretation";
import type { Label } from "@/lib/comment-labeler";
import type {
  AutoInterpretationComparisonPreferenceSignal,
  EventCandidateRecord,
  ParsedConstraintTargetType,
} from "@/lib/domain";

export type ComparisonPreferenceJudgmentKind = "comparison" | "preference";
export type ComparisonPreferenceRelation =
  | "better_than"
  | "worse_than"
  | "preferred"
  | "less_preferred"
  | "unknown";
export type ComparisonPreferenceStrength = "strong" | "weak" | "unknown";
export type ComparisonPreferenceConfidence = "high" | "medium" | "low";

export type ComparisonPreferenceJudgment = {
  groupingHypothesisId: string;
  kind: ComparisonPreferenceJudgmentKind;
  comparedTargetGroupIds: string[];
  preferredTargetGroupId: string | null;
  dispreferredTargetGroupIds?: string[];
  relation: ComparisonPreferenceRelation;
  strength: ComparisonPreferenceStrength;
  confidence: ComparisonPreferenceConfidence;
  triggerTokenIndexes: number[];
  supportingClauseIndexes?: number[];
  notes?: string | null;
};

export type ComparisonPreferenceTargetGroupInput = {
  id: string;
  tokenIndexes: number[];
  texts: string[];
  labels: string[];
  normalizedTexts: string[];
};

export type ComparisonPreferenceClauseHypothesisInput = {
  hypothesisId: string;
  kind: string;
  note: string;
  targetGroups: ComparisonPreferenceTargetGroupInput[];
  localTargetGroupIds: string[];
  contextTargetGroupIds: string[];
};

export type ComparisonPreferenceClauseInput = {
  clauseIndex: number;
  text: string;
  tokenIndexes: number[];
  triggerTokenIndexes: number[];
  triggerTexts: string[];
  groupingHypotheses: ComparisonPreferenceClauseHypothesisInput[];
};

export type ComparisonPreferenceInterpretationInput = {
  originalText: string;
  tokens: Array<{
    index: number;
    text: string;
    label: Label;
    start: number;
    end: number;
    normalizedText?: string;
  }>;
  groupingHypotheses: Array<{
    hypothesisId: string;
    kind: string;
    note: string;
    targetGroups: ComparisonPreferenceTargetGroupInput[];
  }>;
  relevantClauses: ComparisonPreferenceClauseInput[];
};

export type ComparisonPreferenceInterpretationOutput = {
  judgments: ComparisonPreferenceJudgment[];
  warnings: string[];
};

export type ComparisonPreferenceInterpretationErrorStage = "request" | "parse" | "validate";

export type ComparisonPreferenceInterpretationResult = {
  judgments: ComparisonPreferenceJudgment[];
  relevantClauseIndexes: number[];
  warnings: string[];
  rawResponse: string | null;
  error:
    | {
        stage: ComparisonPreferenceInterpretationErrorStage;
        message: string;
      }
    | null;
};

export type ComparisonPreferenceInterpretationOllamaOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
};

export class ComparisonPreferenceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonPreferenceParseError";
  }
}

export class ComparisonPreferenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonPreferenceValidationError";
  }
}

const COMPARISON_PREFERENCE_KIND_VALUES = ["comparison", "preference"] as const satisfies readonly ComparisonPreferenceJudgmentKind[];
const COMPARISON_PREFERENCE_RELATION_VALUES = [
  "better_than",
  "worse_than",
  "preferred",
  "less_preferred",
  "unknown",
] as const satisfies readonly ComparisonPreferenceRelation[];
const COMPARISON_PREFERENCE_STRENGTH_VALUES = ["strong", "weak", "unknown"] as const satisfies readonly ComparisonPreferenceStrength[];
const COMPARISON_PREFERENCE_CONFIDENCE_VALUES = ["high", "medium", "low"] as const satisfies readonly ComparisonPreferenceConfidence[];

const CLAUSE_SIGNAL_LABELS = new Set<Label>([
  "comparison_marker",
  "preference_positive_marker",
  "preference_negative_marker",
  "weak_commitment_marker",
  "strength_marker",
  "uncertainty_marker",
]);

const CLAUSE_TEXT_SIGNAL_PATTERN =
  /より|の方が|ほうが|方が|マシ|いい|良い|希望|理想|助かる|嬉しい|うれしい|ありがたい|避けたい|どっちかといえば|どちらかといえば|どっちでも|でもいい|or/u;

const RANKING_WEEKDAY_VALUES = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "weekday",
  "weekend",
  "weekend_pair",
]);

const RANKING_TIME_VALUES = new Set([
  "morning",
  "noon",
  "afternoon",
  "evening",
  "night",
  "late_night",
  "until_last_train",
  "all_day",
  "overnight",
]);

const COMPARISON_PREFERENCE_SYSTEM_PROMPT = [
  "あなたの役割は、既存の targetGroups / groupingHypotheses を使って、比較・希望の対応付けだけを JSON で返すことです。",
  "新しい日付・曜日・時間帯・可否を作ってはいけません。",
  "targetGroupId は入力に存在するものだけを使ってください。",
  "groupingHypothesisId も入力に存在するものだけを使ってください。",
  "availability の最終判断や ranking の最終決定をしてはいけません。",
  "比較・希望として断定できない場合は preferredTargetGroupId を null にし、relation=unknown, confidence=low を選んでください。",
  "候補にない targetGroup を invent してはいけません。",
  "JSON のみを返してください。",
  "",
  "判断ルール:",
  "- comparison は比較対象が 2 つ以上あるときだけ使う",
  "- preference は単独 target の好ましさでも使ってよい",
  "- comparedTargetGroupIds には判断に使った既存 targetGroupId のみを入れる",
  "- preferredTargetGroupId は不明なら null",
  "- supportingClauseIndexes には根拠 clause の index を入れる",
  "- warnings は自由文の短い文字列配列でよい",
  "",
  "JSON のみを返してください。",
].join("\n");

function normalizeOllamaBaseUrl(baseUrl?: string) {
  const trimmed = typeof baseUrl === "string" && baseUrl.trim().length > 0 ? baseUrl.trim() : "http://127.0.0.1:11434/api";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function summarizeTargetGroup(
  executionInput: AvailabilityInterpretationExecutionInput,
  tokenIndexes: number[],
): ComparisonPreferenceTargetGroupInput {
  const tokens = tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!).filter(Boolean);

  return {
    id: "",
    tokenIndexes,
    texts: tokens.map((token) => token.text),
    labels: tokens.map((token) => token.label),
    normalizedTexts: tokens
      .map((token) => token.normalizedText)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  };
}

function buildClauseBoundaries(executionInput: AvailabilityInterpretationExecutionInput) {
  const clauses: Array<{
    clauseIndex: number;
    text: string;
    tokenIndexes: number[];
    triggerTokenIndexes: number[];
  }> = [];
  let clauseStart = 0;
  let clauseIndex = 0;

  for (let index = 0; index <= executionInput.tokens.length; index += 1) {
    const token = executionInput.tokens[index];
    const isBoundary =
      index === executionInput.tokens.length ||
      token?.label === "punctuation_boundary" ||
      token?.label === "sentence_boundary" ||
      token?.label === "conjunction_contrast";

    if (!isBoundary) {
      continue;
    }

    const clauseTokens = executionInput.tokens.slice(clauseStart, index);

    if (clauseTokens.length > 0) {
      const clauseTokenIndexes = clauseTokens.map((entry) => entry.index);
      const triggerTokenIndexes = clauseTokens
        .filter((entry) => CLAUSE_SIGNAL_LABELS.has(entry.label))
        .map((entry) => entry.index);
      const text = executionInput.originalText.slice(clauseTokens[0]!.start, clauseTokens[clauseTokens.length - 1]!.end);

      clauses.push({
        clauseIndex,
        text,
        tokenIndexes: clauseTokenIndexes,
        triggerTokenIndexes,
      });
      clauseIndex += 1;
    }

    clauseStart = index + 1;
  }

  return clauses;
}

function isClauseRelevant(
  clause: {
    text: string;
    tokenIndexes: number[];
    triggerTokenIndexes: number[];
  },
  executionInput: AvailabilityInterpretationExecutionInput,
  clauseHypotheses: ComparisonPreferenceClauseHypothesisInput[],
) {
  const hasAnyGroupMaterial = clauseHypotheses.some(
    (hypothesis) => hypothesis.localTargetGroupIds.length > 0 || hypothesis.contextTargetGroupIds.length > 0,
  );

  if (!hasAnyGroupMaterial) {
    return false;
  }

  const tokenLabels = new Set(clause.tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!.label));
  const hasExplicitSignal = clause.triggerTokenIndexes.length > 0;
  const hasConditionalSelection =
    (tokenLabels.has("conditional_marker") || tokenLabels.has("particle_condition")) &&
    clauseHypotheses.some((hypothesis) => hypothesis.localTargetGroupIds.length + hypothesis.contextTargetGroupIds.length >= 2);
  const hasTextSignal = CLAUSE_TEXT_SIGNAL_PATTERN.test(clause.text);

  return hasExplicitSignal || hasConditionalSelection || hasTextSignal;
}

function buildTargetGroupMap(input: ComparisonPreferenceInterpretationInput) {
  const targetGroupMap = new Map<string, ComparisonPreferenceTargetGroupInput>();

  for (const hypothesis of input.groupingHypotheses) {
    for (const group of hypothesis.targetGroups) {
      if (!targetGroupMap.has(group.id)) {
        targetGroupMap.set(group.id, group);
      }
    }
  }

  return targetGroupMap;
}

function normalizeRankingWeekdayValue(value: string) {
  if (value.includes("+")) {
    return null;
  }

  if (!RANKING_WEEKDAY_VALUES.has(value)) {
    return null;
  }

  return value === "weekend_pair" ? "weekend" : value;
}

function normalizeRankingTimeValue(value: string) {
  if (!RANKING_TIME_VALUES.has(value)) {
    return null;
  }

  switch (value) {
    case "morning":
      return "morning";
    case "noon":
    case "afternoon":
      return "day";
    case "evening":
    case "night":
    case "late_night":
    case "until_last_train":
      return "night";
    case "all_day":
    case "overnight":
      return "all_day";
    default:
      return null;
  }
}

function toRankingSignalTarget(
  group: ComparisonPreferenceTargetGroupInput,
): {
  targetType: ParsedConstraintTargetType;
  targetValue: string;
  targetText: string;
  notes: string[];
} | null {
  const dateLikeLabels = group.labels.filter((label) =>
    label === "target_date" ||
    label === "target_date_range" ||
    label === "target_weekday" ||
    label === "target_weekday_group",
  );
  const timeLabels = group.labels.filter((label) => label === "target_time_of_day");

  if (group.labels.includes("target_date_range") || dateLikeLabels.length > 1 || timeLabels.length > 1) {
    return null;
  }

  const dateValue = group.normalizedTexts.find((value) => /^\d{4}-\d{2}-\d{2}$/u.test(value)) ?? null;
  const weekdayValue = group.normalizedTexts.find((value) => RANKING_WEEKDAY_VALUES.has(value) || value.includes("+")) ?? null;
  const timeValue = group.normalizedTexts.find((value) => RANKING_TIME_VALUES.has(value)) ?? null;
  const normalizedWeekdayValue = weekdayValue ? normalizeRankingWeekdayValue(weekdayValue) : null;
  const normalizedTimeValue = timeValue ? normalizeRankingTimeValue(timeValue) : null;
  const notes: string[] = [];

  if (weekdayValue === "weekend_pair") {
    notes.push("normalized_weekend_pair_to_weekend");
  }

  if (dateValue && normalizedTimeValue) {
    return {
      targetType: "date_time",
      targetValue: `${dateValue}_${normalizedTimeValue}`,
      targetText: group.texts.join(""),
      notes,
    };
  }

  if (normalizedWeekdayValue && normalizedTimeValue) {
    return {
      targetType: "date_time",
      targetValue: `${normalizedWeekdayValue}_${normalizedTimeValue}`,
      targetText: group.texts.join(""),
      notes,
    };
  }

  if (dateValue) {
    return {
      targetType: "date",
      targetValue: dateValue,
      targetText: group.texts.join(""),
      notes,
    };
  }

  if (normalizedWeekdayValue) {
    return {
      targetType: "weekday",
      targetValue: normalizedWeekdayValue,
      targetText: group.texts.join(""),
      notes,
    };
  }

  if (normalizedTimeValue) {
    return {
      targetType: "time",
      targetValue: normalizedTimeValue,
      targetText: group.texts.join(""),
      notes,
    };
  }

  return null;
}

export function buildRankingPreferenceSignalsFromJudgments(
  input: ComparisonPreferenceInterpretationInput,
  judgments: ComparisonPreferenceJudgment[],
): AutoInterpretationComparisonPreferenceSignal[] {
  const targetGroupMap = buildTargetGroupMap(input);
  const signals: AutoInterpretationComparisonPreferenceSignal[] = [];
  const seen = new Set<string>();

  for (const [judgmentIndex, judgment] of judgments.entries()) {
    if (judgment.relation === "unknown" || !judgment.preferredTargetGroupId) {
      continue;
    }

    const preferredGroup = targetGroupMap.get(judgment.preferredTargetGroupId);
    const preferredTarget = preferredGroup ? toRankingSignalTarget(preferredGroup) : null;

    if (preferredGroup && preferredTarget) {
      const preferredSignal: AutoInterpretationComparisonPreferenceSignal = {
        targetGroupId: preferredGroup.id,
        targetType: preferredTarget.targetType,
        targetValue: preferredTarget.targetValue,
        targetText: preferredTarget.targetText,
        signal: "preferred",
        strength: judgment.strength,
        confidence: judgment.confidence,
        sourceJudgmentIndex: judgmentIndex,
        sourceComment: input.originalText,
        notes: preferredTarget.notes,
      };
      const key = JSON.stringify(preferredSignal);

      if (!seen.has(key)) {
        seen.add(key);
        signals.push(preferredSignal);
      }
    }

    const dispreferredTargetGroupIds = new Set(judgment.dispreferredTargetGroupIds ?? []);

    if (dispreferredTargetGroupIds.size === 0 && judgment.kind === "comparison") {
      for (const targetGroupId of judgment.comparedTargetGroupIds) {
        if (targetGroupId !== judgment.preferredTargetGroupId) {
          dispreferredTargetGroupIds.add(targetGroupId);
        }
      }
    }

    for (const targetGroupId of dispreferredTargetGroupIds) {
      if (targetGroupId === judgment.preferredTargetGroupId) {
        continue;
      }

      const dispreferredGroup = targetGroupMap.get(targetGroupId);
      const dispreferredTarget = dispreferredGroup ? toRankingSignalTarget(dispreferredGroup) : null;

      if (!dispreferredGroup || !dispreferredTarget) {
        continue;
      }

      if (
        preferredTarget &&
        preferredTarget.targetType === dispreferredTarget.targetType &&
        preferredTarget.targetValue === dispreferredTarget.targetValue
      ) {
        continue;
      }

      const dispreferredSignal: AutoInterpretationComparisonPreferenceSignal = {
        targetGroupId: dispreferredGroup.id,
        targetType: dispreferredTarget.targetType,
        targetValue: dispreferredTarget.targetValue,
        targetText: dispreferredTarget.targetText,
        signal: "dispreferred",
        strength: judgment.strength,
        confidence: judgment.confidence,
        sourceJudgmentIndex: judgmentIndex,
        sourceComment: input.originalText,
        notes: dispreferredTarget.notes,
      };
      const key = JSON.stringify(dispreferredSignal);

      if (!seen.has(key)) {
        seen.add(key);
        signals.push(dispreferredSignal);
      }
    }
  }

  return signals;
}

export function buildComparisonPreferenceInterpretationInput(
  comment: string,
  candidates: EventCandidateRecord[],
): ComparisonPreferenceInterpretationInput {
  const executionInput = buildAvailabilityInterpretationExecutionInput(comment, candidates);
  const clauses = buildClauseBoundaries(executionInput);
  const groupingHypotheses = executionInput.groupingHypotheses.map((hypothesis) => ({
    hypothesisId: hypothesis.id,
    kind: hypothesis.kind,
    note: hypothesis.note,
    targetGroups: hypothesis.grouping.targetGroups.map((group) => ({
      ...summarizeTargetGroup(executionInput, group.tokenIndexes),
      id: group.id,
    })),
  }));

  const relevantClauses = clauses
    .map((clause) => {
      const clauseTokenIndexSet = new Set(clause.tokenIndexes);
      const minClauseTokenIndex = Math.min(...clause.tokenIndexes);
      const clauseHypotheses = executionInput.groupingHypotheses.map((hypothesis) => {
        const targetGroups = hypothesis.grouping.targetGroups.map((group) => ({
          ...summarizeTargetGroup(executionInput, group.tokenIndexes),
          id: group.id,
        }));
        const localTargetGroupIds = hypothesis.grouping.targetGroups
          .filter((group) => group.tokenIndexes.every((tokenIndex) => clauseTokenIndexSet.has(tokenIndex)))
          .map((group) => group.id);
        const contextTargetGroupIds = hypothesis.grouping.targetGroups
          .filter((group) => Math.max(...group.tokenIndexes) < minClauseTokenIndex)
          .map((group) => group.id);

        return {
          hypothesisId: hypothesis.id,
          kind: hypothesis.kind,
          note: hypothesis.note,
          targetGroups,
          localTargetGroupIds,
          contextTargetGroupIds,
        } satisfies ComparisonPreferenceClauseHypothesisInput;
      });

      return {
        clauseIndex: clause.clauseIndex,
        text: clause.text,
        tokenIndexes: clause.tokenIndexes,
        triggerTokenIndexes: clause.triggerTokenIndexes,
        triggerTexts: clause.triggerTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]!.text),
        groupingHypotheses: clauseHypotheses,
      } satisfies ComparisonPreferenceClauseInput;
    })
    .filter((clause) => isClauseRelevant(clause, executionInput, clause.groupingHypotheses));

  return {
    originalText: executionInput.originalText,
    tokens: executionInput.tokens.map((token) => ({
      index: token.index,
      text: token.text,
      label: token.label,
      start: token.start,
      end: token.end,
      ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
    })),
    groupingHypotheses,
    relevantClauses,
  };
}

export function buildComparisonPreferencePrompt(input: ComparisonPreferenceInterpretationInput) {
  return [
    "relevantClauses に対して、比較・希望の局所判断だけを返してください。",
    "targetGroupId と groupingHypothesisId は入力に存在するものだけを使ってください。",
    "availability を解釈しないでください。",
    "ランキングを決めないでください。",
    "JSON のみを返してください。",
    "",
    "出力形式:",
    '{ "judgments": [{ "groupingHypothesisId": "...", "kind": "comparison|preference", "comparedTargetGroupIds": ["..."], "preferredTargetGroupId": "..." | null, "dispreferredTargetGroupIds": ["..."], "relation": "better_than|worse_than|preferred|less_preferred|unknown", "strength": "strong|weak|unknown", "confidence": "high|medium|low", "triggerTokenIndexes": [0], "supportingClauseIndexes": [0], "notes": null }], "warnings": [] }',
    "",
    "入力:",
    JSON.stringify(input, null, 2),
    "",
    "JSON のみを返してください。",
  ].join("\n");
}

export function buildComparisonPreferenceMessages(input: ComparisonPreferenceInterpretationInput) {
  return {
    systemPrompt: COMPARISON_PREFERENCE_SYSTEM_PROMPT,
    userPrompt: buildComparisonPreferencePrompt(input),
  };
}

export function parseComparisonPreferenceResponse(responseText: string): unknown {
  const trimmed = responseText.trim();

  if (!trimmed) {
    throw new ComparisonPreferenceParseError("Comparison/preference LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new ComparisonPreferenceParseError("Comparison/preference LLM response was not valid JSON.");
  }
}

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ComparisonPreferenceValidationError(message);
  }

  return value as Record<string, unknown>;
}

function validateStringArray(value: unknown, fieldName: string, options: { allowEmpty?: boolean } = {}) {
  if (!Array.isArray(value)) {
    throw new ComparisonPreferenceValidationError(`${fieldName} must be an array of strings.`);
  }

  if (!options.allowEmpty && value.length === 0) {
    throw new ComparisonPreferenceValidationError(`${fieldName} must not be empty.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new ComparisonPreferenceValidationError(`${fieldName}[${index}] must be a non-empty string.`);
    }

    return entry.trim();
  });
}

function validateIndexArray(
  value: unknown,
  fieldName: string,
  upperBound: number,
  options: { allowEmpty?: boolean } = {},
) {
  if (!Array.isArray(value)) {
    throw new ComparisonPreferenceValidationError(`${fieldName} must be an array of indexes.`);
  }

  if (!options.allowEmpty && value.length === 0) {
    throw new ComparisonPreferenceValidationError(`${fieldName} must not be empty.`);
  }

  const indexes = value.map((entry, index) => {
    if (!Number.isInteger(entry)) {
      throw new ComparisonPreferenceValidationError(`${fieldName}[${index}] must be an integer.`);
    }

    const numericEntry = Number(entry);

    if (numericEntry < 0 || numericEntry >= upperBound) {
      throw new ComparisonPreferenceValidationError(`${fieldName}[${index}] is out of range.`);
    }

    return numericEntry;
  });

  return [...new Set(indexes)].sort((left, right) => left - right);
}

function validateSupportingClauseIndexes(
  value: unknown,
  input: ComparisonPreferenceInterpretationInput,
) {
  if (!Array.isArray(value)) {
    throw new ComparisonPreferenceValidationError("supportingClauseIndexes must be an array of clause indexes.");
  }

  const allowedClauseIndexes = new Set(input.relevantClauses.map((clause) => clause.clauseIndex));
  const clauseIndexes = value.map((entry, index) => {
    if (!Number.isInteger(entry)) {
      throw new ComparisonPreferenceValidationError(`supportingClauseIndexes[${index}] must be an integer.`);
    }

    const numericEntry = Number(entry);

    if (!allowedClauseIndexes.has(numericEntry)) {
      throw new ComparisonPreferenceValidationError(
        `supportingClauseIndexes[${index}] must reference a relevant clause index.`,
      );
    }

    return numericEntry;
  });

  return [...new Set(clauseIndexes)].sort((left, right) => left - right);
}

function buildHypothesisMaps(input: ComparisonPreferenceInterpretationInput) {
  const hypothesisMap = new Map(
    input.groupingHypotheses.map((hypothesis) => [
      hypothesis.hypothesisId,
      {
        groupIds: new Set(hypothesis.targetGroups.map((group) => group.id)),
      },
    ]),
  );

  const clauseMap = new Map(
    input.relevantClauses.map((clause) => [
      clause.clauseIndex,
      new Map(
        clause.groupingHypotheses.map((hypothesis) => [
          hypothesis.hypothesisId,
          new Set([...hypothesis.localTargetGroupIds, ...hypothesis.contextTargetGroupIds]),
        ]),
      ),
    ]),
  );

  return {
    hypothesisMap,
    clauseMap,
  };
}

function validateJudgment(
  value: unknown,
  input: ComparisonPreferenceInterpretationInput,
  maps: ReturnType<typeof buildHypothesisMaps>,
): ComparisonPreferenceJudgment {
  const record = assertObject(value, "Each judgment must be an object.");
  const allowedKeys = new Set([
    "groupingHypothesisId",
    "kind",
    "comparedTargetGroupIds",
    "preferredTargetGroupId",
    "dispreferredTargetGroupIds",
    "relation",
    "strength",
    "confidence",
    "triggerTokenIndexes",
    "supportingClauseIndexes",
    "notes",
  ]);

  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new ComparisonPreferenceValidationError("Judgment contains unsupported fields.");
  }

  const groupingHypothesisId = record.groupingHypothesisId;
  if (typeof groupingHypothesisId !== "string" || !maps.hypothesisMap.has(groupingHypothesisId)) {
    throw new ComparisonPreferenceValidationError("groupingHypothesisId must reference an existing grouping hypothesis.");
  }

  const kind = record.kind;
  if (typeof kind !== "string" || !COMPARISON_PREFERENCE_KIND_VALUES.includes(kind as ComparisonPreferenceJudgmentKind)) {
    throw new ComparisonPreferenceValidationError("kind is unsupported.");
  }

  const comparedTargetGroupIds = validateStringArray(record.comparedTargetGroupIds, "comparedTargetGroupIds");
  const hypothesisGroupIds = maps.hypothesisMap.get(groupingHypothesisId)!.groupIds;

  if (comparedTargetGroupIds.some((groupId) => !hypothesisGroupIds.has(groupId))) {
    throw new ComparisonPreferenceValidationError("comparedTargetGroupIds must reference existing target groups in the chosen hypothesis.");
  }

  if (kind === "comparison" && comparedTargetGroupIds.length < 2) {
    throw new ComparisonPreferenceValidationError("comparison judgments must compare at least two target groups.");
  }

  const preferredTargetGroupId = record.preferredTargetGroupId;
  if (preferredTargetGroupId !== null && preferredTargetGroupId !== undefined) {
    if (typeof preferredTargetGroupId !== "string" || !hypothesisGroupIds.has(preferredTargetGroupId)) {
      throw new ComparisonPreferenceValidationError("preferredTargetGroupId must reference an existing target group or be null.");
    }

    if (!comparedTargetGroupIds.includes(preferredTargetGroupId)) {
      throw new ComparisonPreferenceValidationError("preferredTargetGroupId must also appear in comparedTargetGroupIds.");
    }
  }

  let dispreferredTargetGroupIds: string[] | undefined;
  if (record.dispreferredTargetGroupIds !== undefined) {
    dispreferredTargetGroupIds = validateStringArray(record.dispreferredTargetGroupIds, "dispreferredTargetGroupIds", {
      allowEmpty: true,
    });

    if (dispreferredTargetGroupIds.some((groupId) => !comparedTargetGroupIds.includes(groupId))) {
      throw new ComparisonPreferenceValidationError("dispreferredTargetGroupIds must be a subset of comparedTargetGroupIds.");
    }
  }

  const relation = record.relation;
  if (
    typeof relation !== "string" ||
    !COMPARISON_PREFERENCE_RELATION_VALUES.includes(relation as ComparisonPreferenceRelation)
  ) {
    throw new ComparisonPreferenceValidationError("relation is unsupported.");
  }

  const strength = record.strength;
  if (
    typeof strength !== "string" ||
    !COMPARISON_PREFERENCE_STRENGTH_VALUES.includes(strength as ComparisonPreferenceStrength)
  ) {
    throw new ComparisonPreferenceValidationError("strength is unsupported.");
  }

  const confidence = record.confidence;
  if (
    typeof confidence !== "string" ||
    !COMPARISON_PREFERENCE_CONFIDENCE_VALUES.includes(confidence as ComparisonPreferenceConfidence)
  ) {
    throw new ComparisonPreferenceValidationError("confidence is unsupported.");
  }

  const triggerTokenIndexes = validateIndexArray(record.triggerTokenIndexes, "triggerTokenIndexes", input.tokens.length);
  const supportingClauseIndexes = record.supportingClauseIndexes !== undefined
    ? validateSupportingClauseIndexes(record.supportingClauseIndexes, input)
    : undefined;

  if (supportingClauseIndexes && supportingClauseIndexes.length > 0) {
    const clauseTokenSet = new Set(
      supportingClauseIndexes.flatMap((clauseIndex) => input.relevantClauses.find((clause) => clause.clauseIndex === clauseIndex)?.tokenIndexes ?? []),
    );

    if (triggerTokenIndexes.some((tokenIndex) => !clauseTokenSet.has(tokenIndex))) {
      throw new ComparisonPreferenceValidationError("triggerTokenIndexes must belong to the supporting clauses.");
    }

    const allowedGroupIds = new Set(
      supportingClauseIndexes.flatMap((clauseIndex) => {
        const clauseHypotheses = maps.clauseMap.get(clauseIndex);
        const groupIds = clauseHypotheses?.get(groupingHypothesisId);
        return groupIds ? [...groupIds] : [];
      }),
    );

    if (comparedTargetGroupIds.some((groupId) => !allowedGroupIds.has(groupId))) {
      throw new ComparisonPreferenceValidationError(
        "comparedTargetGroupIds must be available from the supporting clauses under the chosen hypothesis.",
      );
    }
  }

  let notes: string | null | undefined;
  if (record.notes !== undefined) {
    if (record.notes !== null && (typeof record.notes !== "string" || record.notes.trim().length === 0)) {
      throw new ComparisonPreferenceValidationError("notes must be null or a non-empty string.");
    }

    notes = typeof record.notes === "string" ? record.notes.trim() : null;
  }

  return {
    groupingHypothesisId,
    kind,
    comparedTargetGroupIds,
    preferredTargetGroupId: preferredTargetGroupId ?? null,
    ...(dispreferredTargetGroupIds ? { dispreferredTargetGroupIds } : {}),
    relation,
    strength,
    confidence,
    triggerTokenIndexes,
    ...(supportingClauseIndexes ? { supportingClauseIndexes } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

export function validateComparisonPreferenceOutput(
  parsed: unknown,
  input: ComparisonPreferenceInterpretationInput,
): ComparisonPreferenceInterpretationOutput {
  const record = assertObject(parsed, "Comparison/preference output must be a JSON object.");
  const allowedKeys = new Set(["judgments", "warnings"]);

  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new ComparisonPreferenceValidationError("Comparison/preference output contains unsupported fields.");
  }

  if (!Array.isArray(record.judgments) || !Array.isArray(record.warnings)) {
    throw new ComparisonPreferenceValidationError("judgments and warnings must both be arrays.");
  }

  const maps = buildHypothesisMaps(input);

  return {
    judgments: record.judgments.map((judgment) => validateJudgment(judgment, input, maps)),
    warnings: validateStringArray(record.warnings, "warnings", { allowEmpty: true }),
  };
}

export async function callOllamaForComparisonPreferenceInterpretation(
  input: ComparisonPreferenceInterpretationInput,
  options: ComparisonPreferenceInterpretationOllamaOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeOllamaBaseUrl(options.baseUrl ?? process.env.OLLAMA_BASE_URL);
  const model = options.model ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const prompts = buildComparisonPreferenceMessages(input);
    const response = await fetchImpl(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: {
          type: "object",
          additionalProperties: false,
          properties: {
            judgments: {
              type: "array",
              items: {
                type: "object",
              },
            },
            warnings: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
          required: ["judgments", "warnings"],
        },
        messages: [
          { role: "system", content: prompts.systemPrompt },
          { role: "user", content: prompts.userPrompt },
        ],
      }),
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function interpretComparisonPreferences(
  comment: string,
  candidates: EventCandidateRecord[],
  options: ComparisonPreferenceInterpretationOllamaOptions = {},
): Promise<ComparisonPreferenceInterpretationResult> {
  const input = buildComparisonPreferenceInterpretationInput(comment, candidates);
  const relevantClauseIndexes = input.relevantClauses.map((clause) => clause.clauseIndex);

  if (input.relevantClauses.length === 0) {
    return {
      judgments: [],
      relevantClauseIndexes,
      warnings: [],
      rawResponse: null,
      error: null,
    };
  }

  let rawResponse: string | null = null;

  try {
    rawResponse = await callOllamaForComparisonPreferenceInterpretation(input, options);
  } catch (error) {
    return {
      judgments: [],
      relevantClauseIndexes,
      warnings: [error instanceof Error ? error.message : "Comparison/preference request failed."],
      rawResponse,
      error: {
        stage: "request",
        message: error instanceof Error ? error.message : "Comparison/preference request failed.",
      },
    };
  }

  let parsed: unknown;

  try {
    parsed = parseComparisonPreferenceResponse(rawResponse);
  } catch (error) {
    return {
      judgments: [],
      relevantClauseIndexes,
      warnings: [error instanceof Error ? error.message : "Comparison/preference response could not be parsed."],
      rawResponse,
      error: {
        stage: "parse",
        message: error instanceof Error ? error.message : "Comparison/preference response could not be parsed.",
      },
    };
  }

  try {
    const validated = validateComparisonPreferenceOutput(parsed, input);

    return {
      judgments: validated.judgments,
      relevantClauseIndexes,
      warnings: validated.warnings,
      rawResponse,
      error: null,
    };
  } catch (error) {
    return {
      judgments: [],
      relevantClauseIndexes,
      warnings: [error instanceof Error ? error.message : "Comparison/preference output failed validation."],
      rawResponse,
      error: {
        stage: "validate",
        message: error instanceof Error ? error.message : "Comparison/preference output failed validation.",
      },
    };
  }
}
