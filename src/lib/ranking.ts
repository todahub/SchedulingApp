import { AVAILABILITY_LEVELS } from "./config";
import type {
  AdjustmentSuggestion,
  AutoInterpretationCondition,
  AutoInterpretationConditionResolvedAvailabilityLevel,
  AutoInterpretationConditionResolvedPreferenceLevel,
  AutoInterpretationComparisonPreferenceSignal,
  AutoInterpretationPreference,
  AutoInterpretationRule,
  EventCandidateRecord,
  EventDetail,
  ParticipantResponseRecord,
  ParsedCommentConstraint,
  RankedCandidate,
  RankedCandidateCollections,
  RankingConditionExplanation,
  RankingPreferenceExplanation,
  RankedCommentImpact,
  RankedParticipantStatus,
  ResultMode,
} from "./domain";
import { doesAutoInterpretationRuleMatchCandidate, inferConstraintLevelFromAutoInterpretationRule } from "./availability-comment-interpretation";
import {
  COMMENT_SCORE_MAP,
  deriveAvailabilityKeyFromConstraints,
  doesConstraintMatchCandidate,
  formatConstraintLevelLabel,
  formatParsedConstraintLabel,
  hasHardNoConstraintForCandidate,
  inferResponseInterpretationMode,
} from "./comment-parser";
import { formatCandidateLabel, getCandidateDateValues, getLevelByKey, normalizeCandidate, sortCandidatesByDate } from "./utils";

export const LABEL_WEIGHTS = {
  conditional_available: 4,
  available: 3,
  unknown: 2,
  unavailable: 1,
  condition_blocked: 0,
  strongly_unavailable: -3,
} as const;

const RANKING_WEEKDAY_VALUES = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "weekday",
  "weekend",
  "weekend_pair",
]);

const RANKING_TIME_VALUES = new Set([
  "morning",
  "noon",
  "afternoon",
  "evening",
  "night",
  "late_night",
  "until_last_train",
  "all_day",
  "overnight",
]);

const EMOTION_LABEL_SCORES = {
  strong_desire: 3,
  positive_preference: 2,
  weak_accept: 1,
  avoid: -2,
  dislike: -3,
  neutral: 0,
} as const;

type RankedLabelWeightKey = keyof typeof LABEL_WEIGHTS;
type ResultCandidateSlice = {
  candidate: EventCandidateRecord;
  sourceCandidate: EventCandidateRecord;
  sourceCandidateId: string;
  sourceDateValue: string;
  sourceTimeSlotKey: string;
};

type MatchedComparisonPreferenceSignal = {
  responseId: string;
  participantName: string;
  signal: AutoInterpretationComparisonPreferenceSignal;
  delta: number;
};

type MatchedAutoInterpretationPreference = {
  responseId: string;
  participantName: string;
  preference: AutoInterpretationPreference;
  delta: number;
};

type ConditionResolutionState = "resolved_true" | "resolved_false" | "unresolved";

type EmotionPreferenceBucket = keyof typeof EMOTION_LABEL_SCORES;

type CandidateAvailabilitySummary = {
  candidate: EventCandidateRecord;
  statusGroups: Record<string, string[]>;
  participantStatuses: RankedParticipantStatus[];
  baseScore: number;
  commentScore: number;
  commentImpacts: RankedCommentImpact[];
  hasHardNoConstraint: boolean;
  yesCount: number;
  maybeCount: number;
  noCount: number;
  availableCount: number;
  conditionalCount: number;
  unknownCount: number;
  unavailableCount: number;
};

type CandidateStatusMetrics = {
  hardNoCount: number;
  negativeCount: number;
  blockedCount: number;
  strongConditionalCount: number;
  lightConditionalCount: number;
  unknownCount: number;
  okCount: number;
  strongOkCount: number;
};

function getAvailabilityConstraints(constraints: ParsedCommentConstraint[]) {
  return constraints.filter((constraint) => constraint.intent !== "preference");
}

function getScoredCommentConstraints(constraints: ParsedCommentConstraint[]) {
  return constraints.filter((constraint) => constraint.source !== "auto_llm");
}

function pickRepresentativeConstraint(constraints: ParsedCommentConstraint[]) {
  return [...constraints].sort((left, right) => {
    const scoreDiff = COMMENT_SCORE_MAP[left.level] - COMMENT_SCORE_MAP[right.level];

    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return left.reasonText.localeCompare(right.reasonText);
  })[0] ?? null;
}

function pickRepresentativeAutoInterpretationRule(rules: AutoInterpretationRule[]) {
  return [...rules].sort((left, right) => {
    const scoreDiff =
      COMMENT_SCORE_MAP[inferConstraintLevelFromAutoInterpretationRule(left)] -
      COMMENT_SCORE_MAP[inferConstraintLevelFromAutoInterpretationRule(right)];

    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return left.availabilityText.localeCompare(right.availabilityText);
  })[0] ?? null;
}

function parseDateTimeTargetValue(targetValue: string) {
  const separatorIndex = targetValue.lastIndexOf("_");

  if (separatorIndex < 0) {
    return null;
  }

  return {
    baseValue: targetValue.slice(0, separatorIndex),
    timeValue: targetValue.slice(separatorIndex + 1),
  };
}

function buildSliceCandidate(candidate: EventCandidateRecord, dateValue: string, timeSlotKey: string, sortOrder: number): EventCandidateRecord {
  const timeType = timeSlotKey === "all_day" ? "all_day" : timeSlotKey === "unspecified" ? "unspecified" : "fixed";

  return {
    ...candidate,
    id: `${candidate.id}::${dateValue}::${timeSlotKey}`,
    date: dateValue,
    selectionMode: "range",
    dateType: "single",
    startDate: dateValue,
    endDate: dateValue,
    selectedDates: [],
    timeSlotKey,
    timeType,
    startTime: timeType === "fixed" ? candidate.startTime : null,
    endTime: timeType === "fixed" ? candidate.endTime : null,
    sortOrder,
  };
}

function collectTimeKeysForDate(candidate: EventCandidateRecord, dateValue: string, responses: ParticipantResponseRecord[]) {
  const timeKeys = new Set<string>();
  let shouldIncludeUnspecified = false;

  for (const response of responses) {
    const answer = response.answers.find((item) => item.candidateId === candidate.id);
    const answerAppliesToDate =
      Boolean(answer) &&
      (getCandidateDateValues(candidate).length === 1 ||
        answer?.selectedDates.length === 0 ||
        answer?.selectedDates.includes(dateValue));

    if (answerAppliesToDate) {
      const dateTimePreference = answer?.dateTimePreferences?.[dateValue];

      if (dateTimePreference) {
        timeKeys.add(dateTimePreference);
      } else if (answer?.preferredTimeSlotKey && answer.preferredTimeSlotKey !== "all_day") {
        timeKeys.add(answer.preferredTimeSlotKey);
      } else if (answer && answer.availabilityKey !== "no") {
        shouldIncludeUnspecified = true;
      }
    }

    for (const constraint of getAvailabilityConstraints(response.parsedConstraints ?? [])) {
      const dateCandidate = buildSliceCandidate(candidate, dateValue, "unspecified", candidate.sortOrder);

      if (!doesConstraintMatchCandidate(constraint, dateCandidate)) {
        continue;
      }

      if (constraint.targetType === "date_time") {
        const parsed = parseDateTimeTargetValue(constraint.targetValue);

        if (parsed?.timeValue && parsed.timeValue !== "all_day") {
          timeKeys.add(parsed.timeValue);
          continue;
        }
      }

      if (constraint.targetType === "time" && constraint.targetValue !== "all_day") {
        timeKeys.add(constraint.targetValue);
        continue;
      }

      shouldIncludeUnspecified = true;
    }
  }

  if (timeKeys.size === 0 || shouldIncludeUnspecified) {
    timeKeys.add(candidate.timeType === "all_day" ? "all_day" : candidate.timeType === "unspecified" ? "unspecified" : candidate.timeSlotKey);
  }

  return [...timeKeys];
}

