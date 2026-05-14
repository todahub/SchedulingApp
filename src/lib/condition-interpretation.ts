import type { AvailabilityInterpretationExecutionInput } from "@/lib/availability-comment-interpretation";
import type { Label } from "@/lib/comment-labeler";
import { requestStructuredJsonFromLlm } from "@/lib/llm-client";
import type { LlmProvider } from "@/lib/runtime-environment";
import type {
  AutoInterpretationCondition,
  AutoInterpretationConditionAcceptedLevel,
  AutoInterpretationConditionComparator,
  AutoInterpretationConditionConfidence,
  AutoInterpretationConditionKind,
  AutoInterpretationConditionParticipantScope,
  AutoInterpretationConditionResolvedAvailabilityLevel,
  AutoInterpretationConditionResolvedPreferenceLevel,
  AutoInterpretationConditionResolverType,
  AutoInterpretationConditionUnresolvedBehavior,
  AutoInterpretationPreference,
  AutoInterpretationRule,
  AutoInterpretationTargetContext,
} from "@/lib/domain";

export type ConditionInterpretationPreferenceInput = {
  targetTokenIndexes: number[];
  targetText: string;
  level: AutoInterpretationPreference["level"];
  markerTokenIndexes: number[];
  markerLabels: string[];
};

export type ConditionInterpretationAvailabilityRuleInput = {
  targetTokenIndexes: number[];
  targetText: string;
  availabilityLabel: AutoInterpretationRule["availabilityLabel"];
  availabilityText: string;
  modifierTokenIndexes: number[];
  modifierLabels: string[];
};

export type ConditionInterpretationClauseInput = {
  clauseIndex: number;
  text: string;
  tokenIndexes: number[];
  targetGroupIds: string[];
  signalTokenIndexes: number[];
  signalTexts: string[];
};

export type ConditionInterpretationInput = {
  originalText: string;
  tokens: Array<{
    index: number;
    text: string;
    label: Label;
    normalizedText?: string;
  }>;
  finalPreferences: ConditionInterpretationPreferenceInput[];
  availabilityRules: ConditionInterpretationAvailabilityRuleInput[];
  targetContexts: AutoInterpretationTargetContext[];
  relevantClauses: ConditionInterpretationClauseInput[];
};

export type ConditionInterpretationOutput = {
  conditions: AutoInterpretationCondition[];
  warnings: string[];
};

export type ConditionInterpretationErrorStage = "request" | "parse" | "validate";

export type ConditionInterpretationResult = {
  conditions: AutoInterpretationCondition[];
  relevantClauseIndexes: number[];
  warnings: string[];
  rawResponse: string | null;
  error:
    | {
        stage: ConditionInterpretationErrorStage;
        message: string;
      }
    | null;
};

export type ConditionInterpretationOllamaOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
  provider?: LlmProvider;
  apiKey?: string;
  timeoutMs?: number;
};

export class ConditionInterpretationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionInterpretationParseError";
  }
}

export class ConditionInterpretationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionInterpretationValidationError";
  }
}

const CONDITION_KIND_VALUES = [
  "self_condition",
  "others_condition",
  "outcome_condition",
  "unknown_condition",
] as const satisfies readonly AutoInterpretationConditionKind[];

const CONDITION_RESOLVER_VALUES = [
  "all_others_available",
  "attendance_threshold",
  "unique_unanimous_candidate",
  "best_attendance_candidate",
  "self_convenience",
  "unknown",
] as const satisfies readonly AutoInterpretationConditionResolverType[];

const CONDITION_PARTICIPANT_SCOPE_VALUES = [
  "self_only",
  "all_others",
  "everyone",
  "unknown",
] as const satisfies readonly AutoInterpretationConditionParticipantScope[];

const CONDITION_COMPARATOR_VALUES = [
  ">=",
  ">",
  "==",
  "<=",
  "<",
] as const satisfies readonly AutoInterpretationConditionComparator[];

const CONDITION_ACCEPTED_LEVEL_VALUES = [
  "strong_yes",
  "soft_yes",
  "conditional",
] as const satisfies readonly AutoInterpretationConditionAcceptedLevel[];

const CONDITION_CONFIDENCE_VALUES = ["high", "medium", "low"] as const satisfies readonly AutoInterpretationConditionConfidence[];

const CONDITION_UNRESOLVED_BEHAVIOR_VALUES = [
  "blocked",
  "ignore",
] as const satisfies readonly AutoInterpretationConditionUnresolvedBehavior[];

const CONDITION_RESOLVED_AVAILABILITY_LEVEL_VALUES = [
  "conditional",
  "soft_yes",
  "strong_yes",
] as const satisfies readonly AutoInterpretationConditionResolvedAvailabilityLevel[];

