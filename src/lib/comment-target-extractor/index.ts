import { extractChronoTimeTargetCandidates } from "./chrono-extractor";
import { extractJapaneseTimeTargetCandidates } from "./japanese-target-extractor";
import { normalizeCommentTimeText } from "./normalize";
import type {
  ExtractCommentTimeFeaturesOptions,
  ExtractedCommentTimeFeatures,
  ExtractedTimeTargetCandidate,
} from "./types";

function dedupeTargets(targets: ExtractedTimeTargetCandidate[]) {
  const seen = new Set<string>();

  return targets.filter((target) => {
    const key = `${target.kind}:${target.start}:${target.end}:${target.normalizedValue ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function extractCommentTimeFeatures(
  comment: string,
  options?: ExtractCommentTimeFeaturesOptions,
): ExtractedCommentTimeFeatures {
  const normalizedText = normalizeCommentTimeText(comment);
  const targets = dedupeTargets([
    ...extractChronoTimeTargetCandidates(normalizedText, options),
    ...extractJapaneseTimeTargetCandidates(normalizedText, options),
  ]).sort((left, right) => left.start - right.start || left.end - right.end || left.kind.localeCompare(right.kind));

  return {
    rawText: comment,
    normalizedText,
    targets,
  };
}

export { extractChronoTimeTargetCandidates } from "./chrono-extractor";
export { extractJapaneseTimeTargetCandidates } from "./japanese-target-extractor";
export { normalizeCommentTimeText } from "./normalize";
export type {
  EventDateRange,
  ExtractCommentTimeFeaturesOptions,
  ExtractedCommentTimeFeatures,
  ExtractedTimeTargetCandidate,
  ExtractedTimeTargetKind,
} from "./types";
