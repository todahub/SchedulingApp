import type { EventCandidateRecord } from "@/lib/domain";

export const INTERPRETATION_TARGET_TYPES = [
  "単日日付",
  "日付範囲",
  "複数日付",
  "曜日",
  "曜日群",
  "月全体",
  "月の一部",
  "時間帯",
  "単日日付と時間帯",
  "期間と時間帯",
] as const;

export const INTERPRETATION_AVAILABILITIES = [
  "行ける",
  "行けない",
  "まだわからない",
  "条件付きで行ける",
] as const;

export const INTERPRETATION_PREFERENCES = [
  "かなり行きたい",
  "行きたい",
  "少し行きたい",
  "中立",
  "少し避けたい",
  "避けたい",
  "かなり避けたい",
] as const;

export const INTERPRETATION_TIME_ROLES = ["指定なし", "対象", "条件"] as const;

export type InterpretationTargetType = (typeof INTERPRETATION_TARGET_TYPES)[number];
export type InterpretationAvailability = (typeof INTERPRETATION_AVAILABILITIES)[number];
export type InterpretationPreference = (typeof INTERPRETATION_PREFERENCES)[number];
export type InterpretationTimeRole = (typeof INTERPRETATION_TIME_ROLES)[number];

export type BaseInterpretationTargetDraft = {
  targetText: string;
  targetType: InterpretationTargetType;
  memberTexts: string[];
  timeText: string | null;
  timeRole: InterpretationTimeRole;
};

export type BaseInterpretationEvaluationDraft = BaseInterpretationTargetDraft & {
  availability: InterpretationAvailability;
  preference: InterpretationPreference | null;
  conditionText: string | null;
  evidenceText: string;
};

export type BaseInterpretationComparisonDraft = {
  candidateSetText: string | null;
  candidateTargets: BaseInterpretationTargetDraft[];
  preferredTargetText: string;
  preference: InterpretationPreference;
  conditionText: string | null;
  evidenceText: string;
};

export type BaseInterpretationConditionDraft = BaseInterpretationTargetDraft & {
  availability: InterpretationAvailability;
  conditionText: string;
  evidenceText: string;
};

export type BaseInterpretationUnresolvedDraft = {
  text: string;
  reason: string;
};

export type BaseInterpretationDraft = {
  evaluations: BaseInterpretationEvaluationDraft[];
  comparisons: BaseInterpretationComparisonDraft[];
  conditions: BaseInterpretationConditionDraft[];
  unresolved: BaseInterpretationUnresolvedDraft[];
};

export type RiskSignal =
  | "comparison"
  | "condition"
  | "uncertainty"
  | "negation_complexity"
  | "multi_target"
  | "preference"
  | "weak_commitment";

export type ReviewKind = "evaluation" | "comparison" | "condition";

export type RiskAssessment = {
  reviewKind: ReviewKind;
  sourceText: string;
  signals: RiskSignal[];
  shouldReview: boolean;
};

export type EvaluationReviewTask = {
  id: string;
  kind: "evaluation";
  note: string;
  focusText: string;
  targetText: string;
  conditionText: string | null;
  base: BaseInterpretationEvaluationDraft;
};

export type ComparisonReviewTask = {
  id: string;
  kind: "comparison";
  note: string;
  focusText: string;
  candidateSetText: string | null;
  preferredTargetText: string;
  base: BaseInterpretationComparisonDraft;
};

export type ConditionReviewTask = {
  id: string;
  kind: "condition";
  note: string;
  focusText: string;
  targetText: string;
  conditionText: string;
  base: BaseInterpretationConditionDraft;
};

export type ReviewTask = EvaluationReviewTask | ComparisonReviewTask | ConditionReviewTask;

export type EvaluationReviewDecision = {
  targetText: string;
  timeText: string | null;
  timeRole: InterpretationTimeRole;
  availability: InterpretationAvailability;
  preference: InterpretationPreference | null;
  evidenceText: string;
};