const CONDITION_RESOLVED_PREFERENCE_LEVEL_VALUES = [
  "weak_accept",
  "preferred",
  "strong_preferred",
] as const satisfies readonly AutoInterpretationConditionResolvedPreferenceLevel[];

const CONDITION_SIGNAL_LABELS = new Set<Label>([
  "conditional_marker",
  "particle_condition",
  "hypothetical_marker",
  "comparison_marker",
  "preference_positive_marker",
  "preference_negative_marker",
  "emotion_weak_accept_marker",
  "strength_marker",
  "uncertainty_marker",
  "conjunction_contrast",
]);

const CONDITION_TEXT_SIGNAL_PATTERN =
  /なら|ならば|場合|みんな|全員|他の人|ほかの人|全会一致|この日しか|一番|最も|人が集まり|都合/u;

const CONFIRMED_RANKING_CONDITION_PATTERN =
  /みんな|全員|他の人|ほかの人|全会一致|この日しか|一番|最も|人が集まり|都合|[0-9０-９]+人以上/u;

const CONDITION_INTERPRETATION_SYSTEM_PROMPT = [
  "あなたの役割は、コメント中の条件文を構造化して JSON で返すことです。",
  "あなたは ranking を決めません。",
  "あなたは条件が今成立しているかどうかを判定しません。",
  "あなたは条件の意味と、後段 resolver が使う解決ルールだけを返します。",
  "",
  "優先順位:",
  "1. schema を守る。",
  "2. 入力に明示された条件効果だけを返す。",
  "3. 暗黙の本音や baseline の dislike / no を invent しない。",
  "4. わからなければ conditions を空にする。",
  "",
  "禁止事項:",
  "- 新しい日付、新しい時間、新しい target、新しい participant、新しい availability を作ってはいけません。",
  "- 条件が未達成のときの hidden preference / hidden dislike / hidden no を推定してはいけません。",
  "- 比較だけの文を condition として返してはいけません。",
  "- 単なる availability 文を condition として返してはいけません。",
  "- 自由記述の説明文や notes は返してはいけません。",
  "",
  "返してよい top-level key は conditions と warnings だけです。",
  "conditions の各 object には定義された key だけを入れてください。余計な key を入れてはいけません。",
  "threshold は attendance_threshold の時だけ入れてよく、それ以外では入れないでください。",
  "sourcePreferenceTargetTokenIndexes は、その条件が finalPreferences の target にかかると確信できる時だけ入れてください。",
  "targetTokenIndexes は入力の既存 targetGroup と一致する token index 配列だけを使ってください。",
  "supportingClauseIndexes は relevantClauses の clauseIndex だけを使ってください。",
  "requiredAvailabilityLevels は strong_yes / soft_yes / conditional だけを使ってください。",
  "unresolvedBehavior は blocked か ignore だけを使ってください。",
  "resolvedAvailabilityLevel は conditional / soft_yes / strong_yes のどれか、または null です。",
  "resolvedPreferenceLevel は weak_accept / preferred / strong_preferred のどれか、または null です。",
  "",
  "条件の分類:",
  "- self_condition: 話し手本人の都合・感覚・予定に依存する条件",
  "- others_condition: 他の参加者の可否状況で解ける条件",
  "- outcome_condition: 全候補の集計結果やランキング結果で解ける条件",
  "- unknown_condition: 安全に分類できない条件",
  "",
  "resolverType の意味:",
  "- all_others_available: 他の全参加者が可なら成立",
  "- attendance_threshold: 可の人数が一定以上なら成立",
  "- unique_unanimous_candidate: その候補だけが全会一致なら成立",
  "- best_attendance_candidate: 最も多くの人が来られる候補なら成立",
  "- self_convenience: 本人都合のため自動判定しない",
  "- unknown: 解決ルールを安全に決められない",
  "",
  "条件の扱い:",
  "- unresolvedBehavior=blocked: 条件が満たされるまで今のランキングでは採用しない",
  "- unresolvedBehavior=ignore: 条件が未達成でも基底状態を維持する",
  "- resolvedAvailabilityLevel: 条件成立時に availability をどこまで上げるか",
  "- resolvedPreferenceLevel: 条件成立時に明示的な好みをどこまで付与するか",
  "",
  "出力ルール:",
  "1. 条件が target にかかっている場合だけ condition record を返す。",
  "2. 条件が他人依存なら others_condition を優先する。",
  "3. 条件が全会一致・最大参加・最有力など全体結果依存なら outcome_condition を優先する。",
  "4. 話し手本人の都合なら self_condition にする。",
  "5. 自信がなければ unknown_condition にする。",
  "6. threshold が読み取れない attendance_threshold は出さない。",
  "7. 条件を満たすまで候補を今は採用しない意味なら unresolvedBehavior は blocked にする。",
  "8. 条件成立時に候補へ戻す/行けるようになるなら resolvedAvailabilityLevel を入れる。",
  "9. 条件成立時に「いい」「でもいい」「いいよ」などの明示的な好みが付くなら resolvedPreferenceLevel を入れる。",
  "10. 不確かなら壊れた condition を返すより conditions を空にしてください。",
  "",
  "例:",
  '- 「他の人がみんな行けるなら11がいい」 -> others_condition / all_others_available / unresolvedBehavior=blocked / resolvedAvailabilityLevel=soft_yes / resolvedPreferenceLevel=preferred',
  '- 「3人以上来れるなら11でもいい」 -> others_condition / attendance_threshold / unresolvedBehavior=blocked / resolvedAvailabilityLevel=soft_yes / resolvedPreferenceLevel=weak_accept / threshold >= 3',
  '- 「この日しか全会一致がなさそうなら11がいい」 -> outcome_condition / unique_unanimous_candidate / unresolvedBehavior=blocked / resolvedAvailabilityLevel=soft_yes / resolvedPreferenceLevel=preferred',
  '- 「一番人が集まりそうなら11でもいい」 -> outcome_condition / best_attendance_candidate / unresolvedBehavior=blocked / resolvedAvailabilityLevel=soft_yes / resolvedPreferenceLevel=weak_accept',
  '- 「この日なら都合良さそう」 -> self_condition / self_convenience / unresolvedBehavior=blocked / resolvedAvailabilityLevel=conditional',
  "",
  "返答前に確認:",
  "- targetTokenIndexes は入力にある target だけか。",
  "- unresolvedBehavior と resolvedAvailabilityLevel / resolvedPreferenceLevel が条件文の明示内容だけから決まっているか。",
  "- hidden dislike / hidden no を勝手に推定していないか。",
  "",
  "JSON のみを返してください。",
].join("\n");

