import type { ExtractedTimeTargetCandidate, ExtractedTimeTargetKind, ExtractedTimeTargetMetadata } from "@/lib/comment-target-extractor";

export type BuildDateSequencesInput = {
  originalText: string;
  normalizedText: string;
  extractedTargets: ExtractedTimeTargetCandidate[];
  contextWindow?: number;
};

export type DateSequenceTarget = {
  targetId: string;
  text: string;
  normalizedValue?: string;
  start: number;
  end: number;
  sourceTargetKind: ExtractedTimeTargetKind;
  sourceTargetIndex: number;
  metadata?: ExtractedTimeTargetMetadata;
  derivedFromRange: boolean;
};

export type DateSequenceConnectorType =
  | "adjacent"
  | "space"
  | "comma"
  | "jp_comma"
  | "dot"
  | "and"
  | "or"
  | "range"
  | "link"
  | "other";

export type DateSequenceConnector = {
  text: string;
  start: number;
  end: number;
  type: DateSequenceConnectorType;
};

export type DateSequence = {
  sequenceId: string;
  sourceText: string;
  span: {
    start: number;
    end: number;
  };
  targets: DateSequenceTarget[];
  connectors: DateSequenceConnector[];
  context: {
    originalText: string;
    normalizedText: string;
    beforeText: string;
    afterText: string;
  };
};

export type DateSequenceGroupingHypothesis = {
  hypothesisId: string;
  kind: "single_group" | "split_groups" | "range_group" | "isolated_targets";
  groups: string[][];
  evidence: string[];
  connectorPolicy?: Record<string, string>;
};

export type DateSequenceInterpretation = DateSequence & {
  groupingHypotheses: DateSequenceGroupingHypothesis[];
};