export type ComparisonReviewDecision = {
  candidateSetText: string | null;
  preferredTargetText: string;
  preference: InterpretationPreference;
  conditionText: string | null;
  evidenceText: string;
};

export type ConditionReviewDecision = {
  targetText: string;
  targetType: InterpretationTargetType;
  timeText: string | null;
  timeRole: InterpretationTimeRole;
  availability: InterpretationAvailability;
  conditionText: string;
  evidenceText: string;
};

export type ReviewDecision = EvaluationReviewDecision | ComparisonReviewDecision | ConditionReviewDecision;

export type ReviewRun<TDecision extends ReviewDecision = ReviewDecision> = {
  taskId: string;
  kind: ReviewKind;
  attempt: number;
  decision: TDecision;
};

export type NormalizedTargetMemberKind =
  | "日付"
  | "日付範囲"
  | "曜日"
  | "曜日群"
  | "時間帯"
  | "期間"
  | "月"
  | "補助";

export type NormalizedTargetMember = {
  sourceText: string;
  kind: NormalizedTargetMemberKind;
  value: string;
};

export type NormalizedTarget = {
  targetText: string;
  targetType: InterpretationTargetType;
  memberTexts: string[];
  timeText: string | null;
  timeRole: InterpretationTimeRole;
  members: NormalizedTargetMember[];
  normalizedBy: "system" | "llm_fallback";
};

export type AggregatedPreferenceSummary = {
  representative: InterpretationPreference;
  mean: number;
  sampleCount: number;
  histogram: Record<InterpretationPreference, number>;
};

export type FinalTargetEvaluation = NormalizedTarget & {
  availability: InterpretationAvailability;
  availabilityConfidence: number;
  availabilityConfidenceSource: "self_consistency" | "single_pass";
  preference: AggregatedPreferenceSummary | null;
  conditionText: string | null;
  evidenceTexts: string[];
  reviewStatus: "base_only" | "stable" | "mixed";
};

export type FinalComparison = {
  candidateSetText: string | null;
  candidateTargets: NormalizedTarget[];
  preferredTargetText: string;
  directionConfidence: number;
  preference: AggregatedPreferenceSummary;
  conditionText: string | null;
  evidenceTexts: string[];
  reviewStatus: "base_only" | "stable" | "mixed";
};

export type FinalCondition = NormalizedTarget & {
  availability: InterpretationAvailability;
  availabilityConfidence: number;
  availabilityConfidenceSource: "self_consistency" | "single_pass";
  conditionText: string;
  evidenceTexts: string[];
  reviewStatus: "base_only" | "stable" | "mixed";
};

export type FinalUnresolvedItem = {
  scope: ReviewKind | "base";
  sourceText: string;
  reason: string;
};

export type FinalInterpretationJson = {
  sourceText: string;
  targetEvaluations: FinalTargetEvaluation[];
  comparisons: FinalComparison[];
  conditions: FinalCondition[];
  unresolved: FinalUnresolvedItem[];
  meta: {
    totalInterpretationRuns: number;
    performedAdditionalRuns: number;
    multiRunTriggered: boolean;
  };
};

export type SelfConsistencyDebugBundle = {
  baseInterpretation: BaseInterpretationDraft;
  interpretationRuns: BaseInterpretationDraft[];
  risks: RiskAssessment[];
  multiRunTriggered: boolean;
  performedAdditionalRuns: number;
};

export type SelfConsistencyInterpretationResult = {
  interpretation: FinalInterpretationJson;
  debug: SelfConsistencyDebugBundle;
};

export type InterpretationLlmOptions = {
  provider?: "ollama" | "gemini";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
};

export type SelfConsistencyPipelineOptions = InterpretationLlmOptions & {
  maxAdditionalInterpretationRuns?: number;
  maxAdditionalReviewCalls?: number;
};

export type InterpretationRequestContext = {
  note: string;
  candidates: EventCandidateRecord[];
};