function splitClauses(
  executionInput: AvailabilityInterpretationExecutionInput,
) {
  const clauses: Array<{
    clauseIndex: number;
    tokenIndexes: number[];
  }> = [];
  let start = 0;
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

    const tokenIndexes = executionInput.tokens
      .slice(start, index)
      .map((candidate) => candidate.index);

    if (tokenIndexes.length > 0) {
      clauses.push({
        clauseIndex,
        tokenIndexes,
      });
      clauseIndex += 1;
    }

    start = index === executionInput.tokens.length ? index : index + 1;
  }

  return clauses;
}

function formatClauseText(
  executionInput: AvailabilityInterpretationExecutionInput,
  tokenIndexes: number[],
) {
  return tokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]?.text ?? "").join("").trim();
}

function summarizePreferences(
  preferences: AutoInterpretationPreference[],
): ConditionInterpretationPreferenceInput[] {
  return preferences.map((preference) => ({
    targetTokenIndexes: [...preference.targetTokenIndexes],
    targetText: preference.targetText,
    level: preference.level,
    markerTokenIndexes: [...preference.markerTokenIndexes],
    markerLabels: [...preference.markerLabels],
  }));
}

function summarizeAvailabilityRules(
  rules: AutoInterpretationRule[],
): ConditionInterpretationAvailabilityRuleInput[] {
  return rules.map((rule) => ({
    targetTokenIndexes: [...rule.targetTokenIndexes],
    targetText: rule.targetText,
    availabilityLabel: rule.availabilityLabel,
    availabilityText: rule.availabilityText,
    modifierTokenIndexes: [...rule.modifierTokenIndexes],
    modifierLabels: [...rule.modifierLabels],
  }));
}

function areSameTokenIndexes(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);

  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function hasComparisonCandidateContext(
  targetTokenIndexes: number[],
  targetContexts: AutoInterpretationTargetContext[],
) {
  return targetContexts
    .filter((context) => areSameTokenIndexes(context.targetTokenIndexes, targetTokenIndexes))
    .some((context) =>
      [...(context.relationContext ?? []), ...(context.supportingContext ?? [])].some(
        (candidate) => candidate.hint === "comparison_candidate",
      ),
    );
}

function hasConfirmedRankingConditionSignals(
  clauseText: string,
  tokenTexts: string[],
  originalText?: string,
) {
  return (
    CONFIRMED_RANKING_CONDITION_PATTERN.test(clauseText) ||
    tokenTexts.some((text) => CONFIRMED_RANKING_CONDITION_PATTERN.test(text)) ||
    (typeof originalText === "string" && CONFIRMED_RANKING_CONDITION_PATTERN.test(originalText))
  );
}

