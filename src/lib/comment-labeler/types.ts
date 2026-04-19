import type { EventDateRange, ExtractedTimeTargetCandidate } from "@/lib/comment-target-extractor";

export type AvailabilityCoreLabel =
  | "availability_positive"
  | "availability_negative"
  | "availability_unknown";

export type AvailabilityModifierLabel =
  | "uncertainty_marker"
  | "conditional_marker"
  | "hypothetical_marker";

export type LegacyCompatibilityLabel =
  | "desire_marker"
  | "emphasis_marker";

/**
 * 互換のために型は残すが、辞書出力の主軸にはしない legacy ラベル。
 * 新規語彙は原則としてより狭い semantic label へ寄せる。
 */

/**
 * 次段階で辞書と LLM の間に渡したい意味ラベル。
 * まだ既存の labeler / dictionaries / ranking には接続しない。
 * この型は、今後 desire_marker / emphasis_marker を分割するための設計上の固定点として使う。
 */
export type PlannedDictionarySemanticLabel =
  | "preference_positive_marker"
  | "preference_negative_marker"
  | "comparison_marker"
  | "reason_marker"
  | "negation_marker"
  | "strength_marker"
  | "weak_commitment_marker";

export const PLANNED_DICTIONARY_LABEL_CATEGORIES = {
  availabilityCore: [
    "availability_positive",
    "availability_negative",
    "availability_unknown",
  ],
  availabilityModifiers: [
    "uncertainty_marker",
    "conditional_marker",
    "hypothetical_marker",
  ],
  legacyCompatibility: [
    "desire_marker",
    "emphasis_marker",
  ],
  futureSemantics: [
    "preference_positive_marker",
    "preference_negative_marker",
    "comparison_marker",
    "reason_marker",
    "negation_marker",
    "strength_marker",
    "weak_commitment_marker",
  ],
} as const;

export const LEGACY_LABEL_REMAP_PLAN = {
  desire_marker: [
    "preference_positive_marker",
    "preference_negative_marker",
    "comparison_marker",
  ],
  emphasis_marker: [
    "strength_marker",
    "weak_commitment_marker",
    "uncertainty_marker",
  ],
} as const;

export type Label =
  | "availability_positive"
  | "availability_negative"
  | "availability_unknown"
  | "uncertainty_marker"
  | "desire_marker"
  | "conditional_marker"
  | "hypothetical_marker"
  | "emphasis_marker"
  | "preference_positive_marker"
  | "preference_negative_marker"
  | "comparison_marker"
  | "reason_marker"
  | "negation_marker"
  | "strength_marker"
  | "weak_commitment_marker"
  | "scope_residual"
  | "scope_exception"
  | "scope_all"
  | "particle_topic"
  | "particle_link"
  | "particle_condition"
  | "particle_limit"
  | "conjunction_parallel"
  | "conjunction_contrast"
  | "punctuation_boundary"
  | "sentence_boundary"
  | "target_date"
  | "target_date_range"
  | "target_weekday"
  | "target_weekday_group"
  | "target_relative_period"
  | "target_month_part"
  | "target_week_ordinal"
  | "target_time_of_day"
  | "target_holiday_related";

export type CommentLabelerOptions = {
  eventDateRange?: EventDateRange;
};

export type LabeledToken = {
  text: string;
  normalizedText?: string;
  label: Label;
  start: number;
  end: number;
  score?: number;
  meta?: Record<string, unknown>;
  source: "target_extractor" | "rule";
};

export type LabeledComment = {
  originalText: string;
  rawText: string;
  normalizedText: string;
  tokens: LabeledToken[];
  targets: ExtractedTimeTargetCandidate[];
};

export type RuleDictionaryEntry = {
  label: Exclude<Label, `target_${string}`>;
  canonical: string;
  variants: string[];
  score?: number;
  meta?: Record<string, unknown>;
  blocksInnerLabels?: Label[];
};
