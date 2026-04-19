import type { Label, LabeledComment } from "./types";

export type AttachmentCandidate = {
  id: string;
  text: string;
  label: Label;
  start: number;
  end: number;
  sentenceIndex: number;
  clauseIndex: number;
};

export type AttachmentType =
  | "availability_target"
  | "modifier_predicate"
  | "reason_predicate"
  | "comparison_scope"
  | "preference_target"
  | "clause_relation";

export type ClauseRelationKind =
  | "supplement"
  | "restriction"
  | "override"
  | "exception"
  | "residual";

export type PreferenceModeFeatureValue = "absolute" | "comparative" | "unknown";
export type UncertaintyModeFeatureValue = "plain_uncertainty" | "condition_like" | "unknown";
export type ReasonModeFeatureValue = "explicit_reason" | "background_context" | "unknown";

export type AttachmentFeatureType =
  | "preference_mode"
  | "uncertainty_mode"
  | "reason_mode";

export type AttachmentUnresolvedReason =
  | "multiple_possible_targets"
  | "insufficient_context"
  | "missing_anchor"
  | "ambiguous_clause_boundary";

export type AvailabilityTargetAttachment = {
  type: "availability_target";
  sourceId: string;
  targetId: string;
  confidence: number;
};

export type ModifierPredicateAttachment = {
  type: "modifier_predicate";
  sourceId: string;
  targetId: string;
  confidence: number;
};

export type ReasonPredicateAttachment = {
  type: "reason_predicate";
  sourceId: string;
  targetId: string;
  confidence: number;
};

export type ComparisonScopeAttachment = {
  type: "comparison_scope";
  sourceId: string;
  targetIds: string[];
  confidence: number;
};

export type PreferenceTargetAttachment = {
  type: "preference_target";
  sourceId: string;
  targetId: string;
  confidence: number;
};

export type ClauseRelationAttachment = {
  type: "clause_relation";
  sourceId: string;
  targetId: string;
  relationKind: ClauseRelationKind;
  confidence: number;
};

export type AttachmentResolutionAttachment =
  | AvailabilityTargetAttachment
  | ModifierPredicateAttachment
  | ReasonPredicateAttachment
  | ComparisonScopeAttachment
  | PreferenceTargetAttachment
  | ClauseRelationAttachment;

export type AttachmentResolutionFeature =
  | {
      type: "preference_mode";
      sourceId: string;
      value: PreferenceModeFeatureValue;
    }
  | {
      type: "uncertainty_mode";
      sourceId: string;
      value: UncertaintyModeFeatureValue;
    }
  | {
      type: "reason_mode";
      sourceId: string;
      value: ReasonModeFeatureValue;
    };

export type AttachmentResolutionUnresolved = {
  sourceId: string;
  reason: AttachmentUnresolvedReason;
};

export type AttachmentResolutionOutput = {
  attachments: AttachmentResolutionAttachment[];
  features: AttachmentResolutionFeature[];
  unresolved: AttachmentResolutionUnresolved[];
};

export type AttachmentResolutionInput = {
  comment: string;
  candidates: AttachmentCandidate[];
};

export const ATTACHMENT_RELATION_TYPES = [
  "availability_target",
  "modifier_predicate",
  "reason_predicate",
  "comparison_scope",
  "preference_target",
  "clause_relation",
] as const satisfies readonly AttachmentType[];

export const CLAUSE_RELATION_KINDS = [
  "supplement",
  "restriction",
  "override",
  "exception",
  "residual",
] as const satisfies readonly ClauseRelationKind[];

export const ATTACHMENT_FEATURE_TYPES = [
  "preference_mode",
  "uncertainty_mode",
  "reason_mode",
] as const satisfies readonly AttachmentFeatureType[];

export const PREFERENCE_MODE_VALUES = ["absolute", "comparative", "unknown"] as const satisfies readonly PreferenceModeFeatureValue[];
export const UNCERTAINTY_MODE_VALUES = ["plain_uncertainty", "condition_like", "unknown"] as const satisfies readonly UncertaintyModeFeatureValue[];
export const REASON_MODE_VALUES = ["explicit_reason", "background_context", "unknown"] as const satisfies readonly ReasonModeFeatureValue[];

export const ATTACHMENT_UNRESOLVED_REASONS = [
  "multiple_possible_targets",
  "insufficient_context",
  "missing_anchor",
  "ambiguous_clause_boundary",
] as const satisfies readonly AttachmentUnresolvedReason[];

export function buildAttachmentCandidatesFromLabeledComment(labeledComment: LabeledComment): AttachmentCandidate[] {
  const ordered = [...labeledComment.tokens].sort(
    (left, right) => left.start - right.start || left.end - right.end || left.label.localeCompare(right.label),
  );

  let sentenceIndex = 0;
  let clauseIndex = 0;

  return ordered.map((token, index) => {
    const candidate: AttachmentCandidate = {
      id: `cand-${index}`,
      text: token.text,
      label: token.label,
      start: token.start,
      end: token.end,
      sentenceIndex,
      clauseIndex,
    };

    if (token.label === "sentence_boundary") {
      sentenceIndex += 1;
      clauseIndex = 0;
    } else if (token.label === "punctuation_boundary" || token.label === "conjunction_contrast") {
      clauseIndex += 1;
    }

    return candidate;
  });
}