function filterConditionTargetContexts(
  targetContexts: AutoInterpretationTargetContext[],
  confirmedTargetTokenIndexes: number[][],
) {
  if (confirmedTargetTokenIndexes.length === 0) {
    return [];
  }

  return targetContexts.filter((context) =>
    confirmedTargetTokenIndexes.some((tokenIndexes) => areSameTokenIndexes(context.targetTokenIndexes, tokenIndexes)),
  );
}

function buildRelevantClauses(
  executionInput: AvailabilityInterpretationExecutionInput,
  finalPreferences: AutoInterpretationPreference[],
  availabilityRules: AutoInterpretationRule[],
  targetContexts: AutoInterpretationTargetContext[],
): ConditionInterpretationClauseInput[] {
  const targetGroupIdsByClause = new Map<number, Set<string>>();
  const signalTokenIndexesByClause = new Map<number, Set<number>>();

  for (const clause of splitClauses(executionInput)) {
    const clauseTokenIndexSet = new Set(clause.tokenIndexes);
    const targetGroupIds = executionInput.grouping.targetGroups
      .filter((group) => group.tokenIndexes.some((tokenIndex) => clauseTokenIndexSet.has(tokenIndex)))
      .map((group) => group.id);
    const signalIndexes = clause.tokenIndexes.filter((tokenIndex) => {
      const token = executionInput.tokens[tokenIndex];
      return token ? CONDITION_SIGNAL_LABELS.has(token.label) || CONDITION_TEXT_SIGNAL_PATTERN.test(token.text) : false;
    });
    targetGroupIdsByClause.set(clause.clauseIndex, new Set(targetGroupIds));
    signalTokenIndexesByClause.set(clause.clauseIndex, new Set(signalIndexes));
  }

  const markClause = (tokenIndexes: number[]) => {
    for (const clause of splitClauses(executionInput)) {
      if (tokenIndexes.some((tokenIndex) => clause.tokenIndexes.includes(tokenIndex))) {
        const signalSet = signalTokenIndexesByClause.get(clause.clauseIndex) ?? new Set<number>();
        for (const tokenIndex of tokenIndexes) {
          signalSet.add(tokenIndex);
        }
        signalTokenIndexesByClause.set(clause.clauseIndex, signalSet);
      }
    }
  };

  for (const preference of finalPreferences) {
    markClause(preference.markerTokenIndexes);
  }

  for (const rule of availabilityRules) {
    markClause(rule.modifierTokenIndexes);
  }

  for (const context of targetContexts) {
    const markerTokenIndexes = [
      ...(context.relationContext ?? []).flatMap((candidate) => candidate.markerTokenIndexes ?? []),
      ...(context.supportingContext ?? []).flatMap((candidate) => candidate.markerTokenIndexes ?? []),
    ];
    markClause(markerTokenIndexes);
  }

  return splitClauses(executionInput)
    .map((clause) => {
      const signalTokenIndexes = [...(signalTokenIndexesByClause.get(clause.clauseIndex) ?? new Set<number>())].sort(
        (left, right) => left - right,
      );
      const text = formatClauseText(executionInput, clause.tokenIndexes);

      return {
        clauseIndex: clause.clauseIndex,
        text,
        tokenIndexes: clause.tokenIndexes,
        targetGroupIds: [...(targetGroupIdsByClause.get(clause.clauseIndex) ?? new Set<string>())],
        signalTokenIndexes,
        signalTexts: signalTokenIndexes.map((tokenIndex) => executionInput.tokens[tokenIndex]?.text ?? ""),
      };
    })
    .filter((clause) => clause.signalTokenIndexes.length > 0 || CONDITION_TEXT_SIGNAL_PATTERN.test(clause.text))
    .filter((clause) => clause.text.length > 0);
}

export function buildConditionInterpretationInputFromExecutionInput(
  executionInput: AvailabilityInterpretationExecutionInput,
  options: {
    finalPreferences?: AutoInterpretationPreference[];
    availabilityRules?: AutoInterpretationRule[];
    targetContexts?: AutoInterpretationTargetContext[];
  } = {},
): ConditionInterpretationInput {
  const finalPreferences = options.finalPreferences ?? [];
  const availabilityRules = options.availabilityRules ?? [];
  const targetContexts = options.targetContexts ?? [];

  return {
    originalText: executionInput.originalText,
    tokens: executionInput.tokens.map((token) => ({
      index: token.index,
      text: token.text,
      label: token.label,
      ...(token.normalizedText ? { normalizedText: token.normalizedText } : {}),
    })),
    finalPreferences: summarizePreferences(finalPreferences),
    availabilityRules: summarizeAvailabilityRules(availabilityRules),
    targetContexts,
    relevantClauses: buildRelevantClauses(
      executionInput,
      finalPreferences,
      availabilityRules,
      targetContexts,
    ),
  };
}

