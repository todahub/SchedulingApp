import type { EventCandidateRecord } from "@/lib/domain";
import { normalizeScopeDraft } from "./normalize-target";
import type {
  BaseInterpretationDraft,
  FinalComparison,
  FinalEvaluation,
  FinalInterpretationJson,
  InterpretationAvailability,
  InterpretationAvailabilityWeight,
  InterpretationPreference,
  NormalizedScope,
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

const AVAILABILITY_WEIGHT_SCORE_MAP: Record<InterpretationAvailabilityWeight, number> = {
  強い: 1,
  普通: 0,
  弱い: -1,
};

const AVAILABILITY_POLARITY: Record<InterpretationAvailability, "positive" | "negative" | "conditional"> = {
  行ける: "positive",
  行けない: "negative",
  条件付きで行ける: "conditional",
};

type EvaluationObservation = {
  availability: InterpretationAvailability;
  availabilityWeight: InterpretationAvailabilityWeight;
  preference: InterpretationPreference | null;
};

type ComparisonObservation = {
  preferredScopeKey: string;
  preference: InterpretationPreference;
};

type EvaluationGroup = {
  scope: NormalizedScope;
  externalConditionTexts: string[];
  observationsByRun: Map<number, EvaluationObservation>;
  evidenceTexts: Set<string>;
  order: number;
};

type ComparisonGroup = {
  candidateSetText: string | null;
  candidateScopes: NormalizedScope[];
  preferredScopeLabels: Map<string, string>;
  externalConditionTexts: string[];
  observationsByRun: Map<number, ComparisonObservation>;
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

function createAvailabilityWeightHistogram() {
  return {
    強い: 0,
    普通: 0,
    弱い: 0,
  } satisfies Record<InterpretationAvailabilityWeight, number>;
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

function computeAvailabilityWeightSummary(values: InterpretationAvailabilityWeight[]) {
  const histogram = createAvailabilityWeightHistogram();

  for (const value of values) {
    histogram[value] += 1;
  }

  const representative =
    Object.entries(histogram).sort(
      (left, right) =>
        right[1] - left[1] ||
        AVAILABILITY_WEIGHT_SCORE_MAP[right[0] as InterpretationAvailabilityWeight] -
          AVAILABILITY_WEIGHT_SCORE_MAP[left[0] as InterpretationAvailabilityWeight],
    )[0]?.[0] ?? "普通";
  const numericValues = values.map((value) => AVAILABILITY_WEIGHT_SCORE_MAP[value]);
  const mean = numericValues.length === 0 ? 0 : numericValues.reduce((sum, current) => sum + current, 0) / numericValues.length;

  return {
    representative: representative as InterpretationAvailabilityWeight,
    mean: roundToTwo(mean),
    sampleCount: values.length,
    histogram,
  };
}

function buildMemberKey(members: NormalizedScope["dateMembers"]) {
  return [...members]
    .map((member) => `${member.kind}:${member.value}`)
    .sort((left, right) => left.localeCompare(right, "ja"))
    .join("|");
}

function buildScopeKey(scope: NormalizedScope) {
  return [
    scope.dateType,
    buildMemberKey(scope.dateMembers) || normalizeLooseText(scope.dateText),
    scope.timeType,
    buildMemberKey(scope.timeMembers) || normalizeLooseText(scope.timeText),
    scope.placeType,
    buildMemberKey(scope.placeMembers) || normalizeLooseText(scope.placeText),
  ].join("::");
}

function buildExternalConditionsKey(externalConditionTexts: string[]) {
  return [...externalConditionTexts]
    .map((text) => normalizeLooseText(text))
    .sort((left, right) => left.localeCompare(right, "ja"))
    .join("||");
}

function buildComparisonKey(
  candidateScopes: NormalizedScope[],
  candidateSetText: string | null,
  externalConditionTexts: string[],
) {
  const candidateKey = candidateScopes
    .map((candidateScope) => buildScopeKey(candidateScope))
    .sort((left, right) => left.localeCompare(right, "ja"))
    .join("||");

  return [candidateKey || normalizeLooseText(candidateSetText), buildExternalConditionsKey(externalConditionTexts)].join("::");
}

function buildEvaluationKey(scope: NormalizedScope, externalConditionTexts: string[]) {
  return [buildScopeKey(scope), buildExternalConditionsKey(externalConditionTexts)].join("::");
}

function getTopEntry<TValue extends string>(counts: Map<TValue, number>) {
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))[0];
}

function computeAvailabilityFromSamples(samples: InterpretationAvailability[], totalRuns: number) {
  if (totalRuns <= 1 || samples.length <= 1) {
    return {
      availability: samples[0] ?? "条件付きで行ける",
      confidence: 0.9,
      confidenceSource: "single_pass" as const,
      reviewStatus: "base_only" as const,
    };
  }

  const counts = new Map<InterpretationAvailability, number>();

  for (const sample of samples) {
    counts.set(sample, (counts.get(sample) ?? 0) + 1);
  }

  const top = getTopEntry(counts) ?? ["条件付きで行ける", 0];
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

function matchesPreferredScopeText(scope: NormalizedScope, preferredScopeText: string) {
  const normalizedPreferred = normalizeLooseText(preferredScopeText);
  if (!normalizedPreferred) {
    return false;
  }

  if (normalizeLooseText(scope.dateText) === normalizedPreferred) {
    return true;
  }

  if (scope.dateMemberTexts.some((memberText) => normalizeLooseText(memberText) === normalizedPreferred)) {
    return true;
  }

  if (normalizeLooseText(scope.timeText) === normalizedPreferred || normalizeLooseText(scope.placeText) === normalizedPreferred) {
    return true;
  }

  return [...scope.dateMembers, ...scope.timeMembers, ...scope.placeMembers].some(
    (member) => normalizeLooseText(member.sourceText) === normalizedPreferred,
  );
}

function resolvePreferredScopeKey(candidateScopes: NormalizedScope[], preferredScopeText: string) {
  const matchedScope = candidateScopes.find((candidateScope) => matchesPreferredScopeText(candidateScope, preferredScopeText));
  return matchedScope ? buildScopeKey(matchedScope) : normalizeLooseText(preferredScopeText);
}

function chooseRepresentativeText(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return getTopEntry(counts)?.[0] ?? values[0] ?? "";
}

function chooseScopeLabel(scope: NormalizedScope) {
  if (scope.dateText !== "全日付") {
    return scope.dateText;
  }

  if (scope.timeText !== "全時間") {
    return scope.timeText;
  }

  if (scope.placeText !== "全場所") {
    return scope.placeText;
  }

  return scope.dateText;
}

function buildEvaluationGroups(drafts: BaseInterpretationDraft[], candidates: EventCandidateRecord[]) {
  const groups = new Map<string, EvaluationGroup>();
  let order = 0;

  drafts.forEach((draft, runIndex) => {
    draft.evaluations.forEach((evaluation) => {
      const normalizedScope = normalizeScopeDraft(evaluation.scope, candidates);
      const externalConditionTexts = [...new Set(evaluation.externalConditionTexts)];
      const key = buildEvaluationKey(normalizedScope, externalConditionTexts);
      const group = groups.get(key) ?? {
        scope: normalizedScope,
        externalConditionTexts,
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
          availabilityWeight: evaluation.availabilityWeight,
          preference: evaluation.preference,
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
      const normalizedScopes = comparison.candidateScopes.map((candidateScope) => normalizeScopeDraft(candidateScope, candidates));
      const externalConditionTexts = [...new Set(comparison.externalConditionTexts)];
      const key = buildComparisonKey(normalizedScopes, comparison.candidateSetText, externalConditionTexts);
      const group = groups.get(key) ?? {
        candidateSetText: comparison.candidateSetText,
        candidateScopes: normalizedScopes,
        preferredScopeLabels: new Map<string, string>(),
        externalConditionTexts,
        observationsByRun: new Map<number, ComparisonObservation>(),
        evidenceTexts: new Set<string>(),
        order: order++,
      };

      if (!groups.has(key)) {
        groups.set(key, group);
        for (const candidateScope of normalizedScopes) {
          group.preferredScopeLabels.set(buildScopeKey(candidateScope), chooseScopeLabel(candidateScope));
        }
      }

      const preferredScopeKey = resolvePreferredScopeKey(normalizedScopes, comparison.preferredScopeText);
      group.evidenceTexts.add(comparison.evidenceText);
      if (!group.preferredScopeLabels.has(preferredScopeKey)) {
        group.preferredScopeLabels.set(preferredScopeKey, comparison.preferredScopeText);
      }
      if (!group.observationsByRun.has(runIndex)) {
        group.observationsByRun.set(runIndex, {
          preferredScopeKey,
          preference: comparison.preference,
        });
      }
    });
  });

  return [...groups.values()].sort((left, right) => left.order - right.order);
}

function aggregateEvaluationGroup(group: EvaluationGroup, totalRuns: number): FinalEvaluation {
  const observations = [...group.observationsByRun.values()];
  const availability = computeAvailabilityFromSamples(
    observations.map((observation) => observation.availability),
    totalRuns,
  );
  const preference = computeNullablePreferenceSummary(observations.map((observation) => observation.preference));
  const availabilityWeight = computeAvailabilityWeightSummary(observations.map((observation) => observation.availabilityWeight));

  return {
    scope: group.scope,
    availability: availability.availability,
    availabilityConfidence: availability.confidence,
    availabilityConfidenceSource: availability.confidenceSource,
    availabilityWeight,
    preference,
    externalConditionTexts: group.externalConditionTexts,
    evidenceTexts: [...group.evidenceTexts],
    reviewStatus: availability.reviewStatus,
  };
}

function aggregateComparisonGroup(group: ComparisonGroup, totalRuns: number): FinalComparison {
  const observations = [...group.observationsByRun.values()];
  const directionCounts = new Map<string, number>();

  for (const observation of observations) {
    directionCounts.set(observation.preferredScopeKey, (directionCounts.get(observation.preferredScopeKey) ?? 0) + 1);
  }

  const topDirection = getTopEntry(directionCounts);
  const preferredScopeKey = topDirection?.[0] ?? buildScopeKey(group.candidateScopes[0] ?? {
    dateText: "全日付",
    dateType: "全日付",
    dateMemberTexts: ["全日付"],
    dateMembers: [],
    timeText: "全時間",
    timeType: "全時間",
    timeMembers: [],
    placeText: "全場所",
    placeType: "全場所",
    placeMembers: [],
    normalizedBy: "llm_fallback",
  });
  const directionConfidence = totalRuns <= 1 ? 0.9 : roundToTwo((topDirection?.[1] ?? 0) / totalRuns);
  const preference = computePreferenceSummary(observations.map((observation) => observation.preference));

  return {
    candidateSetText: group.candidateSetText,
    candidateScopes: group.candidateScopes,
    preferredScopeText:
      group.preferredScopeLabels.get(preferredScopeKey) ??
      chooseRepresentativeText(group.candidateScopes.map((scope) => scope.dateText)),
    directionConfidence,
    preference,
    externalConditionTexts: group.externalConditionTexts,
    evidenceTexts: [...group.evidenceTexts],
    reviewStatus: totalRuns <= 1 ? "base_only" : directionConfidence < 0.8 ? "mixed" : "stable",
  };
}

function buildUnresolved(
  drafts: BaseInterpretationDraft[],
  evaluations: FinalEvaluation[],
  comparisons: FinalComparison[],
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

  for (const item of evaluations.filter((evaluation) => evaluation.reviewStatus === "mixed")) {
    const key = `evaluation::${buildScopeKey(item.scope)}::${buildExternalConditionsKey(item.externalConditionTexts)}`;
    unresolvedMap.set(key, {
      scope: "evaluation",
      sourceText: item.evidenceTexts[0] ?? item.scope.dateText,
      reason: "複数回の全文解釈で可否または希望度が一致しませんでした。",
    });
  }

  for (const item of comparisons.filter((comparison) => comparison.reviewStatus === "mixed")) {
    const key = `comparison::${normalizeLooseText(item.evidenceTexts[0] ?? item.preferredScopeText)}`;
    unresolvedMap.set(key, {
      scope: "comparison",
      sourceText: item.evidenceTexts[0] ?? item.preferredScopeText,
      reason: "複数回の全文解釈で比較方向または希望度が一致しませんでした。",
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
  const evaluations = buildEvaluationGroups(params.drafts, params.candidates).map((group) =>
    aggregateEvaluationGroup(group, totalRuns),
  );
  const comparisons = buildComparisonGroups(params.drafts, params.candidates).map((group) =>
    aggregateComparisonGroup(group, totalRuns),
  );
  const unresolved = buildUnresolved(params.drafts, evaluations, comparisons);

  return {
    sourceText: params.note,
    evaluations,
    comparisons,
    unresolved,
    meta: {
      totalInterpretationRuns: totalRuns,
      performedAdditionalRuns: Math.max(0, totalRuns - 1),
      multiRunTriggered: totalRuns > 1,
    },
  } satisfies FinalInterpretationJson;
}
