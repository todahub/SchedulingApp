import type { EventCandidateRecord } from "@/lib/domain";
import { normalizeTargetDraft } from "./normalize-target";
import type {
  BaseInterpretationConditionDraft,
  BaseInterpretationComparisonDraft,
  BaseInterpretationDraft,
  BaseInterpretationEvaluationDraft,
  FinalComparison,
  FinalCondition,
  FinalInterpretationJson,
  FinalTargetEvaluation,
  InterpretationAvailability,
  InterpretationPreference,
  ReviewRun,
} from "./types";

const PREFERENCE_SCORE_MAP: Record<InterpretationPreference, number> = {
  かなり行きたい: 3,
  行きたい: 2,
  少し行きたい: 1,
  中立: 0,
  少し避けたい: -1,
  避けたい: -2,
  かなり避けたい: -3,
};

const AVAILABILITY_POLARITY: Record<InterpretationAvailability, "positive" | "negative" | "unknown" | "conditional"> = {
  行ける: "positive",
  行けない: "negative",
  まだわからない: "unknown",
  条件付きで行ける: "conditional",
};

function createPreferenceHistogram() {
  return {
    かなり行きたい: 0,
    行きたい: 0,
    少し行きたい: 0,
    中立: 0,
    少し避けたい: 0,
    避けたい: 0,
    かなり避けたい: 0,
  } satisfies Record<InterpretationPreference, number>;
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function computePreferenceSummary(values: InterpretationPreference[]) {
  const histogram = createPreferenceHistogram();

  for (const value of values) {
    histogram[value] += 1;
  }

  const representative =
    Object.entries(histogram).sort(
      (left, right) =>
        right[1] - left[1] ||
        Math.abs(PREFERENCE_SCORE_MAP[right[0] as InterpretationPreference]) -
          Math.abs(PREFERENCE_SCORE_MAP[left[0] as InterpretationPreference]),
    )[0]?.[0] ?? "中立";
  const numericValues = values.map((value) => PREFERENCE_SCORE_MAP[value]);
  const mean = numericValues.length === 0 ? 0 : numericValues.reduce((sum, current) => sum + current, 0) / numericValues.length;

  return {
    representative: representative as InterpretationPreference,
    mean: roundToTwo(mean),
    sampleCount: values.length,
    histogram,
  };
}

function computeNullablePreferenceSummary(values: Array<InterpretationPreference | null>) {
  const filtered = values.filter((value): value is InterpretationPreference => value !== null);
  return filtered.length === 0 ? null : computePreferenceSummary(filtered);
}

function computeAvailabilityFromSamples(
  baseAvailability: InterpretationAvailability,
  samples: InterpretationAvailability[],
) {
  if (samples.length === 0) {
    return {
      availability: baseAvailability,
      confidence: 0.9,
      confidenceSource: "rule_heuristic" as const,
      reviewStatus: "base_only" as const,
    };
  }

  const counts = new Map<InterpretationAvailability, number>();

  for (const sample of samples) {
    counts.set(sample, (counts.get(sample) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const top = sorted[0] ?? [baseAvailability, 1];
  const agreement = top[1] / samples.length;
  const topPolarity = AVAILABILITY_POLARITY[top[0]];
  const oppositeExists = sorted.some(([availability]) => {
    const polarity = AVAILABILITY_POLARITY[availability];
    return (
      (topPolarity === "positive" && polarity === "negative") ||
      (topPolarity === "negative" && polarity === "positive")
    );
  });

  return {
    availability: top[0],
    confidence: roundToTwo(agreement),
    confidenceSource: "self_consistency" as const,
    reviewStatus: oppositeExists || agreement < 0.8 ? ("mixed" as const) : ("stable" as const),
  };
}

function collectReviewRuns<T>(reviewRuns: ReviewRun[], taskId: string) {
  return reviewRuns.filter((run) => run.taskId === taskId).map((run) => run.decision as T);
}

function aggregateEvaluation(
  draft: BaseInterpretationEvaluationDraft,
  taskId: string,
  reviewRuns: ReviewRun[],
  candidates: EventCandidateRecord[],
): FinalTargetEvaluation {
  const reviewDecisions = collectReviewRuns<{ availability: InterpretationAvailability; preference: InterpretationPreference | null }>(
    reviewRuns,
    taskId,
  );
  const availabilitySamples = reviewDecisions.map((decision) => decision.availability);
  const preferenceSamples = reviewDecisions.map((decision) => decision.preference);
  const availability = computeAvailabilityFromSamples(draft.availability, availabilitySamples);
  const preference = computeNullablePreferenceSummary(preferenceSamples.length > 0 ? preferenceSamples : [draft.preference]);

  return {
    ...normalizeTargetDraft(draft, candidates),
    availability: availability.availability,
    availabilityConfidence: availability.confidence,
    availabilityConfidenceSource: availability.confidenceSource,
    preference,
    conditionText: draft.conditionText,
    evidenceTexts: [draft.evidenceText],
    reviewStatus: availability.reviewStatus,
  };
}

function aggregateComparison(
  draft: BaseInterpretationComparisonDraft,
  taskId: string,
  reviewRuns: ReviewRun[],
  candidates: EventCandidateRecord[],
): FinalComparison {
  const reviewDecisions = collectReviewRuns<{ preferredTargetText: string; preference: InterpretationPreference }>(reviewRuns, taskId);
  const directionCounts = new Map<string, number>();

  for (const decision of reviewDecisions) {
    directionCounts.set(decision.preferredTargetText, (directionCounts.get(decision.preferredTargetText) ?? 0) + 1);
  }

  const sortedDirections = [...directionCounts.entries()].sort((left, right) => right[1] - left[1]);
  const topDirection = sortedDirections[0]?.[0] ?? draft.preferredTargetText;
  const directionConfidence =
    reviewDecisions.length === 0 ? 0.9 : roundToTwo((sortedDirections[0]?.[1] ?? 0) / reviewDecisions.length);
  const preference = computePreferenceSummary(
    reviewDecisions.length > 0 ? reviewDecisions.map((decision) => decision.preference) : [draft.preference],
  );

  return {
    candidateSetText: draft.candidateSetText,
    candidateTargets: draft.candidateTargets.map((target) => normalizeTargetDraft(target, candidates)),
    preferredTargetText: topDirection,
    directionConfidence,
    preference,
    conditionText: draft.conditionText,
    evidenceTexts: [draft.evidenceText],
    reviewStatus:
      reviewDecisions.length === 0 ? "base_only" : directionConfidence < 0.8 ? "mixed" : "stable",
  };
}

function aggregateCondition(
  draft: BaseInterpretationConditionDraft,
  taskId: string,
  reviewRuns: ReviewRun[],
  candidates: EventCandidateRecord[],
): FinalCondition {
  const reviewDecisions = collectReviewRuns<{ availability: InterpretationAvailability }>(reviewRuns, taskId);
  const availability = computeAvailabilityFromSamples(
    draft.availability,
    reviewDecisions.map((decision) => decision.availability),
  );

  return {
    ...normalizeTargetDraft(draft, candidates),
    availability: availability.availability,
    availabilityConfidence: availability.confidence,
    availabilityConfidenceSource: availability.confidenceSource,
    conditionText: draft.conditionText,
    evidenceTexts: [draft.evidenceText],
    reviewStatus: availability.reviewStatus,
  };
}

export function aggregateInterpretation(params: {
  note: string;
  draft: BaseInterpretationDraft;
  reviewRuns: ReviewRun[];
  candidates: EventCandidateRecord[];
}) {
  const targetEvaluations = params.draft.evaluations.map((evaluation, index) =>
    aggregateEvaluation(evaluation, `evaluation:${index}`, params.reviewRuns, params.candidates),
  );
  const comparisons = params.draft.comparisons.map((comparison, index) =>
    aggregateComparison(comparison, `comparison:${index}`, params.reviewRuns, params.candidates),
  );
  const conditions = params.draft.conditions.map((condition, index) =>
    aggregateCondition(condition, `condition:${index}`, params.reviewRuns, params.candidates),
  );

  const unresolved = [
    ...params.draft.unresolved.map((item) => ({
      scope: "base" as const,
      sourceText: item.text,
      reason: item.reason,
    })),
    ...targetEvaluations
      .filter((item) => item.reviewStatus === "mixed")
      .map((item) => ({
        scope: "evaluation" as const,
        sourceText: item.targetText,
        reason: "可否または希望度の再推論結果が割れています。",
      })),
    ...comparisons
      .filter((item) => item.reviewStatus === "mixed")
      .map((item) => ({
        scope: "comparison" as const,
        sourceText: item.evidenceTexts[0] ?? item.preferredTargetText,
        reason: "比較方向または希望度の再推論結果が割れています。",
      })),
    ...conditions
      .filter((item) => item.reviewStatus === "mixed")
      .map((item) => ({
        scope: "condition" as const,
        sourceText: item.conditionText,
        reason: "条件付き可否の再推論結果が割れています。",
      })),
  ];

  return {
    sourceText: params.note,
    targetEvaluations,
    comparisons,
    conditions,
    unresolved,
    meta: {
      reviewedTaskCount: new Set(params.reviewRuns.map((run) => run.taskId)).size,
      reviewRunCount: params.reviewRuns.length,
    },
  } satisfies FinalInterpretationJson;
}