function findRelevantClauseForTokenIndexes(
  input: ConditionInterpretationInput,
  tokenIndexes: number[],
) {
  return input.relevantClauses.find((clause) =>
    tokenIndexes.some((tokenIndex) => clause.tokenIndexes.includes(tokenIndex)),
  );
}

function narrowConditionInterpretationInput(
  input: ConditionInterpretationInput,
): ConditionInterpretationInput {
  const finalPreferences = input.finalPreferences.filter((preference) => {
    if (hasComparisonCandidateContext(preference.targetTokenIndexes, input.targetContexts)) {
      return false;
    }

    const clause = findRelevantClauseForTokenIndexes(input, [
      ...preference.targetTokenIndexes,
      ...preference.markerTokenIndexes,
    ]);

    if (!clause) {
      return false;
    }

    return hasConfirmedRankingConditionSignals(clause.text, clause.signalTexts, input.originalText);
  });

  const availabilityRules = input.availabilityRules.filter((rule) => {
    if (hasComparisonCandidateContext(rule.targetTokenIndexes, input.targetContexts)) {
      return false;
    }

    const clause = findRelevantClauseForTokenIndexes(input, [
      ...rule.targetTokenIndexes,
      ...rule.modifierTokenIndexes,
    ]);

    if (!clause) {
      return false;
    }

    return hasConfirmedRankingConditionSignals(clause.text, clause.signalTexts, input.originalText);
  });

  const confirmedTargetTokenIndexes = [
    ...finalPreferences.map((preference) => preference.targetTokenIndexes),
    ...availabilityRules.map((rule) => rule.targetTokenIndexes),
  ];
  const targetContexts = filterConditionTargetContexts(input.targetContexts, confirmedTargetTokenIndexes);
  const relevantClauses =
    confirmedTargetTokenIndexes.length === 0
      ? []
      : input.relevantClauses.filter((clause) =>
          confirmedTargetTokenIndexes.some((tokenIndexes) =>
            tokenIndexes.some((tokenIndex) => clause.tokenIndexes.includes(tokenIndex)),
          ),
        );

  return {
    ...input,
    finalPreferences,
    availabilityRules,
    targetContexts,
    relevantClauses,
  };
}

export function hasConditionInterpretationCandidateMaterial(
  input: ConditionInterpretationInput,
) {
  const narrowedInput = narrowConditionInterpretationInput(input);

  return (
    narrowedInput.relevantClauses.length > 0 &&
    (narrowedInput.finalPreferences.length > 0 || narrowedInput.availabilityRules.length > 0)
  );
}

export function buildConditionInterpretationUserPrompt(
  input: ConditionInterpretationInput,
) {
  return [
    "元のコメントと既存の解釈材料を見て、条件文の意味分類だけを返してください。",
    "condition が今成立しているかは判断しません。",
    "新しい target や availability を作ってはいけません。",
    "conditions の object には定義された key だけを入れてください。",
    "threshold は attendance_threshold の時だけ返してください。",
    "わからなければ conditions を空にし、warnings に短い理由だけを入れてください。",
    "",
    "この入力では:",
    "- finalPreferences は comparison に吸収されず最終的に希望として残った target です。",
    "- availabilityRules は確定済み availability です。",
    "- targetContexts は condition_context / conditional_choice_scope の補助証拠です。",
    "- relevantClauses は注目箇所ですが、全文 tokens を見てよいです。",
    "",
    "入力:",
    JSON.stringify(input, null, 2),
    "",
    "出力形式:",
    '{ "conditions": [...], "warnings": [...] }',
    "",
    "JSON のみを返してください。",
  ].join("\n");
}

export function buildConditionInterpretationMessages(
  input: ConditionInterpretationInput,
) {
  return {
    systemPrompt: CONDITION_INTERPRETATION_SYSTEM_PROMPT,
    userPrompt: buildConditionInterpretationUserPrompt(input),
  };
}

export function parseConditionInterpretationResponse(responseText: string): unknown {
  const trimmed = responseText.trim();

  if (!trimmed) {
    throw new ConditionInterpretationParseError("LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new ConditionInterpretationParseError("LLM response was not valid JSON.");
  }
}

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConditionInterpretationValidationError(message);
  }
  return value as Record<string, unknown>;
}

function validateIntegerArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !Number.isInteger(item))) {
    throw new ConditionInterpretationValidationError(`${fieldName} must be a non-empty array of integers.`);
  }
  return [...new Set(value as number[])].sort((left, right) => left - right);
}

function validateStringArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ConditionInterpretationValidationError(`${fieldName} must be a non-empty array of strings.`);
  }
  return [...new Set(value as string[])];
}

function validateConditionThreshold(value: unknown) {
  const record = assertObject(value, "threshold must be an object.");
  const allowedKeys = new Set(["comparator", "count"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new ConditionInterpretationValidationError("threshold contains unsupported fields.");
  }
  if (
    typeof record.comparator !== "string" ||
    !CONDITION_COMPARATOR_VALUES.includes(record.comparator as AutoInterpretationConditionComparator)
  ) {
    throw new ConditionInterpretationValidationError("threshold comparator is unsupported.");
  }
  if (!Number.isInteger(record.count) || (record.count as number) <= 0) {
    throw new ConditionInterpretationValidationError("threshold count must be a positive integer.");
  }

  return {
    comparator: record.comparator as AutoInterpretationConditionComparator,
    count: record.count as number,
  };
}

export function validateConditionInterpretationOutput(
  parsed: unknown,
  input: ConditionInterpretationInput,
): ConditionInterpretationOutput {
  const record = assertObject(parsed, "Condition interpretation output must be a JSON object.");
  const allowedKeys = new Set(["conditions", "warnings"]);

  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new ConditionInterpretationValidationError("Condition interpretation output contains unsupported fields.");
  }
  if (!Array.isArray(record.conditions) || !Array.isArray(record.warnings)) {
    throw new ConditionInterpretationValidationError("conditions and warnings must both be arrays.");
  }

  const targetGroupKeys = new Set(
    input.tokens.length === 0
      ? []
      : [
          ...new Set(
            input.finalPreferences.map((candidate) => JSON.stringify(candidate.targetTokenIndexes)),
          ),
          ...new Set(
            input.availabilityRules.map((candidate) => JSON.stringify(candidate.targetTokenIndexes)),
          ),
        ],
  );
  const clauseIndexes = new Set(input.relevantClauses.map((candidate) => candidate.clauseIndex));
  const preferenceTargetKeys = new Set(
    input.finalPreferences.map((candidate) => JSON.stringify(candidate.targetTokenIndexes)),
  );
  const tokenIndexSet = new Set(input.tokens.map((token) => token.index));

  const conditions = record.conditions.map((condition) => {
    const conditionRecord = assertObject(condition, "Each condition must be an object.");
    const allowedConditionKeys = new Set([
      "targetTokenIndexes",
      "targetText",
      "targetLabels",
      "targetNormalizedTexts",
      "conditionTokenIndexes",
      "markerTokenIndexes",
      "supportingClauseIndexes",
      "kind",
      "resolverType",
      "participantScope",
      "requiredAvailabilityLevels",
      "unresolvedBehavior",
      "resolvedAvailabilityLevel",
      "resolvedPreferenceLevel",
      "threshold",
      "sourcePreferenceTargetTokenIndexes",
      "sourceComment",
      "confidence",
    ]);

    if (Object.keys(conditionRecord).some((key) => !allowedConditionKeys.has(key))) {
      throw new ConditionInterpretationValidationError("condition contains unsupported fields.");
    }

    const targetTokenIndexes = validateIntegerArray(conditionRecord.targetTokenIndexes, "targetTokenIndexes");
    if (!targetGroupKeys.has(JSON.stringify(targetTokenIndexes))) {
      throw new ConditionInterpretationValidationError("targetTokenIndexes must match an existing preference or availability target.");
    }
    const conditionTokenIndexes = validateIntegerArray(conditionRecord.conditionTokenIndexes, "conditionTokenIndexes");
    const markerTokenIndexes = validateIntegerArray(conditionRecord.markerTokenIndexes, "markerTokenIndexes");
    const supportingClauseIndexes = validateIntegerArray(
      conditionRecord.supportingClauseIndexes,
      "supportingClauseIndexes",
    );
    if (supportingClauseIndexes.some((index) => !clauseIndexes.has(index))) {
      throw new ConditionInterpretationValidationError("supportingClauseIndexes must reference relevant clauses.");
    }
    if (
      typeof conditionRecord.kind !== "string" ||
      !CONDITION_KIND_VALUES.includes(conditionRecord.kind as AutoInterpretationConditionKind)
    ) {
      throw new ConditionInterpretationValidationError("condition kind is unsupported.");
    }
    if (
      typeof conditionRecord.resolverType !== "string" ||
      !CONDITION_RESOLVER_VALUES.includes(conditionRecord.resolverType as AutoInterpretationConditionResolverType)
    ) {
      throw new ConditionInterpretationValidationError("condition resolverType is unsupported.");
    }
    if (
      typeof conditionRecord.participantScope !== "string" ||
      !CONDITION_PARTICIPANT_SCOPE_VALUES.includes(
        conditionRecord.participantScope as AutoInterpretationConditionParticipantScope,
      )
    ) {
      throw new ConditionInterpretationValidationError("condition participantScope is unsupported.");
    }
    const requiredAvailabilityLevels = validateStringArray(
      conditionRecord.requiredAvailabilityLevels,
      "requiredAvailabilityLevels",
    );
    if (
      requiredAvailabilityLevels.some(
        (level) =>
          !CONDITION_ACCEPTED_LEVEL_VALUES.includes(level as AutoInterpretationConditionAcceptedLevel),
      )
    ) {
      throw new ConditionInterpretationValidationError("requiredAvailabilityLevels contains unsupported values.");
    }
    if (
      typeof conditionRecord.unresolvedBehavior !== "string" ||
      !CONDITION_UNRESOLVED_BEHAVIOR_VALUES.includes(
        conditionRecord.unresolvedBehavior as AutoInterpretationConditionUnresolvedBehavior,
      )
    ) {
      throw new ConditionInterpretationValidationError("condition unresolvedBehavior is unsupported.");
    }
    const resolvedAvailabilityLevel =
      conditionRecord.resolvedAvailabilityLevel === undefined || conditionRecord.resolvedAvailabilityLevel === null
        ? null
        : typeof conditionRecord.resolvedAvailabilityLevel === "string" &&
            CONDITION_RESOLVED_AVAILABILITY_LEVEL_VALUES.includes(
              conditionRecord.resolvedAvailabilityLevel as AutoInterpretationConditionResolvedAvailabilityLevel,
            )
          ? (conditionRecord.resolvedAvailabilityLevel as AutoInterpretationConditionResolvedAvailabilityLevel)
          : (() => {
              throw new ConditionInterpretationValidationError("condition resolvedAvailabilityLevel is unsupported.");
            })();
    const resolvedPreferenceLevel =
      conditionRecord.resolvedPreferenceLevel === undefined || conditionRecord.resolvedPreferenceLevel === null
        ? null
        : typeof conditionRecord.resolvedPreferenceLevel === "string" &&
            CONDITION_RESOLVED_PREFERENCE_LEVEL_VALUES.includes(
              conditionRecord.resolvedPreferenceLevel as AutoInterpretationConditionResolvedPreferenceLevel,
            )
          ? (conditionRecord.resolvedPreferenceLevel as AutoInterpretationConditionResolvedPreferenceLevel)
          : (() => {
              throw new ConditionInterpretationValidationError("condition resolvedPreferenceLevel is unsupported.");
            })();
    const threshold =
      conditionRecord.threshold === undefined || conditionRecord.threshold === null
        ? null
        : validateConditionThreshold(conditionRecord.threshold);
    if (
      conditionRecord.resolverType === "attendance_threshold" &&
      !threshold
    ) {
      throw new ConditionInterpretationValidationError("attendance_threshold requires threshold.");
    }
    if (
      conditionRecord.resolverType !== "attendance_threshold" &&
      threshold
    ) {
      throw new ConditionInterpretationValidationError("threshold is only allowed for attendance_threshold.");
    }
    const sourcePreferenceTargetTokenIndexes =
      conditionRecord.sourcePreferenceTargetTokenIndexes === undefined
        ? undefined
        : validateIntegerArray(
            conditionRecord.sourcePreferenceTargetTokenIndexes,
            "sourcePreferenceTargetTokenIndexes",
          );
    if (
      sourcePreferenceTargetTokenIndexes &&
      !preferenceTargetKeys.has(JSON.stringify(sourcePreferenceTargetTokenIndexes))
    ) {
      throw new ConditionInterpretationValidationError(
        "sourcePreferenceTargetTokenIndexes must match an existing final preference target.",
      );
    }
    if (typeof conditionRecord.targetText !== "string" || conditionRecord.targetText.trim().length === 0) {
      throw new ConditionInterpretationValidationError("targetText must be a non-empty string.");
    }
    if (!Array.isArray(conditionRecord.targetLabels) || conditionRecord.targetLabels.some((label) => typeof label !== "string")) {
      throw new ConditionInterpretationValidationError("targetLabels must be an array of strings.");
    }
    if (
      !Array.isArray(conditionRecord.targetNormalizedTexts) ||
      conditionRecord.targetNormalizedTexts.some((value) => typeof value !== "string")
    ) {
      throw new ConditionInterpretationValidationError("targetNormalizedTexts must be an array of strings.");
    }
    if (
      typeof conditionRecord.sourceComment !== "string" ||
      conditionRecord.sourceComment !== input.originalText
    ) {
      throw new ConditionInterpretationValidationError("sourceComment must exactly match originalText.");
    }
    if (
      typeof conditionRecord.confidence !== "string" ||
      !CONDITION_CONFIDENCE_VALUES.includes(conditionRecord.confidence as AutoInterpretationConditionConfidence)
    ) {
      throw new ConditionInterpretationValidationError("condition confidence is unsupported.");
    }
    if (
      [...targetTokenIndexes, ...conditionTokenIndexes, ...markerTokenIndexes].some(
        (tokenIndex) => !tokenIndexSet.has(tokenIndex),
      )
    ) {
      throw new ConditionInterpretationValidationError("condition references unknown token indexes.");
    }

    return {
      targetTokenIndexes,
      targetText: conditionRecord.targetText,
      targetLabels: [...(conditionRecord.targetLabels as string[])],
      targetNormalizedTexts: [...(conditionRecord.targetNormalizedTexts as string[])],
      conditionTokenIndexes,
      markerTokenIndexes,
      supportingClauseIndexes,
      kind: conditionRecord.kind as AutoInterpretationConditionKind,
      resolverType: conditionRecord.resolverType as AutoInterpretationConditionResolverType,
      participantScope: conditionRecord.participantScope as AutoInterpretationConditionParticipantScope,
      requiredAvailabilityLevels: requiredAvailabilityLevels as AutoInterpretationConditionAcceptedLevel[],
      unresolvedBehavior:
        conditionRecord.unresolvedBehavior as AutoInterpretationConditionUnresolvedBehavior,
      resolvedAvailabilityLevel,
      resolvedPreferenceLevel,
      ...(threshold ? { threshold } : {}),
      ...(sourcePreferenceTargetTokenIndexes ? { sourcePreferenceTargetTokenIndexes } : {}),
      sourceComment: conditionRecord.sourceComment,
      confidence: conditionRecord.confidence as AutoInterpretationConditionConfidence,
    } satisfies AutoInterpretationCondition;
  });

  const warnings = record.warnings.map((warning) => {
    if (typeof warning !== "string") {
      throw new ConditionInterpretationValidationError("warnings must be an array of strings.");
    }
    return warning;
  });

  return {
    conditions,
    warnings,
  };
}

