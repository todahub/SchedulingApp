export type EventDateRange = {
  start: string;
  end: string;
};

export type ExtractCommentTimeFeaturesOptions = {
  eventDateRange?: EventDateRange;
};

export type ExtractedTimeTargetKind =
  | "date"
  | "date_range"
  | "weekday"
  | "weekday_group"
  | "relative_period"
  | "month_part"
  | "week_ordinal"
  | "time_of_day"
  | "holiday_related";

export type ExtractedTimeTargetMetadataValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>;

export type ExtractedTimeTargetMetadata = Record<string, ExtractedTimeTargetMetadataValue>;

export type ExtractedTimeTargetCandidate = {
  kind: ExtractedTimeTargetKind;
  source: "chrono" | "japanese_rule";
  text: string;
  start: number;
  end: number;
  normalizedValue?: string;
  metadata?: ExtractedTimeTargetMetadata;
};

export type ExtractedCommentTimeFeatures = {
  rawText: string;
  normalizedText: string;
  targets: ExtractedTimeTargetCandidate[];
};
