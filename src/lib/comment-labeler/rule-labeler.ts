import { extractCommentTimeFeatures } from "@/lib/comment-target-extractor";
import type { ExtractedTimeTargetCandidate } from "@/lib/comment-target-extractor";
import { RULE_DICTIONARY } from "./dictionaries";
import { normalizeCommentLabelText } from "./normalize";
import type { CommentLabelerOptions, Label, LabeledComment, LabeledToken } from "./types";

const STRUCTURAL_NOISE_LABELS = new Set<Label>([
  "particle_topic",
  "particle_link",
  "particle_limit",
  "conjunction_parallel",
  "punctuation_boundary",
  "sentence_boundary",
]);

const BLOCKING_PARENT_LABELS = new Set<Label>([
  "availability_positive",
  "availability_negative",
  "availability_unknown",
  "uncertainty_marker",
  "desire_marker",
  "conditional_marker",
  "hypothetical_marker",
  "emphasis_marker",
  "preference_positive_marker",
  "preference_negative_marker",
  "comparison_marker",
  "reason_marker",
  "negation_marker",
  "strength_marker",
  "weak_commitment_marker",
  "scope_residual",
  "scope_exception",
  "scope_all",
  "conjunction_contrast",
  "target_date",
  "target_date_range",
  "target_weekday",
  "target_weekday_group",
  "target_relative_period",
  "target_month_part",
  "target_week_ordinal",
  "target_time_of_day",
  "target_holiday_related",
]);