function buildResultCandidateSlices(detail: EventDetail) {
  const slices = detail.candidates.flatMap((candidate) => {
    const normalized = normalizeCandidate(candidate);
    const dateValues = getCandidateDateValues(normalized);

    if (dateValues.length === 0) {
      return [];
    }

    return dateValues.flatMap((dateValue, dateIndex) => {
      const timeSlotKeys = normalized.timeType === "unspecified" ? collectTimeKeysForDate(normalized, dateValue, detail.responses) : [normalized.timeSlotKey];

      return timeSlotKeys.map((timeSlotKey, timeIndex) => ({
        candidate:
          dateValues.length === 1 && timeSlotKeys.length === 1 && timeSlotKey === normalized.timeSlotKey
            ? normalized
            : buildSliceCandidate(normalized, dateValue, timeSlotKey, normalized.sortOrder * 100 + dateIndex * 10 + timeIndex),
        sourceCandidate: normalized,
        sourceCandidateId: normalized.id,
        sourceDateValue: dateValue,
        sourceTimeSlotKey: timeSlotKey,
      }));
    });
  });

  const orderedCandidates = sortCandidatesByDate(slices.map((slice) => slice.candidate));
  const orderedKeys = new Map(
    orderedCandidates.map((candidate, index) => [`${candidate.id}:${candidate.sortOrder}`, index]),
  );

  return [...slices].sort((left, right) => {
    const leftOrder = orderedKeys.get(`${left.candidate.id}:${left.candidate.sortOrder}`) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderedKeys.get(`${right.candidate.id}:${right.candidate.sortOrder}`) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

function getToneForConstraintLevel(level: ParsedCommentConstraint["level"]) {
  if (level === "hard_no") {
    return "no" as const;
  }

  if (level === "soft_no" || level === "unknown" || level === "conditional") {
    return "maybe" as const;
  }

  return "yes" as const;
}

function formatAutoInterpretationRuleDetail(rule: AutoInterpretationRule) {
  return `${rule.targetText} → ${formatConstraintLevelLabel(inferConstraintLevelFromAutoInterpretationRule(rule))}`;
}

function getRankedLabelWeightKey(status: RankedParticipantStatus): RankedLabelWeightKey {
  if (status.isConditionBlocked) {
    return "condition_blocked";
  }

  if (status.constraintLevel === "conditional") {
    return "conditional_available";
  }

  if (status.constraintLevel === "unknown") {
    return "unknown";
  }

  if (status.constraintLevel === "soft_no") {
    return "unavailable";
  }

  if (status.constraintLevel === "hard_no") {
    return "strongly_unavailable";
  }

  if (status.constraintLevel === "soft_yes" || status.constraintLevel === "strong_yes") {
    return "available";
  }

  if (status.availabilityKey === "maybe") {
    return "unknown";
  }

  if (status.availabilityKey === "no") {
    return "strongly_unavailable";
  }

  return "available";
}

function getRankedLabelWeight(status: RankedParticipantStatus) {
  return LABEL_WEIGHTS[getRankedLabelWeightKey(status)];
}

function getResolvedPreferenceDelta(
  preference: AutoInterpretationPreference,
  resolvedPreferenceLevel: AutoInterpretationConditionResolvedPreferenceLevel | null | undefined,
) {
  switch (resolvedPreferenceLevel) {
    case "weak_accept":
      return EMOTION_LABEL_SCORES.weak_accept;
    case "preferred":
      return EMOTION_LABEL_SCORES.positive_preference;
    case "strong_preferred":
      return EMOTION_LABEL_SCORES.strong_desire;
    default:
      return getAutoInterpretationPreferenceDelta(preference);
  }
}

function isResolvedPreferencePositive(
  preference: AutoInterpretationPreference,
  resolvedPreferenceLevel: AutoInterpretationConditionResolvedPreferenceLevel | null | undefined,
) {
  if (resolvedPreferenceLevel === "weak_accept") {
    return true;
  }

  if (resolvedPreferenceLevel === "preferred" || resolvedPreferenceLevel === "strong_preferred") {
    return true;
  }

  return preference.level !== "avoid";
}

function isResolvedPreferenceStrong(
  preference: AutoInterpretationPreference,
  resolvedPreferenceLevel: AutoInterpretationConditionResolvedPreferenceLevel | null | undefined,
) {
  if (resolvedPreferenceLevel === "strong_preferred") {
    return true;
  }

  if (resolvedPreferenceLevel === "weak_accept" || resolvedPreferenceLevel === "preferred") {
    return false;
  }

  return preference.level === "strong_preferred";
}

function compareResolvedPreferenceLevels(
  left: AutoInterpretationConditionResolvedPreferenceLevel,
  right: AutoInterpretationConditionResolvedPreferenceLevel,
) {
  const weights: Record<AutoInterpretationConditionResolvedPreferenceLevel, number> = {
    weak_accept: 1,
    preferred: 2,
    strong_preferred: 3,
  };

  return weights[left] - weights[right];
}

function pickStrongestResolvedPreferenceLevel(
  levels: Array<AutoInterpretationConditionResolvedPreferenceLevel | null | undefined>,
) {
  const filteredLevels = levels.filter(
    (level): level is AutoInterpretationConditionResolvedPreferenceLevel => Boolean(level),
  );

  if (filteredLevels.length === 0) {
    return null;
  }

  return filteredLevels.sort((left, right) => compareResolvedPreferenceLevels(right, left))[0] ?? null;
}

function getCandidateSortDate(candidate: EventCandidateRecord) {
  return candidate.startDate || candidate.date;
}

function getMatchedPreferenceLevels(response: ParticipantResponseRecord, candidate: EventCandidateRecord) {
  return (response.parsedConstraints ?? [])
    .filter((constraint) => constraint.intent === "preference" && doesConstraintMatchCandidate(constraint, candidate))
    .map((constraint) => constraint.level);
}

function normalizeRankingWeekdayValue(value: string) {
  if (value === "weekend_pair") {
    return "weekend";
  }

  return RANKING_WEEKDAY_VALUES.has(value) ? value : null;
}

function normalizeRankingTimeValue(value: string) {
  if (value === "overnight") {
    return "all_day";
  }

  return RANKING_TIME_VALUES.has(value) ? value : null;
}

function areMatchingTokenIndexes(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);

  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function toAutoInterpretationPreferenceConstraint(
  preference: AutoInterpretationPreference,
): ParsedCommentConstraint | null {
  return buildAutoInterpretationTargetConstraint(
    preference.targetLabels,
    preference.targetNormalizedTexts,
    preference.targetText,
    preference.level === "avoid" ? "negative" : "positive",
    preference.level === "strong_preferred"
      ? "strong_yes"
      : preference.level === "preferred"
        ? "soft_yes"
        : "soft_no",
  );
}

function buildAutoInterpretationTargetConstraint(
  targetLabels: string[],
  targetNormalizedTexts: string[],
  targetText: string,
  polarity: ParsedCommentConstraint["polarity"],
  level: ParsedCommentConstraint["level"],
): ParsedCommentConstraint | null {
  const dateLikeLabels = targetLabels.filter((label) =>
    label === "target_date" ||
    label === "target_numeric_candidate" ||
    label === "target_date_range" ||
    label === "target_weekday" ||
    label === "target_weekday_group",
  );
  const timeLabels = targetLabels.filter((label) => label === "target_time_of_day");

  if (
    targetLabels.includes("target_date_range") ||
    dateLikeLabels.length > 1 ||
    timeLabels.length > 1
  ) {
    return null;
  }

  const dateValue =
    targetNormalizedTexts.find((value) => /^\d{4}-\d{2}-\d{2}$/u.test(value)) ?? null;
  const weekdayValue =
    targetNormalizedTexts.find((value) => RANKING_WEEKDAY_VALUES.has(value) || value.includes("+")) ??
    null;
  const timeValue =
    targetNormalizedTexts.find((value) => RANKING_TIME_VALUES.has(value)) ?? null;
  const normalizedWeekdayValue = weekdayValue ? normalizeRankingWeekdayValue(weekdayValue) : null;
  const normalizedTimeValue = timeValue ? normalizeRankingTimeValue(timeValue) : null;

  if (dateValue && normalizedTimeValue) {
    return {
      targetType: "date_time",
      targetValue: `${dateValue}_${normalizedTimeValue}`,
      polarity,
      level,
      reasonText: targetText,
      intent: "preference",
      source: "auto_llm",
    };
  }

  if (normalizedWeekdayValue && normalizedTimeValue) {
    return {
      targetType: "date_time",
      targetValue: `${normalizedWeekdayValue}_${normalizedTimeValue}`,
      polarity,
      level,
      reasonText: targetText,
      intent: "preference",
      source: "auto_llm",
    };
  }

  if (dateValue) {
    return {
      targetType: "date",
      targetValue: dateValue,
      polarity,
      level,
      reasonText: targetText,
      intent: "preference",
      source: "auto_llm",
    };
  }

  if (normalizedWeekdayValue) {
    return {
      targetType: "weekday",
      targetValue: normalizedWeekdayValue,
      polarity,
      level,
      reasonText: targetText,
      intent: "preference",
      source: "auto_llm",
    };
  }

  if (normalizedTimeValue) {
    return {
      targetType: "time",
      targetValue: normalizedTimeValue,
      polarity,
      level,
      reasonText: targetText,
      intent: "preference",
      source: "auto_llm",
    };
  }

  return null;
}

function getMatchedAutoInterpretationPreferences(
  response: ParticipantResponseRecord,
  candidate: EventCandidateRecord,
) {
  return (response.autoInterpretation?.preferences ?? []).filter((preference) => {
    const derivedConstraint = toAutoInterpretationPreferenceConstraint(preference);

    return derivedConstraint ? doesConstraintMatchCandidate(derivedConstraint, candidate) : false;
  });
}

function inferEmotionPreferenceBucket(preference: AutoInterpretationPreference): EmotionPreferenceBucket {
  const markerText = preference.markerTexts.join("").toLowerCase();

  if (preference.markerLabels.includes("emotion_weak_accept_marker")) {
    return "weak_accept";
  }

  if (preference.level === "avoid") {
    if (/嫌|いや|やだ|やめてほしい/u.test(markerText)) {
      return "dislike";
    }

    return "avoid";
  }

  if (
    preference.level === "strong_preferred" ||
    /行きたい|いきたい|参加したい|出たい|第一希望|最優先|一番いい|一番良い|ベスト|理想/u.test(markerText)
  ) {
    return "strong_desire";
  }

  if (/でもいい|まあいい|まーいい|構わない|かまわない|どちらでもいい|どっちでもいい/u.test(markerText)) {
    return "weak_accept";
  }

  if (
    /嬉しい|うれしい|ありがたい|助かる|希望|無難|良い|いい|都合いい|都合がいい/u.test(markerText)
  ) {
    return "positive_preference";
  }

  return preference.level === "preferred" ? "positive_preference" : "neutral";
}

function getAutoInterpretationPreferenceDelta(preference: AutoInterpretationPreference) {
  return EMOTION_LABEL_SCORES[inferEmotionPreferenceBucket(preference)];
}

function toComparisonPreferenceConstraint(signal: AutoInterpretationComparisonPreferenceSignal): ParsedCommentConstraint {
  return {
    targetType: signal.targetType,
    targetValue: signal.targetValue,
    polarity: signal.signal === "dispreferred" ? "negative" : "positive",
    level: "soft_yes",
    reasonText: signal.targetText,
    intent: "preference",
    source: "auto_llm",
  };
}

function getMatchedComparisonPreferenceSignals(
  response: ParticipantResponseRecord,
  candidate: EventCandidateRecord,
) {
  return (response.autoInterpretation?.comparisonPreferenceSignals ?? []).filter((signal) =>
    doesConstraintMatchCandidate(toComparisonPreferenceConstraint(signal), candidate),
  );
}

function getComparisonPreferenceSignalDelta(signal: AutoInterpretationComparisonPreferenceSignal) {
  let magnitude = 0;

  if (signal.confidence === "high") {
    if (signal.strength === "strong") {
      magnitude = 2;
    } else if (signal.strength === "weak") {
      magnitude = 1;
    } else {
      magnitude = 0.5;
    }
  } else if (signal.confidence === "medium") {
    if (signal.strength === "strong") {
      magnitude = 1;
    } else if (signal.strength === "weak") {
      magnitude = 0.5;
    } else {
      magnitude = 0.25;
    }
  }

  return signal.signal === "dispreferred" ? -magnitude : magnitude;
}

function toAutoInterpretationConditionConstraint(
  condition: AutoInterpretationCondition,
): ParsedCommentConstraint | null {
  return buildAutoInterpretationTargetConstraint(
    condition.targetLabels,
    condition.targetNormalizedTexts,
    condition.targetText,
    "positive",
    "strong_yes",
  );
}

function getMatchedAutoInterpretationConditions(
  response: ParticipantResponseRecord,
  candidate: EventCandidateRecord,
) {
  return (response.autoInterpretation?.conditions ?? []).filter((condition) => {
    const derivedConstraint = toAutoInterpretationConditionConstraint(condition);
    return derivedConstraint ? doesConstraintMatchCandidate(derivedConstraint, candidate) : false;
  });
}

function buildPreferenceExplanations(
  matchedSignals: MatchedComparisonPreferenceSignal[],
): RankingPreferenceExplanation[] {
  const explanationMap = new Map<string, RankingPreferenceExplanation>();

  for (const matchedSignal of matchedSignals) {
    if (matchedSignal.delta === 0) {
      continue;
    }

    const key = `${matchedSignal.responseId}::${matchedSignal.signal.targetGroupId}`;
    const existing = explanationMap.get(key);

    if (existing) {
      existing.preferenceScoreDelta += matchedSignal.delta;
      existing.appliedSignals.push({
        sourceJudgmentIndex: matchedSignal.signal.sourceJudgmentIndex,
        signal: matchedSignal.signal.signal,
        strength: matchedSignal.signal.strength,
        confidence: matchedSignal.signal.confidence,
      });
      continue;
    }

    explanationMap.set(key, {
      responseId: matchedSignal.responseId,
      participantName: matchedSignal.participantName,
      targetGroupId: matchedSignal.signal.targetGroupId,
      targetText: matchedSignal.signal.targetText,
      preferenceScoreDelta: matchedSignal.delta,
      appliedSignals: [
        {
          sourceJudgmentIndex: matchedSignal.signal.sourceJudgmentIndex,
          signal: matchedSignal.signal.signal,
          strength: matchedSignal.signal.strength,
          confidence: matchedSignal.signal.confidence,
        },
      ],
    });
  }

  return [...explanationMap.values()].sort((left, right) => {
    if (left.preferenceScoreDelta !== right.preferenceScoreDelta) {
      return right.preferenceScoreDelta - left.preferenceScoreDelta;
    }

    if (left.participantName !== right.participantName) {
      return left.participantName.localeCompare(right.participantName);
    }

    return left.targetGroupId.localeCompare(right.targetGroupId);
  });
}

function compareResolvedAvailabilityLevels(
  left: AutoInterpretationConditionResolvedAvailabilityLevel,
  right: AutoInterpretationConditionResolvedAvailabilityLevel,
) {
  const weights: Record<AutoInterpretationConditionResolvedAvailabilityLevel, number> = {
    conditional: 1,
    soft_yes: 2,
    strong_yes: 3,
  };

  return weights[left] - weights[right];
}

function pickStrongestResolvedAvailabilityLevel(
  levels: Array<AutoInterpretationConditionResolvedAvailabilityLevel | null | undefined>,
) {
  const filteredLevels = levels.filter(
    (level): level is AutoInterpretationConditionResolvedAvailabilityLevel => Boolean(level),
  );

  if (filteredLevels.length === 0) {
    return null;
  }

  return filteredLevels.sort((left, right) => compareResolvedAvailabilityLevels(right, left))[0] ?? null;
}

function buildConditionBlockedParticipantStatus(
  status: RankedParticipantStatus,
): RankedParticipantStatus {
  return {
    ...status,
    availabilityKey: "no",
    label: "条件待ち",
    weight: LABEL_WEIGHTS.condition_blocked,
    tone: "no",
    constraintLevel: null,
    isExplicit: true,
    isConditionBlocked: true,
    detailLabels: [
      ...status.detailLabels,
      "条件がまだ満たされていないため、今のランキングではこの候補を採用していません。",
    ],
  };
}

function buildResolvedAvailabilityParticipantStatus(
  status: RankedParticipantStatus,
  resolvedAvailabilityLevel: AutoInterpretationConditionResolvedAvailabilityLevel,
): RankedParticipantStatus {
  return {
    ...status,
    availabilityKey: resolvedAvailabilityLevel === "conditional" ? "maybe" : "yes",
    label: formatConstraintLevelLabel(resolvedAvailabilityLevel),
    weight: COMMENT_SCORE_MAP[resolvedAvailabilityLevel],
    tone: getToneForConstraintLevel(resolvedAvailabilityLevel),
    constraintLevel: resolvedAvailabilityLevel,
    isExplicit: true,
    isConditionBlocked: false,
    detailLabels: [
      ...status.detailLabels,
      `条件が満たされた場合は ${formatConstraintLevelLabel(resolvedAvailabilityLevel)} として扱います。`,
    ],
  };
}

function toConditionAcceptedLevel(status: RankedParticipantStatus) {
  if (status.constraintLevel === "conditional") {
    return "conditional" as const;
  }

  if (status.constraintLevel === "soft_yes") {
    return "soft_yes" as const;
  }

  if (status.constraintLevel === "strong_yes" || status.availabilityKey === "yes") {
    return "strong_yes" as const;
  }

  return null;
}

function isDefinitiveNoStatus(status: RankedParticipantStatus) {
  return (
    status.constraintLevel === "hard_no" ||
    status.constraintLevel === "soft_no" ||
    (status.constraintLevel === null && status.availabilityKey === "no")
  );
}

function buildBestAttendanceTopIds(
  candidates: RankedCandidate[],
  metricsByCandidateId: Map<string, CandidateRankingMetrics>,
) {
  if (candidates.length === 0) {
    return new Set<string>();
  }

  const first = candidates[0]!;
  return new Set(
    candidates
      .filter((candidate) => compareCompromiseCandidates(candidate, first, metricsByCandidateId, true) === 0)
      .map((candidate) => candidate.candidate.id),
  );
}

function resolveConditionAgainstParticipantStatuses(
  condition: AutoInterpretationCondition,
  responseId: string,
  candidate: EventCandidateRecord,
  participantStatuses: RankedParticipantStatus[],
  baselinePerfectNowRanking: RankedCandidate[],
  baselineBestAttendanceRanking: RankedCandidate[],
  baselineMetricsByCandidateId: Map<string, CandidateRankingMetrics>,
): ConditionResolutionState {
  switch (condition.resolverType) {
    case "all_others_available": {
      const relevantStatuses = participantStatuses.filter((status) => status.responseId !== responseId);

      if (relevantStatuses.length === 0) {
        return "unresolved";
      }

      let hasUnresolved = false;
      for (const status of relevantStatuses) {
        const acceptedLevel = toConditionAcceptedLevel(status);

        if (acceptedLevel && condition.requiredAvailabilityLevels.includes(acceptedLevel)) {
          continue;
        }

        if (isDefinitiveNoStatus(status)) {
          return "resolved_false";
        }

        hasUnresolved = true;
      }

      return hasUnresolved ? "unresolved" : "resolved_true";
    }
    case "attendance_threshold": {
      const targetCount = condition.threshold?.count ?? 0;
      const relevantStatuses =
        condition.participantScope === "all_others"
          ? participantStatuses.filter((status) => status.responseId !== responseId)
          : participantStatuses;
      let satisfiedCount = 0;
      let unresolvedCount = 0;

      for (const status of relevantStatuses) {
        const acceptedLevel = toConditionAcceptedLevel(status);

        if (acceptedLevel && condition.requiredAvailabilityLevels.includes(acceptedLevel)) {
          satisfiedCount += 1;
          continue;
        }

        if (!isDefinitiveNoStatus(status)) {
          unresolvedCount += 1;
        }
      }

      if (satisfiedCount >= targetCount) {
        return "resolved_true";
      }

      if (satisfiedCount + unresolvedCount >= targetCount) {
        return "unresolved";
      }

      return "resolved_false";
    }
    case "unique_unanimous_candidate": {
      if (baselinePerfectNowRanking.length === 0) {
        return "unresolved";
      }

      return baselinePerfectNowRanking.length === 1 && baselinePerfectNowRanking[0]?.candidate.id === candidate.id
        ? "resolved_true"
        : "resolved_false";
    }
    case "best_attendance_candidate": {
      const topIds = buildBestAttendanceTopIds(baselineBestAttendanceRanking, baselineMetricsByCandidateId);
      return topIds.has(candidate.id) ? "resolved_true" : "resolved_false";
    }
    case "self_convenience":
    case "unknown":
    default:
      return "unresolved";
  }
}

function toConditionExplanation(
  response: ParticipantResponseRecord,
  condition: AutoInterpretationCondition,
  resolution: ConditionResolutionState,
): RankingConditionExplanation {
  const affects =
    condition.sourcePreferenceTargetTokenIndexes && condition.resolvedAvailabilityLevel
      ? "both"
      : condition.sourcePreferenceTargetTokenIndexes
        ? "preference"
        : condition.resolvedAvailabilityLevel
          ? "availability"
          : "availability";

  return {
    responseId: response.id,
    participantName: response.participantName,
    targetText: condition.targetText,
    kind: condition.kind,
    resolverType: condition.resolverType,
    resolution,
    affects,
  };
}

function applyAvailabilityConditionStateToStatus(
  baseStatus: RankedParticipantStatus,
  conditionStates: Array<{
    condition: AutoInterpretationCondition;
    resolution: ConditionResolutionState;
  }>,
  phase: "current" | "projected",
) {
  const relevantConditionStates = conditionStates.filter(
    (state) => state.condition.unresolvedBehavior === "blocked" || state.condition.resolvedAvailabilityLevel,
  );

  if (relevantConditionStates.length === 0) {
    return baseStatus;
  }

  const hasBlockingFailure = relevantConditionStates.some(
    (state) =>
      state.condition.unresolvedBehavior === "blocked" &&
      (phase === "current"
        ? state.resolution !== "resolved_true"
        : state.resolution === "resolved_false"),
  );

  if (hasBlockingFailure) {
    return buildConditionBlockedParticipantStatus(baseStatus);
  }

  const candidateLevels = relevantConditionStates
    .filter((state) =>
      phase === "current"
        ? state.resolution === "resolved_true"
        : state.resolution !== "resolved_false",
    )
    .map((state) => state.condition.resolvedAvailabilityLevel);
  const strongestLevel = pickStrongestResolvedAvailabilityLevel(candidateLevels);

  if (!strongestLevel) {
    return baseStatus;
  }

  return buildResolvedAvailabilityParticipantStatus(baseStatus, strongestLevel);
}

function getResolvedAutoInterpretationStatuses(
  response: ParticipantResponseRecord,
  candidateSlice: ResultCandidateSlice,
) {
  const { sourceCandidateId, sourceDateValue, sourceTimeSlotKey } = candidateSlice;
  const resolvedStatuses = response.autoInterpretation?.resolvedCandidateStatuses ?? [];
  const matchingStatuses = resolvedStatuses.filter(
    (status) => status.candidateId === sourceCandidateId && status.dateValue === sourceDateValue,
  );

  if (matchingStatuses.length === 0) {
    return [];
  }

  const exactStatuses = matchingStatuses.filter((status) => status.timeSlotKey === sourceTimeSlotKey);

  if (exactStatuses.length > 0) {
    return exactStatuses;
  }

  return matchingStatuses.filter((status) => status.timeSlotKey === null);
}

function getAllResolvedAutoInterpretationStatuses(
  response: ParticipantResponseRecord,
  candidateSlice: ResultCandidateSlice,
) {
  const { sourceCandidateId, sourceDateValue } = candidateSlice;
  const resolvedStatuses = response.autoInterpretation?.resolvedCandidateStatuses ?? [];

  return resolvedStatuses.filter((status) => status.candidateId === sourceCandidateId && status.dateValue === sourceDateValue);
}

function isPositiveishConstraintLevel(level: NonNullable<RankedParticipantStatus["constraintLevel"]>) {
  return level === "conditional" || level === "soft_yes" || level === "strong_yes";
}

type CandidateRankingMetrics = {
  hardNoCount: number;
  negativeCount: number;
  blockedCount: number;
  strongConditionalCount: number;
  lightConditionalCount: number;
  unknownCount: number;
  okCount: number;
  strongOkCount: number;
  wishCount: number;
  strongWishCount: number;
  plainPreferenceScoreDelta: number;
  comparisonPreferenceScoreDelta: number;
  preferenceScoreDelta: number;
  pendingConditionWishCount: number;
  pendingConditionStrongWishCount: number;
  pendingConditionPreferenceScoreDelta: number;
  projectedHardNoCount: number;
  projectedNegativeCount: number;
  projectedBlockedCount: number;
  projectedStrongConditionalCount: number;
  projectedLightConditionalCount: number;
  projectedUnknownCount: number;
  projectedOkCount: number;
  projectedStrongOkCount: number;
  projectedWishCount: number;
  projectedStrongWishCount: number;
  projectedPreferenceScoreDelta: number;
};

function buildCandidateStatusMetrics(statuses: RankedParticipantStatus[], hasHardNoConstraint = false): CandidateStatusMetrics {
  let hardNoCount = 0;
  let negativeCount = 0;
  let blockedCount = 0;
  let strongConditionalCount = 0;
  let lightConditionalCount = 0;
  let unknownCount = 0;
  let okCount = 0;
  let strongOkCount = 0;

  for (const status of statuses) {
    if (status.isConditionBlocked) {
      blockedCount += 1;
      continue;
    }

    if (status.constraintLevel === "hard_no" || (status.constraintLevel === null && status.availabilityKey === "no")) {
      hardNoCount += 1;
      continue;
    }

    if (status.constraintLevel === "soft_no") {
      negativeCount += 1;
      continue;
    }

    if (status.constraintLevel === "soft_yes") {
      strongConditionalCount += 1;
      continue;
    }

    if (status.constraintLevel === "conditional") {
      lightConditionalCount += 1;
      continue;
    }

    if (status.constraintLevel === "unknown" || (status.constraintLevel === null && status.availabilityKey === "maybe")) {
      unknownCount += 1;
      continue;
    }

    if (status.constraintLevel === "strong_yes") {
      strongOkCount += 1;
      continue;
    }

    okCount += 1;
  }

  hardNoCount = Math.max(hardNoCount, hasHardNoConstraint ? 1 : 0);

  return {
    hardNoCount,
    negativeCount,
    blockedCount,
    strongConditionalCount,
    lightConditionalCount,
    unknownCount,
    okCount,
    strongOkCount,
  };
}

function getCandidateRankingBucket(status: RankedParticipantStatus) {
  if (status.constraintLevel === "hard_no" || (status.constraintLevel === null && status.availabilityKey === "no")) {
    return "hard_no" as const;
  }

  if (status.constraintLevel === "soft_no") {
    return "negative" as const;
  }

  if (status.constraintLevel === "conditional") {
    return "light_conditional" as const;
  }

  if (status.constraintLevel === "unknown" || (status.constraintLevel === null && status.availabilityKey === "maybe")) {
    return "unknown" as const;
  }

  if (status.constraintLevel === "strong_yes") {
    return "strong_ok" as const;
  }

  return "ok" as const;
}

function isImmediatelyDecidableCandidate(metrics: CandidateRankingMetrics) {
  return (
    metrics.blockedCount === 0 &&
    metrics.lightConditionalCount === 0 &&
    metrics.unknownCount === 0
  );
}

function isUnanimousCandidate(metrics: CandidateRankingMetrics) {
  return metrics.hardNoCount === 0 && isImmediatelyDecidableCandidate(metrics);
}

function isPotentialUnanimousCandidate(metrics: CandidateRankingMetrics) {
  return metrics.hardNoCount === 0 && !isImmediatelyDecidableCandidate(metrics);
}

function isPerfectNowCandidate(metrics: CandidateRankingMetrics) {
  return (
    metrics.hardNoCount === 0 &&
    metrics.negativeCount === 0 &&
    metrics.blockedCount === 0 &&
    metrics.lightConditionalCount === 0 &&
    metrics.unknownCount === 0
  );
}

function isProjectedPerfectNowCandidate(metrics: CandidateRankingMetrics) {
  return (
    metrics.projectedHardNoCount === 0 &&
    metrics.projectedNegativeCount === 0 &&
    metrics.projectedBlockedCount === 0 &&
    metrics.projectedStrongConditionalCount === 0 &&
    metrics.projectedLightConditionalCount === 0 &&
    metrics.projectedUnknownCount === 0
  );
}

function isPerfectIfResolvedCandidate(metrics: CandidateRankingMetrics) {
  return !isPerfectNowCandidate(metrics) && isProjectedPerfectNowCandidate(metrics);
}

function compareImmediateUnanimousCandidates(
  left: RankedCandidate,
  right: RankedCandidate,
  metricsByCandidateId: Map<string, CandidateRankingMetrics>,
) {
  const leftMetrics = metricsByCandidateId.get(left.candidate.id)!;
  const rightMetrics = metricsByCandidateId.get(right.candidate.id)!;

  if (leftMetrics.negativeCount !== rightMetrics.negativeCount) {
    return leftMetrics.negativeCount - rightMetrics.negativeCount;
  }

  if (leftMetrics.strongOkCount !== rightMetrics.strongOkCount) {
    return rightMetrics.strongOkCount - leftMetrics.strongOkCount;
  }

  const leftPositiveCount = leftMetrics.okCount + leftMetrics.strongConditionalCount;
  const rightPositiveCount = rightMetrics.okCount + rightMetrics.strongConditionalCount;

  if (leftPositiveCount !== rightPositiveCount) {
    return rightPositiveCount - leftPositiveCount;
  }

  if (leftMetrics.wishCount !== rightMetrics.wishCount) {
    return rightMetrics.wishCount - leftMetrics.wishCount;
  }

  if (leftMetrics.strongWishCount !== rightMetrics.strongWishCount) {
    return rightMetrics.strongWishCount - leftMetrics.strongWishCount;
  }

  if (leftMetrics.preferenceScoreDelta !== rightMetrics.preferenceScoreDelta) {
    return rightMetrics.preferenceScoreDelta - leftMetrics.preferenceScoreDelta;
  }

  const leftDate = getCandidateSortDate(left.candidate);
  const rightDate = getCandidateSortDate(right.candidate);

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  return left.candidate.sortOrder - right.candidate.sortOrder;
}

function getProjectedResolvedMetrics(metrics: CandidateRankingMetrics) {
  return {
    ...metrics,
    hardNoCount: metrics.projectedHardNoCount,
    negativeCount: metrics.projectedNegativeCount,
    blockedCount: metrics.projectedBlockedCount,
    strongConditionalCount: metrics.projectedStrongConditionalCount,
    lightConditionalCount: metrics.projectedLightConditionalCount,
    unknownCount: metrics.projectedUnknownCount,
    okCount: metrics.projectedOkCount,
    strongOkCount: metrics.projectedStrongOkCount,
    wishCount: metrics.projectedWishCount,
    strongWishCount: metrics.projectedStrongWishCount,
    preferenceScoreDelta: metrics.projectedPreferenceScoreDelta,
  };
}

function compareProjectedResolvedCandidates(
  left: RankedCandidate,
  right: RankedCandidate,
  metricsByCandidateId: Map<string, CandidateRankingMetrics>,
) {
  const leftMetrics = getProjectedResolvedMetrics(metricsByCandidateId.get(left.candidate.id)!);
  const rightMetrics = getProjectedResolvedMetrics(metricsByCandidateId.get(right.candidate.id)!);

  if (leftMetrics.negativeCount !== rightMetrics.negativeCount) {
    return leftMetrics.negativeCount - rightMetrics.negativeCount;
  }

  if (leftMetrics.strongOkCount !== rightMetrics.strongOkCount) {
    return rightMetrics.strongOkCount - leftMetrics.strongOkCount;
  }

  const leftPositiveCount = leftMetrics.okCount + leftMetrics.strongConditionalCount;
  const rightPositiveCount = rightMetrics.okCount + rightMetrics.strongConditionalCount;

  if (leftPositiveCount !== rightPositiveCount) {
    return rightPositiveCount - leftPositiveCount;
  }

  if (leftMetrics.wishCount !== rightMetrics.wishCount) {
    return rightMetrics.wishCount - leftMetrics.wishCount;
  }

  if (leftMetrics.strongWishCount !== rightMetrics.strongWishCount) {
    return rightMetrics.strongWishCount - leftMetrics.strongWishCount;
  }

  if (leftMetrics.preferenceScoreDelta !== rightMetrics.preferenceScoreDelta) {
    return rightMetrics.preferenceScoreDelta - leftMetrics.preferenceScoreDelta;
  }

  const leftDate = getCandidateSortDate(left.candidate);
  const rightDate = getCandidateSortDate(right.candidate);

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  return left.candidate.sortOrder - right.candidate.sortOrder;
}

function compareCompromiseCandidates(
  left: RankedCandidate,
  right: RankedCandidate,
  metricsByCandidateId: Map<string, CandidateRankingMetrics>,
  includeUnresolvedPenalty = false,
) {
  const leftMetrics = metricsByCandidateId.get(left.candidate.id)!;
  const rightMetrics = metricsByCandidateId.get(right.candidate.id)!;

  if (leftMetrics.hardNoCount !== rightMetrics.hardNoCount) {
    return leftMetrics.hardNoCount - rightMetrics.hardNoCount;
  }

  if (leftMetrics.negativeCount !== rightMetrics.negativeCount) {
    return leftMetrics.negativeCount - rightMetrics.negativeCount;
  }

  if (leftMetrics.blockedCount !== rightMetrics.blockedCount) {
    return leftMetrics.blockedCount - rightMetrics.blockedCount;
  }

  if (includeUnresolvedPenalty) {
    if (leftMetrics.strongConditionalCount !== rightMetrics.strongConditionalCount) {
      return leftMetrics.strongConditionalCount - rightMetrics.strongConditionalCount;
    }

    if (leftMetrics.lightConditionalCount !== rightMetrics.lightConditionalCount) {
      return leftMetrics.lightConditionalCount - rightMetrics.lightConditionalCount;
    }

    if (leftMetrics.unknownCount !== rightMetrics.unknownCount) {
      return leftMetrics.unknownCount - rightMetrics.unknownCount;
    }
  }

  if (leftMetrics.strongOkCount !== rightMetrics.strongOkCount) {
    return rightMetrics.strongOkCount - leftMetrics.strongOkCount;
  }

  if (leftMetrics.okCount !== rightMetrics.okCount) {
    return rightMetrics.okCount - leftMetrics.okCount;
  }

  if (leftMetrics.wishCount !== rightMetrics.wishCount) {
    return rightMetrics.wishCount - leftMetrics.wishCount;
  }

  if (leftMetrics.strongWishCount !== rightMetrics.strongWishCount) {
    return rightMetrics.strongWishCount - leftMetrics.strongWishCount;
  }

  if (leftMetrics.preferenceScoreDelta !== rightMetrics.preferenceScoreDelta) {
    return rightMetrics.preferenceScoreDelta - leftMetrics.preferenceScoreDelta;
  }

  const leftDate = getCandidateSortDate(left.candidate);
  const rightDate = getCandidateSortDate(right.candidate);

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  return left.candidate.sortOrder - right.candidate.sortOrder;
}

function canBeatReferenceIfResolved(
  candidate: RankedCandidate,
  reference: RankedCandidate,
  metricsByCandidateId: Map<string, CandidateRankingMetrics>,
) {
  const candidateMetrics = metricsByCandidateId.get(candidate.candidate.id)!;
  const referenceMetrics = metricsByCandidateId.get(reference.candidate.id)!;

  if (referenceMetrics.hardNoCount > 0 && candidateMetrics.hardNoCount === 0) {
    return true;
  }

  return compareProjectedResolvedCandidates(candidate, reference, metricsByCandidateId) < 0;
}

function buildRankedParticipantStatus(
  response: ParticipantResponseRecord,
  candidateSlice: ResultCandidateSlice,
  allCandidates: EventCandidateRecord[],
  interpretationMode: ReturnType<typeof inferResponseInterpretationMode>,
): RankedParticipantStatus {
  const { candidate, sourceCandidate, sourceCandidateId, sourceDateValue, sourceTimeSlotKey } = candidateSlice;

  if (interpretationMode === "parsed_comment") {
    const allResolvedStatuses = getAllResolvedAutoInterpretationStatuses(response, candidateSlice);
    const resolvedStatuses = getResolvedAutoInterpretationStatuses(response, candidateSlice);

    if (resolvedStatuses.length > 0) {
      const representativeStatus = [...resolvedStatuses].sort(
        (left, right) => COMMENT_SCORE_MAP[left.level] - COMMENT_SCORE_MAP[right.level],
      )[0]!;
      const representativeLevel = representativeStatus.level;
      const level = getLevelByKey(
        representativeLevel === "hard_no"
          ? "no"
          : representativeLevel === "soft_no" || representativeLevel === "unknown" || representativeLevel === "conditional"
            ? "maybe"
            : "yes",
      );

      return {
        responseId: response.id,
        participantName: response.participantName,
        availabilityKey: level.key,
        label: formatConstraintLevelLabel(representativeLevel),
        weight: COMMENT_SCORE_MAP[representativeLevel],
        tone: getToneForConstraintLevel(representativeLevel),
        constraintLevel: representativeLevel,
        source: "parsed_comment",
        isExplicit: true,
        detailLabels: [...new Set(resolvedStatuses.map((status) => status.detailLabel))],
      };
    }

    const mismatchedTimeStatuses = allResolvedStatuses.filter(
      (status) =>
        status.timeSlotKey !== null &&
        status.timeSlotKey !== sourceTimeSlotKey &&
        isPositiveishConstraintLevel(status.level) &&
        sourceCandidate.timeType !== "unspecified",
    );

    if (mismatchedTimeStatuses.length > 0) {
      const level = getLevelByKey("no");

      return {
        responseId: response.id,
        participantName: response.participantName,
        availabilityKey: level.key,
        label: level.label,
        weight: level.weight,
        tone: level.tone,
        constraintLevel: null,
        source: "parsed_comment",
        isExplicit: true,
        detailLabels: [
          ...new Set([
            ...mismatchedTimeStatuses.map((status) => status.detailLabel),
            "この候補はコメントで指定された別の時間帯なら参加可能と解釈されているため、結果集計では参加不可として扱っています。",
          ]),
        ],
      };
    }

    const autoInterpretationRules =
      response.autoInterpretation?.status === "success"
        ? response.autoInterpretation.rules.filter((rule) => doesAutoInterpretationRuleMatchCandidate(rule, candidate, allCandidates))
        : [];

    if (autoInterpretationRules.length > 0) {
      const representativeRule = pickRepresentativeAutoInterpretationRule(autoInterpretationRules);
      const representativeLevel = representativeRule ? inferConstraintLevelFromAutoInterpretationRule(representativeRule) : null;
      const level = getLevelByKey(
        representativeLevel === "hard_no"
          ? "no"
          : representativeLevel === "soft_no" || representativeLevel === "unknown" || representativeLevel === "conditional"
            ? "maybe"
            : "yes",
      );

      return {
        responseId: response.id,
        participantName: response.participantName,
        availabilityKey: level.key,
        label: representativeLevel ? formatConstraintLevelLabel(representativeLevel) : level.label,
        weight: representativeLevel ? COMMENT_SCORE_MAP[representativeLevel] : level.weight,
        tone: representativeLevel ? getToneForConstraintLevel(representativeLevel) : level.tone,
        constraintLevel: representativeLevel,
        source: "parsed_comment",
        isExplicit: true,
        detailLabels: [...new Set(autoInterpretationRules.map((rule) => formatAutoInterpretationRuleDetail(rule)))],
      };
    }

    const matchingConstraints = getAvailabilityConstraints(response.parsedConstraints ?? []).filter((constraint) =>
      doesConstraintMatchCandidate(constraint, candidate),
    );
    const representativeConstraint = pickRepresentativeConstraint(matchingConstraints);
    const availabilityKey =
      matchingConstraints.length > 0 ? deriveAvailabilityKeyFromConstraints(matchingConstraints) : "maybe";
    const level = getLevelByKey(availabilityKey);
    const parsedConstraintLevel = representativeConstraint?.level ?? null;
    const detailLabels =
      matchingConstraints.length > 0
        ? [...new Set(matchingConstraints.map((constraint) => formatParsedConstraintLabel(constraint)))]
        : ["この候補への明示ラベルがないため、結果集計では微妙として扱っています。"];

    return {
      responseId: response.id,
      participantName: response.participantName,
      availabilityKey: level.key,
      label: parsedConstraintLevel ? formatConstraintLevelLabel(parsedConstraintLevel) : level.label,
      weight: parsedConstraintLevel ? COMMENT_SCORE_MAP[parsedConstraintLevel] : level.weight,
      tone: parsedConstraintLevel ? getToneForConstraintLevel(parsedConstraintLevel) : level.tone,
      constraintLevel: parsedConstraintLevel,
      source: "parsed_comment",
      isExplicit: matchingConstraints.length > 0,
      detailLabels,
    };
  }

  if (interpretationMode === "unparsed_default") {
    const level = getLevelByKey("maybe");

    return {
      responseId: response.id,
      participantName: response.participantName,
      availabilityKey: level.key,
      label: level.label,
      weight: level.weight,
      tone: level.tone,
      constraintLevel: null,
      source: "unparsed_comment_default",
      isExplicit: false,
      detailLabels: ["自動解釈できなかったため、結果集計では微妙として扱っています。"],
    };
  }

  const answer = response.answers.find((item) => item.candidateId === sourceCandidateId);
  const sourceCandidateDateValues = getCandidateDateValues(sourceCandidate);
  const answerCoversDate =
    Boolean(answer) &&
    (sourceCandidateDateValues.length === 1 || answer?.selectedDates.length === 0 || answer?.selectedDates.includes(sourceDateValue));
  const explicitTimeMatch =
    sourceCandidate.timeType !== "unspecified" ||
    sourceTimeSlotKey === "unspecified" ||
    answer?.dateTimePreferences?.[sourceDateValue] === sourceTimeSlotKey ||
    answer?.preferredTimeSlotKey === sourceTimeSlotKey;
  const manualAvailabilityKey =
    !answer || !answerCoversDate ? "no" : answer.availabilityKey === "no" ? "no" : explicitTimeMatch ? answer.availabilityKey : "no";
  const level = getLevelByKey(manualAvailabilityKey);

  return {
    responseId: response.id,
    participantName: response.participantName,
    availabilityKey: level.key,
    label: level.label,
    weight: level.weight,
    tone: level.tone,
    constraintLevel: null,
    source: "manual_answer",
    isExplicit: Boolean(answer && answerCoversDate && (answer.availabilityKey === "no" || explicitTimeMatch)),
    detailLabels: [],
  };
}

function buildCandidateAvailabilitySummary(
  detail: EventDetail,
  candidateSlice: ResultCandidateSlice,
  responseModes: Array<{
    response: ParticipantResponseRecord;
    interpretationMode: ReturnType<typeof inferResponseInterpretationMode>;
  }>,
): CandidateAvailabilitySummary {
  const { candidate } = candidateSlice;
  const participantStatuses = responseModes.map(({ response, interpretationMode }) =>
    buildRankedParticipantStatus(response, candidateSlice, detail.candidates, interpretationMode),
  );
  const {
    statusGroups,
    yesCount,
    maybeCount,
    noCount,
    availableCount,
    conditionalCount,
    unknownCount,
    unavailableCount,
    baseScore,
  } = summarizeRankedParticipantStatuses(participantStatuses);
  const commentImpacts = responseModes.flatMap(({ response }) =>
    getScoredCommentConstraints(response.parsedConstraints ?? [])
      .filter((constraint) => doesConstraintMatchCandidate(constraint, candidate))
      .map((constraint) => ({
        participantName: response.participantName,
        label: formatParsedConstraintLabel(constraint),
        reasonText: constraint.reasonText,
        score: COMMENT_SCORE_MAP[constraint.level],
        level: constraint.level,
      })),
  );
  const commentScore = commentImpacts.reduce((sum, impact) => sum + impact.score, 0);
  const hardNoConstraintCount = detail.responses.filter((response) =>
    hasHardNoConstraintForCandidate(getScoredCommentConstraints(response.parsedConstraints ?? []), candidate),
  ).length;

  return {
    candidate,
    statusGroups,
    participantStatuses,
    baseScore,
    commentScore,
    commentImpacts,
    hasHardNoConstraint: hardNoConstraintCount > 0,
    yesCount,
    maybeCount,
    noCount,
    availableCount,
    conditionalCount,
    unknownCount,
    unavailableCount,
  };
}

function summarizeRankedParticipantStatuses(statuses: RankedParticipantStatus[]) {
  const statusGroups = Object.fromEntries(AVAILABILITY_LEVELS.map((level) => [level.key, [] as string[]])) as Record<string, string[]>;

  for (const status of statuses) {
    statusGroups[status.availabilityKey].push(status.participantName);
  }

  const yesCount = statuses.filter((status) => status.availabilityKey === "yes").length;
  const maybeCount = statuses.filter((status) => status.availabilityKey === "maybe").length;
  const noCount = statuses.filter((status) => status.availabilityKey === "no").length;
  const availableCount = statuses.filter((status) => getRankedLabelWeightKey(status) === "available").length;
  const conditionalCount = statuses.filter((status) => getRankedLabelWeightKey(status) === "conditional_available").length;
  const unknownCount = statuses.filter((status) => getRankedLabelWeightKey(status) === "unknown").length;
  const unavailableCount = statuses.filter((status) => {
    const rankedLabelWeightKey = getRankedLabelWeightKey(status);
    return (
      rankedLabelWeightKey === "condition_blocked" ||
      rankedLabelWeightKey === "unavailable" ||
      rankedLabelWeightKey === "strongly_unavailable"
    );
  }).length;
  const baseScore = statuses.reduce((sum, status) => sum + getRankedLabelWeight(status), 0);

  return {
    statusGroups,
    yesCount,
    maybeCount,
    noCount,
    availableCount,
    conditionalCount,
    unknownCount,
    unavailableCount,
    baseScore,
  };
}

function buildBaselineCandidateMetrics(summary: CandidateAvailabilitySummary): CandidateRankingMetrics {
  const baselineMetrics = buildCandidateStatusMetrics(summary.participantStatuses, summary.hasHardNoConstraint);

  return {
    ...baselineMetrics,
    wishCount: 0,
    strongWishCount: 0,
    plainPreferenceScoreDelta: 0,
    comparisonPreferenceScoreDelta: 0,
    preferenceScoreDelta: 0,
    pendingConditionWishCount: 0,
    pendingConditionStrongWishCount: 0,
    pendingConditionPreferenceScoreDelta: 0,
    projectedHardNoCount: baselineMetrics.hardNoCount,
    projectedNegativeCount: baselineMetrics.negativeCount,
    projectedBlockedCount: baselineMetrics.blockedCount,
    projectedStrongConditionalCount: baselineMetrics.strongConditionalCount,
    projectedLightConditionalCount: baselineMetrics.lightConditionalCount,
    projectedUnknownCount: baselineMetrics.unknownCount,
    projectedOkCount: baselineMetrics.okCount,
    projectedStrongOkCount: baselineMetrics.strongOkCount,
    projectedWishCount: 0,
    projectedStrongWishCount: 0,
    projectedPreferenceScoreDelta: 0,
  };
}

function buildRankedCandidatesWithMetrics(detail: EventDetail) {
  const orderedCandidates = buildResultCandidateSlices(detail);
  const responseModes = detail.responses.map((response) => ({
    response,
    interpretationMode: inferResponseInterpretationMode(response, detail.candidates),
  }));
  const summaries = orderedCandidates.map((candidateSlice) =>
    buildCandidateAvailabilitySummary(detail, candidateSlice, responseModes),
  );
  const baselineMetricsByCandidateId = new Map<string, CandidateRankingMetrics>(
    summaries.map((summary) => [summary.candidate.id, buildBaselineCandidateMetrics(summary)]),
  );
  const baselineRanked = summaries.map((summary) => ({
    candidate: summary.candidate,
    baseScore: summary.baseScore,
    commentScore: summary.commentScore,
    totalScore: summary.baseScore,
    plainPreferenceScoreDelta: 0,
    comparisonPreferenceScoreDelta: 0,
    preferenceScoreDelta: 0,
    pendingConditionPreferenceScoreDelta: 0,
    availableCount: summary.availableCount,
    conditionalCount: summary.conditionalCount,
    unknownCount: summary.unknownCount,
    unavailableCount: summary.unavailableCount,
    yesCount: summary.yesCount,
    maybeCount: summary.maybeCount,
    noCount: summary.noCount,
    statusGroups: summary.statusGroups,
    participantStatuses: summary.participantStatuses,
    commentImpacts: summary.commentImpacts,
    preferenceExplanations: [],
    conditionExplanations: [],
    hasHardNoConstraint: summary.hasHardNoConstraint,
  } satisfies RankedCandidate));
  const baselinePerfectNowRanking = baselineRanked
    .filter((candidate) => isPerfectNowCandidate(baselineMetricsByCandidateId.get(candidate.candidate.id)!))
    .sort((left, right) => compareImmediateUnanimousCandidates(left, right, baselineMetricsByCandidateId));
  const baselineBestAttendanceRanking = [...baselineRanked].sort((left, right) =>
    compareCompromiseCandidates(left, right, baselineMetricsByCandidateId, true),
  );

  const metricsByCandidateId = new Map<string, CandidateRankingMetrics>();
  const ranked = summaries.map((summary) => {
    const { candidate, participantStatuses } = summary;
    const matchedPreferenceDataByParticipant = responseModes.map(({ response }) => {
      const parsedLevels = getMatchedPreferenceLevels(response, candidate);
      const autoPreferences = getMatchedAutoInterpretationPreferences(response, candidate);
      const matchedConditions = getMatchedAutoInterpretationConditions(response, candidate);
      const conditionStates = matchedConditions.map((condition) => ({
        condition,
        resolution: resolveConditionAgainstParticipantStatuses(
          condition,
          response.id,
          candidate,
          participantStatuses,
          baselinePerfectNowRanking,
          baselineBestAttendanceRanking,
          baselineMetricsByCandidateId,
        ),
      }));
      const baseStatus = participantStatuses.find((status) => status.responseId === response.id) ?? null;
      const currentStatus = baseStatus
        ? applyAvailabilityConditionStateToStatus(baseStatus, conditionStates, "current")
        : null;
      const projectedStatus = baseStatus
        ? applyAvailabilityConditionStateToStatus(baseStatus, conditionStates, "projected")
        : null;

      return {
        response,
        parsedLevels,
        autoPreferences,
        matchedConditions,
        conditionStates,
        currentStatus,
        projectedStatus,
      };
    });
    const currentParticipantStatuses = matchedPreferenceDataByParticipant.flatMap(({ currentStatus }) =>
      currentStatus ? [currentStatus] : [],
    );
    const projectedParticipantStatuses = matchedPreferenceDataByParticipant.flatMap(({ projectedStatus }) =>
      projectedStatus ? [projectedStatus] : [],
    );
    const currentStatusSummary = summarizeRankedParticipantStatuses(currentParticipantStatuses);
    const currentStatusMetrics = buildCandidateStatusMetrics(currentParticipantStatuses, summary.hasHardNoConstraint);
    const projectedStatusMetrics = buildCandidateStatusMetrics(projectedParticipantStatuses, summary.hasHardNoConstraint);

    const matchedConditionExplanations: RankingConditionExplanation[] = [];
    const activeAutoPreferences: MatchedAutoInterpretationPreference[] = [];
    const pendingAutoPreferences: MatchedAutoInterpretationPreference[] = [];

    for (const { response, autoPreferences, conditionStates } of matchedPreferenceDataByParticipant) {
      for (const conditionState of conditionStates) {
        matchedConditionExplanations.push(
          toConditionExplanation(response, conditionState.condition, conditionState.resolution),
        );
      }

      for (const preference of autoPreferences) {
        const relatedConditionStates = conditionStates.filter(({ condition }) =>
          condition.sourcePreferenceTargetTokenIndexes
            ? areMatchingTokenIndexes(condition.sourcePreferenceTargetTokenIndexes, preference.targetTokenIndexes)
            : areMatchingTokenIndexes(condition.targetTokenIndexes, preference.targetTokenIndexes),
        );

        if (relatedConditionStates.length === 0) {
          activeAutoPreferences.push({
            responseId: response.id,
            participantName: response.participantName,
            preference,
            delta: getAutoInterpretationPreferenceDelta(preference),
          });
          continue;
        }

        const resolutions = relatedConditionStates.map(({ resolution }) => resolution);

        if (resolutions.includes("resolved_false")) {
          continue;
        }

        const strongestResolvedPreferenceLevel = pickStrongestResolvedPreferenceLevel(
          relatedConditionStates.map(({ condition }) => condition.resolvedPreferenceLevel),
        );

        if (!strongestResolvedPreferenceLevel) {
          continue;
        }

        const matchedPreference = {
          responseId: response.id,
          participantName: response.participantName,
          preference,
          delta: getResolvedPreferenceDelta(preference, strongestResolvedPreferenceLevel),
        } satisfies MatchedAutoInterpretationPreference;

        if (resolutions.every((resolution) => resolution === "resolved_true")) {
          activeAutoPreferences.push(matchedPreference);
        } else {
          pendingAutoPreferences.push(matchedPreference);
        }
      }
    }

    const wishCount = matchedPreferenceDataByParticipant.filter(({ parsedLevels, response }) => {
      const hasActivePreference = activeAutoPreferences.some(
        (matchedPreference) =>
          matchedPreference.responseId === response.id &&
          matchedPreference.delta > 0,
      );

      return parsedLevels.length > 0 || hasActivePreference;
    }).length;

    const strongWishCount = matchedPreferenceDataByParticipant.filter(({ parsedLevels, response }) => {
      const hasActiveStrongPreference = activeAutoPreferences.some(
        (matchedPreference) =>
          matchedPreference.responseId === response.id &&
          matchedPreference.delta >= EMOTION_LABEL_SCORES.strong_desire,
      );

      return parsedLevels.includes("soft_yes") || parsedLevels.includes("strong_yes") || hasActiveStrongPreference;
    }).length;

    const pendingConditionWishCount = pendingAutoPreferences.filter(
      (matchedPreference) => matchedPreference.delta > 0,
    ).length;
    const pendingConditionStrongWishCount = pendingAutoPreferences.filter(
      (matchedPreference) => matchedPreference.delta >= EMOTION_LABEL_SCORES.strong_desire,
    ).length;
    const matchedComparisonPreferenceSignals = responseModes.flatMap(({ response }) =>
      getMatchedComparisonPreferenceSignals(response, candidate).map((signal) => ({
        responseId: response.id,
        participantName: response.participantName,
        signal,
        delta: getComparisonPreferenceSignalDelta(signal),
      })),
    );
    const plainPreferenceScoreDelta = activeAutoPreferences.reduce(
      (sum, matchedPreference) => sum + matchedPreference.delta,
      0,
    );
    const pendingConditionPreferenceScoreDelta = pendingAutoPreferences.reduce(
      (sum, matchedPreference) => sum + matchedPreference.delta,
      0,
    );
    const comparisonPreferenceScoreDelta = matchedComparisonPreferenceSignals.reduce(
      (sum, matchedSignal) => sum + matchedSignal.delta,
      0,
    );
    const preferenceScoreDelta = plainPreferenceScoreDelta + comparisonPreferenceScoreDelta;
    const preferenceExplanations = buildPreferenceExplanations(matchedComparisonPreferenceSignals);
    const metrics: CandidateRankingMetrics = {
      ...currentStatusMetrics,
      wishCount,
      strongWishCount,
      plainPreferenceScoreDelta,
      comparisonPreferenceScoreDelta,
      preferenceScoreDelta,
      pendingConditionWishCount,
      pendingConditionStrongWishCount,
      pendingConditionPreferenceScoreDelta,
      projectedHardNoCount: projectedStatusMetrics.hardNoCount,
      projectedNegativeCount: projectedStatusMetrics.negativeCount,
      projectedBlockedCount: projectedStatusMetrics.blockedCount,
      projectedStrongConditionalCount: 0,
      projectedLightConditionalCount: 0,
      projectedUnknownCount: 0,
      projectedOkCount:
        projectedStatusMetrics.okCount +
        projectedStatusMetrics.strongConditionalCount +
        projectedStatusMetrics.lightConditionalCount +
        projectedStatusMetrics.unknownCount,
      projectedStrongOkCount: projectedStatusMetrics.strongOkCount,
      projectedWishCount: wishCount + pendingConditionWishCount,
      projectedStrongWishCount: strongWishCount + pendingConditionStrongWishCount,
      projectedPreferenceScoreDelta: preferenceScoreDelta + pendingConditionPreferenceScoreDelta,
    };
    metricsByCandidateId.set(candidate.id, metrics);
    const totalScore = currentStatusSummary.baseScore + preferenceScoreDelta;

    return {
      candidate,
      baseScore: currentStatusSummary.baseScore,
      commentScore: summary.commentScore,
      totalScore,
      plainPreferenceScoreDelta,
      comparisonPreferenceScoreDelta,
      preferenceScoreDelta,
      pendingConditionPreferenceScoreDelta,
      availableCount: currentStatusSummary.availableCount,
      conditionalCount: currentStatusSummary.conditionalCount,
      unknownCount: currentStatusSummary.unknownCount,
      unavailableCount: currentStatusSummary.unavailableCount,
      yesCount: currentStatusSummary.yesCount,
      maybeCount: currentStatusSummary.maybeCount,
      noCount: currentStatusSummary.noCount,
      statusGroups: currentStatusSummary.statusGroups,
      participantStatuses: currentParticipantStatuses,
      commentImpacts: summary.commentImpacts,
      preferenceExplanations,
      conditionExplanations: matchedConditionExplanations,
      hasHardNoConstraint: summary.hasHardNoConstraint,
    } satisfies RankedCandidate;
  });

  return { ranked, metricsByCandidateId };
}

export function rankCandidates(detail: EventDetail, mode: ResultMode): RankedCandidate[] {
  const { ranked, metricsByCandidateId } = buildRankedCandidatesWithMetrics(detail);

  const unanimousNow = ranked
    .filter((candidate) => isUnanimousCandidate(metricsByCandidateId.get(candidate.candidate.id)!))
    .sort((left, right) => compareImmediateUnanimousCandidates(left, right, metricsByCandidateId));

  if (mode === "strict_all") {
    return unanimousNow;
  }

  const remainingAfterUnanimous = ranked.filter(
    (candidate) => !unanimousNow.some((selected) => selected.candidate.id === candidate.candidate.id),
  );

  if (unanimousNow.length > 0) {
    const bestNow = unanimousNow[0]!;
    const conditionalBestIfResolved = remainingAfterUnanimous
      .filter((candidate) => {
        const metrics = metricsByCandidateId.get(candidate.candidate.id)!;
        return isPotentialUnanimousCandidate(metrics) && canBeatReferenceIfResolved(candidate, bestNow, metricsByCandidateId);
      })
      .sort((left, right) => compareProjectedResolvedCandidates(left, right, metricsByCandidateId));

    const conditionalBestIds = new Set(conditionalBestIfResolved.map((candidate) => candidate.candidate.id));
    const rest = remainingAfterUnanimous
      .filter((candidate) => !conditionalBestIds.has(candidate.candidate.id))
      .sort((left, right) => compareCompromiseCandidates(left, right, metricsByCandidateId, true));

    return [...unanimousNow, ...conditionalBestIfResolved, ...rest];
  }

  const immediatelyDecidable = ranked.filter((candidate) =>
    isImmediatelyDecidableCandidate(metricsByCandidateId.get(candidate.candidate.id)!),
  );
  const compromiseSource = immediatelyDecidable.length > 0 ? immediatelyDecidable : ranked;
  const minimalHardNoCount = compromiseSource.reduce((minimum, candidate) => {
    const metrics = metricsByCandidateId.get(candidate.candidate.id)!;
    return Math.min(minimum, metrics.hardNoCount);
  }, Number.POSITIVE_INFINITY);
  const bestNowCandidates = compromiseSource
    .filter((candidate) => metricsByCandidateId.get(candidate.candidate.id)!.hardNoCount === minimalHardNoCount)
    .sort((left, right) => compareCompromiseCandidates(left, right, metricsByCandidateId, immediatelyDecidable.length === 0));
  const bestNow = bestNowCandidates[0] ?? null;

  if (!bestNow) {
    return [];
  }

  const bestNowIds = new Set(bestNowCandidates.map((candidate) => candidate.candidate.id));
  const conditionalBestIfResolved = ranked
    .filter((candidate) => {
      if (bestNowIds.has(candidate.candidate.id)) {
        return false;
      }

      const metrics = metricsByCandidateId.get(candidate.candidate.id)!;
      return isPotentialUnanimousCandidate(metrics) && canBeatReferenceIfResolved(candidate, bestNow, metricsByCandidateId);
    })
    .sort((left, right) => compareProjectedResolvedCandidates(left, right, metricsByCandidateId));
  const conditionalBestIds = new Set(conditionalBestIfResolved.map((candidate) => candidate.candidate.id));
  const rest = ranked
    .filter((candidate) => !bestNowIds.has(candidate.candidate.id) && !conditionalBestIds.has(candidate.candidate.id))
    .sort((left, right) => compareCompromiseCandidates(left, right, metricsByCandidateId, true));

  return [...bestNowCandidates, ...conditionalBestIfResolved, ...rest];
}

export function buildRankedCandidateCollections(detail: EventDetail): RankedCandidateCollections {
  const { ranked, metricsByCandidateId } = buildRankedCandidatesWithMetrics(detail);

  const perfectNowRanking = ranked
    .filter((candidate) => isPerfectNowCandidate(metricsByCandidateId.get(candidate.candidate.id)!))
    .sort((left, right) => compareImmediateUnanimousCandidates(left, right, metricsByCandidateId));

  const perfectIfResolvedRanking = ranked
    .filter((candidate) => isPerfectIfResolvedCandidate(metricsByCandidateId.get(candidate.candidate.id)!))
    .sort((left, right) => compareProjectedResolvedCandidates(left, right, metricsByCandidateId));

  const bestAttendanceRanking = [...ranked].sort((left, right) =>
    compareCompromiseCandidates(left, right, metricsByCandidateId, true),
  );

  const emotionPriorityRanking = [...ranked].sort((left, right) => {
    if (left.plainPreferenceScoreDelta !== right.plainPreferenceScoreDelta) {
      return right.plainPreferenceScoreDelta - left.plainPreferenceScoreDelta;
    }

    if (left.comparisonPreferenceScoreDelta !== right.comparisonPreferenceScoreDelta) {
      return right.comparisonPreferenceScoreDelta - left.comparisonPreferenceScoreDelta;
    }

    const leftDate = getCandidateSortDate(left.candidate);
    const rightDate = getCandidateSortDate(right.candidate);

    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    return left.candidate.sortOrder - right.candidate.sortOrder;
  });

  return {
    perfectNowRanking,
    perfectIfResolvedRanking,
    bestAttendanceRanking,
    emotionPriorityRanking,
  };
}

export function buildAdjustmentSuggestions(candidates: RankedCandidate[]): AdjustmentSuggestion[] {
  return candidates
    .filter((candidate) => candidate.participantStatuses.length > 0)
    .map((candidate) => {
      const maybeNames = candidate.statusGroups.maybe;
      const noNames = candidate.statusGroups.no;

      if (noNames.length === 1) {
        return {
          candidateId: candidate.candidate.id,
          title: `${formatCandidateLabel(candidate.candidate)} はあと一歩`,
          body: `${noNames[0]}さんの都合が動くと、この候補は一気に有力になります。微妙メンバーが少ないので調整効果が大きい日です。`,
        };
      }

      if (noNames.length === 0 && maybeNames.length > 0) {
        return {
          candidateId: candidate.candidate.id,
          title: `${formatCandidateLabel(candidate.candidate)} は確度を上げやすい候補`,
          body: `${maybeNames.join("、")}さんの「微妙」を解消できると、全員参加の本命として押しやすくなります。`,
        };
      }

      return null;
    })
    .filter((suggestion): suggestion is AdjustmentSuggestion => Boolean(suggestion))
    .slice(0, 3);
}
