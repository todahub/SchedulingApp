import type { EventCandidateRecord } from "@/lib/domain";

export const INTERPRETATION_DATE_SCOPE_TYPES = [
  "単日日付",
  "日付範囲",
  "複数日付",
  "曜日",
  "曜日群",
  "月全体",
  "月の一部",
  "全日付",
] as const;

export const INTERPRETATION_TIME_SCOPE_TYPES = ["全時間", "時間帯"] as const;

export const INTERPRETATION_PLACE_SCOPE_TYPES = ["全場所", "場所"] as const;

export const INTERPRETATION_AVAILABILITIES = [
  "行ける",
  "行けない",
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

export type InterpretationDateScopeType = (typeof INTERPRETATION_DATE_SCOPE_TYPES)[number];
export type InterpretationTimeScopeType = (typeof INTERPRETATION_TIME_SCOPE_TYPES)[number];
export type InterpretationPlaceScopeType = (typeof INTERPRETATION_PLACE_SCOPE_TYPES)[number];
export type InterpretationAvailability = (typeof INTERPRETATION_AVAILABILITIES)[number];
export type InterpretationPreference = (typeof INTERPRETATION_PREFERENCES)[number];

export type BaseInterpretationScopeDraft = {
  dateText: string;
  dateType: InterpretationDateScopeType;
  dateMemberTexts: string[];
  timeText: string;
  timeType: InterpretationTimeScopeType;
  placeText: string;
  placeType: InterpretationPlaceScopeType;
};

export type BaseInterpretationEvaluationDraft = {
  scope: BaseInterpretationScopeDraft;
  availability: InterpretationAvailability;
  preference: InterpretationPreference | null;
  externalConditionTexts: string[];
  evidenceText: string;
};

export type BaseInterpretationComparisonDraft = {
  candidateSetText: string | null;
  candidateScopes: BaseInterpretationScopeDraft[];
  preferredScopeText: string;
  preference: InterpretationPreference;
  externalConditionTexts: string[];
  evidenceText: string;
};

export type BaseInterpretationUnresolvedDraft = {
  text: string;
  reason: string;
};

export type BaseInterpretationDraft = {
  evaluations: BaseInterpretationEvaluationDraft[];
  comparisons: BaseInterpretationComparisonDraft[];
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

export type NormalizedScopeMemberKind =
  | "日付"
  | "日付範囲"
  | "曜日"
  | "曜日群"
  | "時間帯"
  | "期間"
  | "月"
  | "場所"
  | "補助";

export type NormalizedScopeMember = {
  sourceText: string;
  kind: NormalizedScopeMemberKind;
  value: string;
};

export type NormalizedScope = {
  dateText: string;
  dateType: InterpretationDateScopeType;
  dateMemberTexts: string[];
  dateMembers: NormalizedScopeMember[];
  timeText: string;
  timeType: InterpretationTimeScopeType;
  timeMembers: NormalizedScopeMember[];
  placeText: string;
  placeType: InterpretationPlaceScopeType;
  placeMembers: NormalizedScopeMember[];
  normalizedBy: "system" | "llm_fallback";
};

export type AggregatedPreferenceSummary = {
  representative: InterpretationPreference;
  mean: number;
  sampleCount: number;
  histogram: Record<InterpretationPreference, number>;
};

export type FinalEvaluation = {
  scope: NormalizedScope;
  availability: InterpretationAvailability;
  availabilityConfidence: number;
  availabilityConfidenceSource: "self_consistency" | "single_pass";
  preference: AggregatedPreferenceSummary | null;
  externalConditionTexts: string[];
  evidenceTexts: string[];
  reviewStatus: "base_only" | "stable" | "mixed";
};

export type FinalComparison = {
  candidateSetText: string | null;
  candidateScopes: NormalizedScope[];
  preferredScopeText: string;
  directionConfidence: number;
  preference: AggregatedPreferenceSummary;
  externalConditionTexts: string[];
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
  evaluations: FinalEvaluation[];
  comparisons: FinalComparison[];
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
};

export type InterpretationRequestContext = {
  note: string;
  candidates: EventCandidateRecord[];
};
