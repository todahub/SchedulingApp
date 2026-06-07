import type { EventCandidateRecord } from "@/lib/domain";
import { normalizeTargetDraft } from "./normalize-target";
import type {
  BaseInterpretationComparisonDraft,
  BaseInterpretationConditionDraft,
  BaseInterpretationDraft,
  BaseInterpretationEvaluationDraft,
  FinalComparison,
  FinalCondition,
  FinalInterpretationJson,
  FinalTargetEvaluation,
  InterpretationAvailability,
  InterpretationPreference,
  NormalizedTarget,
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

type EvaluationObservation = {
  availability: InterpretationAvailability;
  preference: InterpretationPreference | null;
  evidenceText: string;
};

type ComparisonObservation = {
  preferredTargetKey: string;
  preference: InterpretationPreference;
  evidenceText: string;
};

type ConditionObservation = {
  availability: InterpretationAvailability;
  evidenceText: string;
};

type EvaluationGroup = {
  target: NormalizedTarget;
  conditionText: string | null;
  observationsByRun: Map<number, EvaluationObservation>;
  evidenceTexts: Set<string>;
  order: number;
};

type ComparisonGroup = {
  candidateSetText: string | null;
  candidateTargets: NormalizedTarget[];
  preferredTargetLabels: Map<string, string>;
  conditionText: string | null;
  observationsByRun: Map<number, ComparisonObservation>;
  evidenceTexts: Set<string>;
  order: number;
};

type ConditionGroup = {
  target: NormalizedTarget;
  conditionText: string;
  observationsByRun: Map<number, ConditionObservation>;
  evidenceTexts: Set<string>;
  order: number;
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

function normalizeLooseText(value: string | null) {
  return (value ?? "").replace(/\s+/gu, "").trim();
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

function buildTargetKey(target: NormalizedTarget) {
  const memberKey = [...target.members]
    .map((member) => `${member.kind}:${member.value}`)
    .sort((left, right) => left.localeCompare(right, "ja"))
    .join("|");

  return [
    target.targetType,
    target.timeRole,
    normalizeLooseText(target.timeText),
    memberKey || normalizeLooseText(target.targetText),
  ].join("::");
}

function buildComparisonKey(
  candidateTargets: NormalizedTarget[],
  candidateSetText: string | null,
  conditionText: string | null,
) {
  const candidateKey = candidateTargets
    .map((candidateTarget) => buildTargetKey(candidateTarget))
    .sort((left, right) => left.localeCompare(right, "ja"))
    .join("||");

  return [candidateKey || normalizeLooseText(candidateSetText), normalizeLooseText(conditionText)].join("::");
}

function buildEvaluationKey(target: NormalizedTarget, conditionText: string | null) {
  return [buildTargetKey(target), normalizeLooseText(conditionText)].join("::");
}

function buildConditionKey(target: NormalizedTarget, conditionText: string) {
  return [buildTargetKey(target), normalizeLooseText(conditionText)].join("::");
}

function getTopEntry<TValue extends string>(counts: Map<TValue, number>) {
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))[0];
}

function computeAvailabilityFromSamples(
  samples: InterpretationAvailability[],
  totalRuns: number,
) {
  if (totalRuns <= 1 || samples.length <= 1) {
    return {
      availability: samples[0] ?? "まだわからない",
      confidence: 0.9,
      confidenceSource: "single_pass" as const,
      reviewStatus: "base_only" as const,
    };
  }

  const counts = new Map<InterpretationAvailability, number>();

  for (const sample of samples) {
    counts.set(sample, (counts.get(sample) ?? 0) + 1);
  }

  const top = getTopEntry(counts) ?? ["まだわからない", 0];
  const agreement = top[1] / totalRuns;
  const topPolarity = AVAILABILITY_POLARITY[top[0]];
  const oppositeExists = [...counts.keys()].some((availability) => {
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

function matchesPreferredTargetText(target: NormalizedTarget, preferredTargetText: string) {
  const normalizedPreferred = normalizeLooseText(preferredTargetText);
  if (!normalizedPreferred) {
    return false;
  }

  if (normalizeLooseText(target.targetText) === normalizedPreferred) {
    return true;
  }

  if (target.memberTexts.some((memberText) => normalizeLooseText(memberText) === normalizedPreferred)) {
    return true;
  }

  return target.members.some((member) => normalizeLooseText(member.sourceText) === normalizedPreferred);
}

function resolvePreferredTargetKey(
  candidateTargets: NormalizedTarget[],
  preferredTargetText: string,
) {
  const matchedTarget = candidateTargets.find((candidateTarget) => matchesPreferredTargetText(candidateTarget, preferredTargetText));

  return matchedTarget ? buildTargetKey(matchedTarget) : normalizeLooseText(preferredTargetText);
}

function buildEvaluationGroups(drafts: BaseInterpretationDraft[], candidates: EventCandidateRecord[]) {
  const groups = new Map<string, EvaluationGroup>();
  let order = 0;

  drafts.forEach((draft, runIndex) => {
    draft.evaluations.forEach((evaluation) => {
      const normalizedTarget = normalizeTargetDraft(evaluation, candidates);
      const key = buildEvaluationKey(normalizedTarget, evaluation.conditionText);
      const group = groups.get(key) ?? {
        target: normalizedTarget,
        conditionText: evaluation.conditionText,
        observationsByRun: new Map<number, EvaluationObservation>(),
        evidenceTexts: new Set<string>(),
        order: order++,
      };

      if (!groups.has(key)) {
        groups.set(key, group);
      }

      group.evidenceTexts.add(evaluation.evidenceText);
      if (!group.observationsByRun.has(runIndex)) {
        group.observationsByRun.set(runIndex, {
          availability: evaluation.availability,
          preference: evaluation.preference,
          evidenceText: evaluation.evidenceText,
        });
      }
    });
  });

  return [...groups.values()].sort((left, right) => left.order - right.order);
}

function buildComparisonGroups(drafts: BaseInterpretationDraft[], candidates: EventCandidateRecord[]) {
  const groups = new Map<string, ComparisonGroup>();
  let order = 0;

  drafts.forEach((draft, runIndex) => {
    draft.comparisons.forEach((comparison) => {
      const normalizedCandidates = comparison.candidateTargets.map((candidateTarget) => normalizeTargetDraft(candidateTarget, candidates));
      const key = buildComparisonKey(normalizedCandidates, comparison.candidateSetText, comparison.conditionText);
      const group = groups.get(key) ?? {
        candidateSetText: comparison.candidateSetText,
        candidateTargets: normalizedCandidates,
        preferredTargetLabels: new Map<string, string>(),
        conditionText: comparison.conditionText,
        observationsByRun: new Map<number, ComparisonObservation>(),
        evidenceTexts: new Set<string>(),
        order: order++,
      };

      if (!groups.has(key)) {
        groups.set(key, group);
        for (const candidateTarget of normalizedCandidates) {
          group.preferredTargetLabels.set(buildTargetKey(candidateTarget), candidateTarget.targetText);
        }
      }

      const preferredTargetKey = resolvePreferredTargetKey(normalizedCandidates, comparison.preferredTargetText);
      group.evidenceTexts.add(comparison.evidenceText);
      if (!group.preferredTargetLabels.has(preferredTargetKey)) {
        group.preferredTargetLabels.set(preferredTargetKey, comparison.preferredTargetText);
      }
      if (!group.observationsByRun.has(runIndex)) {
        group.observationsByRun.set(runIndex, {
          preferredTargetKey,
          preference: comparison.preference,
          evidenceText: comparison.evidenceText,
        });
      }
    });
  });

  return [...groups.values()].sort((left, right) => left.order - right.order);
}

function buildConditionGroups(drafts: BaseInterpretationDraft[], candidates: EventCandidateRecord[]) {
  const groups = new Map<string, ConditionGroup>();
  let order = 0;

  drafts.forEach((draft, runIndex) => {
    draft.conditions.forEach((condition) => {
      const normalizedTarget = normalizeTargetDraft(condition, candidates);
      const key = buildConditionKey(normalizedTarget, condition.conditionText);
      const group = groups.get(key) ?? {
        target: normalizedTarget,
        conditionText: condition.conditionText,
        observationsByRun: new Map<number, ConditionObservation>(),
        evidenceTexts: new Set<string>(),
        order: order++,
      };

      if (!groups.has(key)) {
        groups.set(key, group);
      }

      group.evidenceTexts.add(condition.evidenceText);
      if (!group.observationsByRun.has(runIndex)) {
        group.observationsByRun.set(runIndex, {
          availability: condition.availability,
          evidenceText: condition.evidenceText,
        });
      }
    });
  });

  return [...groups.values()].sort((left, right) => left.order - right.order);
}

function aggregateEvaluationGroup(group: EvaluationGroup, totalRuns: number): FinalTargetEvaluation {
  const observations = [...group.observationsByRun.values()];
  const availability = computeAvailabilityFromSamples(
    observations.map((observation) => observation.availability),
    totalRuns,
  );
  const preference = computeNullablePreferenceSummary(observations.map((observation) => observation.preference));

  return {
    ...group.target,
    availability: availability.availability,
    availabilityConfidence: availability.confidence,
    availabilityConfidenceSource: availability.confidenceSource,
    preference,
    conditionText: group.conditionText,
    evidenceTexts: [...group.evidenceTexts],
    reviewStatus: availability.reviewStatus,
  };
}

function aggregateComparisonGroup(group: ComparisonGroup, totalRuns: number): FinalComparison {
  const observations = [...group.observationsByRun.values()];
  const directionCounts = new Map<string, number>();

  for (const observation of observations) {
    directionCounts.set(observation.preferredTargetKey, (directionCounts.get(observation.preferredTargetKey) ?? 0) + 1);
  }

  const topDirection = getTopEntry(directionCounts);
  const preferredTargetKey = topDirection?.[0] ?? buildTargetKey(group.candidateTargets[0] ?? {
    targetText: "",
    targetType: "複数日付",
    memberTexts: [],
    timeText: null,
    timeRole: "指定なし",
    members: [],
    normalizedBy: "llm_fallback",
  });
  const directionConfidence = totalRuns <= 1 ? 0.9 : roundToTwo((topDirection?.[1] ?? 0) / totalRuns);
  const preference = computePreferenceSummary(observations.map((observation) => observation.preference));

  return {
    candidateSetText: group.candidateSetText,
    candidateTargets: group.candidateTargets,
    preferredTargetText: group.preferredTargetLabels.get(preferredTargetKey) ?? group.candidateTargets[0]?.targetText ?? "",
    directionConfidence,
    preference,
    conditionText: group.conditionText,
    evidenceTexts: [...group.evidenceTexts],
    reviewStatus:
      totalRuns <= 1 ? "base_only" : directionConfidence < 0.8 ? "mixed" : "stable",
  };
}

function aggregateConditionGroup(group: ConditionGroup, totalRuns: number): FinalCondition {
  const observations = [...group.observationsByRun.values()];
  const availability = computeAvailabilityFromSamples(
    observations.map((observation) => observation.availability),
    totalRuns,
  );

  return {
    ...group.target,
    availability: availability.availability,
    availabilityConfidence: availability.confidence,
    availabilityConfidenceSource: availability.confidenceSource,
    conditionText: group.conditionText,
    evidenceTexts: [...group.evidenceTexts],
    reviewStatus: availability.reviewStatus,
  };
}

function buildUnresolved(
  drafts: BaseInterpretationDraft[],
  targetEvaluations: FinalTargetEvaluation[],
  comparisons: FinalComparison[],
  conditions: FinalCondition[],
) {
  const unresolvedMap = new Map<string, FinalInterpretationJson["unresolved"][number]>();

  for (const draft of drafts) {
    for (const item of draft.unresolved) {
      const key = `base::${normalizeLooseText(item.text)}::${normalizeLooseText(item.reason)}`;
      unresolvedMap.set(key, {
        scope: "base",
        sourceText: item.text,
        reason: item.reason,
      });
    }
  }

  for (const item of targetEvaluations.filter((evaluation) => evaluation.reviewStatus === "mixed")) {
    const key = `evaluation::${buildTargetKey(item)}::${normalizeLooseText(item.conditionText)}`;
    unresolvedMap.set(key, {
      scope: "evaluation",
      sourceText: item.evidenceTexts[0] ?? item.targetText,
      reason: "複数回の全文解釈で可否または希望度が一致しませんでした。",
    });
  }

  for (const item of comparisons.filter((comparison) => comparison.reviewStatus === "mixed")) {
    const key = `comparison::${normalizeLooseText(item.evidenceTexts[0] ?? item.preferredTargetText)}`;
    unresolvedMap.set(key, {
      scope: "comparison",
      sourceText: item.evidenceTexts[0] ?? item.preferredTargetText,
      reason: "複数回の全文解釈で比較方向または希望度が一致しませんでした。",
    });
  }

  for (const item of conditions.filter((condition) => condition.reviewStatus === "mixed")) {
    const key = `condition::${buildTargetKey(item)}::${normalizeLooseText(item.conditionText)}`;
    unresolvedMap.set(key, {
      scope: "condition",
      sourceText: item.evidenceTexts[0] ?? item.conditionText,
      reason: "複数回の全文解釈で条件付き可否が一致しませんでした。",
    });
  }

  return [...unresolvedMap.values()];
}

export function aggregateInterpretation(params: {
  note: string;
  drafts: BaseInterpretationDraft[];
  candidates: EventCandidateRecord[];
}) {
  const totalRuns = params.drafts.length;
  const targetEvaluations = buildEvaluationGroups(params.drafts, params.candidates).map((group) =>
    aggregateEvaluationGroup(group, totalRuns),
  );
  const comparisons = buildComparisonGroups(params.drafts, params.candidates).map((group) =>
    aggregateComparisonGroup(group, totalRuns),
  );
  const conditions = buildConditionGroups(params.drafts, params.candidates).map((group) =>
    aggregateConditionGroup(group, totalRuns),
  );
  const unresolved = buildUnresolved(params.drafts, targetEvaluations, comparisons, conditions);

  return {
    sourceText: params.note,
    targetEvaluations,
    comparisons,
    conditions,
    unresolved,
    meta: {
      totalInterpretationRuns: totalRuns,
      performedAdditionalRuns: Math.max(0, totalRuns - 1),
      multiRunTriggered: totalRuns > 1,
    },
  } satisfies FinalInterpretationJson;
}
