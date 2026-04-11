import type { EventDateRange, ExtractedTimeTargetCandidate } from "@/lib/comment-target-extractor";

export type Label =
  | "availability_positive"
  | "availability_negative"
  | "availability_unknown"
  | "uncertainty_marker"
  | "desire_marker"
  | "conditional_marker"
  | "hypothetical_marker"
  | "emphasis_marker"
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