export async function callOllamaForConditionInterpretation(
  input: ConditionInterpretationInput,
  options: ConditionInterpretationOllamaOptions = {},
): Promise<string> {
  const prompts = buildConditionInterpretationMessages(input);

  return requestStructuredJsonFromLlm(options, {
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        conditions: {
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
      required: ["conditions", "warnings"],
    },
    temperature: 0,
  });
}

function buildFallbackConditionInterpretationResult(
  stage: ConditionInterpretationErrorStage,
  message: string,
  rawResponse: string | null,
): ConditionInterpretationResult {
  return {
    conditions: [],
    relevantClauseIndexes: [],
    warnings: [],
    rawResponse,
    error: {
      stage,
      message,
    },
  };
}

export async function interpretConditionsForInput(
  input: ConditionInterpretationInput,
  options: ConditionInterpretationOllamaOptions = {},
): Promise<ConditionInterpretationResult> {
  const narrowedInput = narrowConditionInterpretationInput(input);

  if (!hasConditionInterpretationCandidateMaterial(input)) {
    return {
      conditions: [],
      relevantClauseIndexes: [],
      warnings: [],
      rawResponse: null,
      error: null,
    };
  }

  let rawResponse: string | null = null;

  try {
    rawResponse = await callOllamaForConditionInterpretation(narrowedInput, options);
  } catch (error) {
    return buildFallbackConditionInterpretationResult(
      "request",
      error instanceof Error ? error.message : "Failed to request condition interpretation from Ollama.",
      rawResponse,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseConditionInterpretationResponse(rawResponse);
  } catch (error) {
    return buildFallbackConditionInterpretationResult(
      "parse",
      error instanceof Error ? error.message : "Failed to parse condition interpretation response.",
      rawResponse,
    );
  }

  try {
    const validated = validateConditionInterpretationOutput(parsed, narrowedInput);
    const relevantClauseIndexes = [...new Set(validated.conditions.flatMap((condition) => condition.supportingClauseIndexes))].sort(
      (left, right) => left - right,
    );

    return {
      conditions: validated.conditions,
      relevantClauseIndexes,
      warnings: validated.warnings,
      rawResponse,
      error: null,
    };
  } catch (error) {
    return buildFallbackConditionInterpretationResult(
      "validate",
      error instanceof Error ? error.message : "Failed to validate condition interpretation response.",
      rawResponse,
    );
  }
}