const TARGET_LABEL_PREFERENCE: Record<Label, number> = {
  availability_positive: 0,
  availability_negative: 0,
  availability_unknown: 0,
  uncertainty_marker: 0,
  desire_marker: 0,
  conditional_marker: 0,
  hypothetical_marker: 0,
  emphasis_marker: 0,
  preference_positive_marker: 0,
  preference_negative_marker: 0,
  comparison_marker: 0,
  reason_marker: 0,
  negation_marker: 0,
  strength_marker: 0,
  weak_commitment_marker: 0,
  scope_residual: 0,
  scope_exception: 0,
  scope_all: 0,
  particle_topic: 0,
  particle_link: 0,
  particle_condition: 0,
  particle_limit: 0,
  conjunction_parallel: 0,
  conjunction_contrast: 0,
  punctuation_boundary: 0,
  sentence_boundary: 0,
  target_date: 1,
  target_date_range: 2,
  target_relative_period: 3,
  target_month_part: 4,
  target_week_ordinal: 5,
  target_holiday_related: 6,
  target_time_of_day: 7,
  target_weekday_group: 8,
  target_weekday: 9,
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildLiteralRegex(variant: string) {
  return new RegExp(escapeRegExp(variant), "gu");
}

function mapTargetToLabel(target: ExtractedTimeTargetCandidate): Label {
  switch (target.kind) {
    case "date":
      return "target_date";
    case "date_range":
      return "target_date_range";
    case "weekday":
      return "target_weekday";
    case "weekday_group":
      return "target_weekday_group";
    case "relative_period":
      return "target_relative_period";
    case "month_part":
      return "target_month_part";
    case "week_ordinal":
      return "target_week_ordinal";
    case "time_of_day":
      return "target_time_of_day";
    case "holiday_related":
      return "target_holiday_related";
  }
}

function toTargetToken(target: ExtractedTimeTargetCandidate): LabeledToken {
  return {
    text: target.text,
    normalizedText: target.normalizedValue,
    label: mapTargetToLabel(target),
    start: target.start,
    end: target.end,
    meta: target.metadata ? { ...target.metadata, targetKind: target.kind } : { targetKind: target.kind },
    source: "target_extractor",
  };
}

function collectRuleTokens(normalizedText: string) {
  const tokens: Array<LabeledToken & { blocksInnerLabels?: Label[] }> = [];

  for (const entry of RULE_DICTIONARY) {
    const variants = [...entry.variants].sort((left, right) => right.length - left.length || left.localeCompare(right));

    for (const variant of variants) {
      const regex = buildLiteralRegex(variant);

      for (const match of normalizedText.matchAll(regex)) {
        const text = match[0];
        const start = match.index ?? 0;
        const end = start + text.length;

        tokens.push({
          text,
          normalizedText: entry.canonical,
          label: entry.label,
          start,
          end,
          score: entry.score,
          meta: entry.meta ? { ...entry.meta, matchedVariant: variant } : { matchedVariant: variant },
          source: "rule",
          blocksInnerLabels: entry.blocksInnerLabels,
        });
      }
    }
  }

  return tokens;
}

function dedupeExactTokens(tokens: Array<LabeledToken & { blocksInnerLabels?: Label[] }>) {
  const seen = new Set<string>();

  return tokens.filter((token) => {
    const key = `${token.label}:${token.start}:${token.end}:${token.normalizedText ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function removeShorterSameLabelOverlaps(tokens: Array<LabeledToken & { blocksInnerLabels?: Label[] }>) {
  return tokens.filter((token, index) => {
    return !tokens.some((otherToken, otherIndex) => {
      if (index === otherIndex || token.label !== otherToken.label) {
        return false;
      }

      const tokenLength = token.end - token.start;
      const otherLength = otherToken.end - otherToken.start;
      return otherToken.start <= token.start && otherToken.end >= token.end && otherLength > tokenLength;
    });
  });
}

function removeBlockedInnerTokens(tokens: Array<LabeledToken & { blocksInnerLabels?: Label[] }>) {
  return tokens.filter((token) => {
    return !tokens.some((otherToken) => {
      if (!otherToken.blocksInnerLabels || otherToken === token) {
        return false;
      }

      return (
        otherToken.blocksInnerLabels.includes(token.label) &&
        otherToken.start <= token.start &&
        otherToken.end >= token.end &&
        (otherToken.end - otherToken.start) > (token.end - token.start)
      );
    });
  });
}

function finalizeRuleTokens(tokens: Array<LabeledToken & { blocksInnerLabels?: Label[] }>): LabeledToken[] {
  return removeBlockedInnerTokens(removeShorterSameLabelOverlaps(dedupeExactTokens(tokens)))
    .map((token) => {
      const rest = { ...token };
      delete rest.blocksInnerLabels;
      return rest;
    })
    .sort((left, right) => left.start - right.start || left.end - right.end || left.label.localeCompare(right.label));
}

function dedupeConflictingTargetTokens(tokens: LabeledToken[]) {
  return tokens.filter((token, index) => {
    if (!token.label.startsWith("target_")) {
      return true;
    }

    return !tokens.some((otherToken, otherIndex) => {
      if (index === otherIndex || !otherToken.label.startsWith("target_")) {
        return false;
      }

      return (
        otherToken.text === token.text &&
        otherToken.start === token.start &&
        otherToken.end === token.end &&
        TARGET_LABEL_PREFERENCE[otherToken.label] > TARGET_LABEL_PREFERENCE[token.label]
      );
    });
  });
}

function removeInnerStructuralNoise(tokens: LabeledToken[]) {
  return tokens.filter((token, index) => {
    if (token.label === "scope_exception") {
      return !tokens.some((otherToken, otherIndex) => {
        if (index === otherIndex || otherToken.label !== "scope_residual") {
          return false;
        }

        return (
          otherToken.start <= token.start &&
          otherToken.end >= token.end &&
          (otherToken.end - otherToken.start) > (token.end - token.start)
        );
      });
    }

    if (!STRUCTURAL_NOISE_LABELS.has(token.label)) {
      return true;
    }

    return !tokens.some((otherToken, otherIndex) => {
      if (index === otherIndex || !BLOCKING_PARENT_LABELS.has(otherToken.label)) {
        return false;
      }

      return (
        otherToken.start <= token.start &&
        otherToken.end >= token.end &&
        (otherToken.end - otherToken.start) > (token.end - token.start)
      );
    });
  });
}

export function labelCommentText(
  comment: string,
  options?: CommentLabelerOptions,
): LabeledComment {
  const normalizedText = normalizeCommentLabelText(comment);
  const extracted = extractCommentTimeFeatures(comment, options);
  const targetTokens = dedupeConflictingTargetTokens(extracted.targets.map(toTargetToken));
  const ruleTokens = finalizeRuleTokens(collectRuleTokens(normalizedText));
  const tokens = removeInnerStructuralNoise([...targetTokens, ...ruleTokens]).sort(
    (left, right) => left.start - right.start || left.end - right.end || left.label.localeCompare(right.label),
  );

  return {
    originalText: comment,
    rawText: comment,
    normalizedText,
    tokens,
    targets: extracted.targets,
  };
}
