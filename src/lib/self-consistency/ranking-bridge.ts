import { buildDerivedResponseFromAutoInterpretationResult } from "@/lib/availability-comment-interpretation";
import type {
  AutoInterpretationComparisonPreferenceSignal,
  AutoInterpretationComparisonPreferenceSignalConfidence,
  AutoInterpretationComparisonPreferenceSignalStrength,
  AutoInterpretationCondition,
  AutoInterpretationConditionResolvedAvailabilityLevel,
  AutoInterpretationConditionResolvedPreferenceLevel,
  AutoInterpretationPreference,
  AutoInterpretationResolvedCandidateStatus,
  AutoInterpretationResult,
  EventCandidateRecord,
  ParticipantAnswerRecord,
  ParsedCommentConstraint,
} from "@/lib/domain";
import { formatDate, getCandidateDateValues, getTimeSlotByKey, normalizeCandidate } from "@/lib/utils";
import type {
  FinalEvaluation,
  FinalInterpretationJson,
  InterpretationPreference,
  NormalizedScope,
  NormalizedScopeMember,
  SelfConsistencyDebugBundle,
  SelfConsistencyInterpretationResult,
} from "./types";

type RankingBridgeArtifacts = {
  answers: ParticipantAnswerRecord[];
  parsedConstraints: ParsedCommentConstraint[];
  autoInterpretation: AutoInterpretationResult;
};

type CandidateMatch = {
  key: string;
  candidateId: string;
  dateValue: string;
  timeSlotKey: string | null;
  targetTimeSlotKey: string | null;
  targetText: string;
  targetTokenIndexes: number[];
  targetLabels: string[];
  targetNormalizedTexts: string[];
};

const NEGATIVE_PREFERENCES = new Set<InterpretationPreference>(["少し避けたい", "避けたい", "かなり避けたい"]);

function normalizeLooseText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/gu, "").trim();
}

function formatScopeTargetText(dateValue: string, timeSlotKey: string | null) {
  if (!timeSlotKey) {
    return formatDate(dateValue);
  }

  return `${formatDate(dateValue)} ${getTimeSlotByKey(timeSlotKey).label}`;
}

function getWeekdayValue(dateValue: string) {
  const weekday = new Date(`${dateValue}T00:00:00`).getDay();

  return weekday === 0
    ? "sunday"
    : weekday === 1
      ? "monday"
      : weekday === 2
        ? "tuesday"
        : weekday === 3
          ? "wednesday"
          : weekday === 4
            ? "thursday"
            : weekday === 5
              ? "friday"
              : "saturday";
}

function getWeekStart(dateValue: string) {
  const value = new Date(`${dateValue}T00:00:00`);
  const diff = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - diff);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRelativeWeekStart(offsetWeeks: number) {
  const now = new Date();
  const weekStart = new Date(now);
  const diff = (weekStart.getDay() + 6) % 7;
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - diff + offsetWeeks * 7);
  const year = weekStart.getFullYear();
  const month = String(weekStart.getMonth() + 1).padStart(2, "0");
  const day = String(weekStart.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekOrdinal(dateValue: string) {
  return Math.floor((Number(dateValue.slice(8, 10)) - 1) / 7) + 1;
}

function mapTimeValueToSlotKey(value: string): "all_day" | "morning" | "day" | "night" | null {
  switch (value) {
    case "morning":
      return "morning";
    case "noon":
    case "afternoon":
      return "day";
    case "evening":
    case "night":
    case "late_night":
    case "until_last_train":
      return "night";
    case "all_day":
    case "overnight":
      return "all_day";
    default:
      return null;
  }
}

function mapSlotKeyToPreferenceTimeValue(timeSlotKey: string | null) {
  switch (timeSlotKey) {
    case "morning":
      return "morning";
    case "day":
      return "afternoon";
    case "night":
      return "night";
    case "all_day":
      return "all_day";
    default:
      return null;
  }
}

function matchesMonthPart(dateValue: string, value: string) {
  const day = Number(dateValue.slice(8, 10));

  switch (value) {
    case "first_half":
      return day <= 15;
    case "second_half":
      return day >= 16;
    case "early_month":
      return day <= 10;
    case "mid_month":
      return day >= 11 && day <= 20;
    case "late_month":
      return day >= 21;
    case "month_start":
      return day <= 5;
    case "month_end":
      return day >= 25;
    default:
      return false;
  }
}

function matchesRelativePeriod(dateValue: string, value: string) {
  const candidateDate = new Date(`${dateValue}T00:00:00`);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  switch (value) {
    case "this_week":
      return getWeekStart(dateValue) === getRelativeWeekStart(0);
    case "next_week":
      return getWeekStart(dateValue) === getRelativeWeekStart(1);
    case "week_after_next":
      return getWeekStart(dateValue) === getRelativeWeekStart(2);
    case "this_month":
      return candidateDate.getFullYear() === currentYear && candidateDate.getMonth() === currentMonth;
    case "next_month": {
      const nextMonthDate = new Date(now);
      nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
      return (
        candidateDate.getFullYear() === nextMonthDate.getFullYear() &&
        candidateDate.getMonth() === nextMonthDate.getMonth()
      );
    }
    default:
      return false;
  }
}

function matchesDateMember(member: NormalizedScopeMember, dateValue: string) {
  switch (member.kind) {
    case "補助":
      return member.value === "all_dates";
    case "日付":
      if (/^\d{4}-\d{2}-\d{2}$/u.test(member.value)) {
        return member.value === dateValue;
      }

      if (/^\d{1,2}$/u.test(member.value)) {
        return Number(member.value) === Number(dateValue.slice(8, 10));
      }

      return normalizeLooseText(member.sourceText) === normalizeLooseText(formatDate(dateValue));
    case "日付範囲": {
      const rangeMatch = member.value.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/u);

      if (rangeMatch) {
        return dateValue >= rangeMatch[1]! && dateValue <= rangeMatch[2]!;
      }

      const dayRangeMatch = member.value.match(/^(\d{1,2})\.\.(\d{1,2})$/u);

      if (dayRangeMatch) {
        const day = Number(dateValue.slice(8, 10));
        return day >= Number(dayRangeMatch[1]) && day <= Number(dayRangeMatch[2]);
      }

      return false;
    }
    case "曜日":
      return getWeekdayValue(dateValue) === member.value;
    case "曜日群":
      if (member.value === "weekday") {
        const weekday = getWeekdayValue(dateValue);
        return weekday !== "saturday" && weekday !== "sunday";
      }

      if (member.value === "weekend" || member.value === "weekend_pair") {
        const weekday = getWeekdayValue(dateValue);
        return weekday === "saturday" || weekday === "sunday";
      }

      return false;
    case "期間":
      if (member.value.startsWith("week_")) {
        return getWeekOrdinal(dateValue) === Number(member.value.slice(5));
      }

      if (member.value.startsWith("this_") || member.value === "next_week" || member.value === "week_after_next" || member.value === "next_month") {
        return matchesRelativePeriod(dateValue, member.value);
      }

      return matchesMonthPart(dateValue, member.value);
    default:
      return false;
  }
}

function resolveTimeSlotKeysForScope(scope: NormalizedScope) {
  const explicitValues = [...new Set(scope.timeMembers.map((member) => member.value))].filter(
    (value) => value !== "all_times",
  );

  if (explicitValues.length === 0 || explicitValues.every((value) => value === "all_day")) {
    return [null];
  }

  const slotKeys = explicitValues
    .map((value) => mapTimeValueToSlotKey(value))
    .filter((value): value is NonNullable<ReturnType<typeof mapTimeValueToSlotKey>> => value !== null);

  return slotKeys.length > 0 ? [...new Set(slotKeys)] : [null];
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

function getMatchTargetLabels(timeSlotKey: string | null) {
  return timeSlotKey ? ["target_date", "target_time_of_day"] : ["target_date"];
}

function getMatchTargetNormalizedTexts(dateValue: string, timeSlotKey: string | null) {
  const timeValue = mapSlotKeyToPreferenceTimeValue(timeSlotKey);
  return timeValue ? [dateValue, timeValue] : [dateValue];
}

function buildMatchKey(candidateId: string, dateValue: string, timeSlotKey: string | null) {
  return `${candidateId}::${dateValue}::${timeSlotKey ?? "any"}`;
}

function createSyntheticTokenIndexer() {
  const allocated = new Map<string, number>();
  let nextIndex = 0;

  return (key: string) => {
    const existing = allocated.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const value = nextIndex;
    nextIndex += 1;
    allocated.set(key, value);
    return value;
  };
}

function matchScopeToCandidates(
  scope: NormalizedScope,
  candidates: EventCandidateRecord[],
  allocateTokenIndex: (key: string) => number,
) {
  const matches: CandidateMatch[] = [];
  const seen = new Set<string>();
  const timeSlotKeys = resolveTimeSlotKeysForScope(scope);

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeCandidate(candidate);
    const candidateDateValues = getCandidateDateValues(normalizedCandidate);

    for (const dateValue of candidateDateValues) {
      const dateMatched =
        scope.dateMembers.length === 0 || scope.dateMembers.some((member) => matchesDateMember(member, dateValue));

      if (!dateMatched) {
        continue;
      }

      for (const requestedTimeSlotKey of timeSlotKeys) {
        let resolvedTimeSlotKey: string | null = null;

        if (!requestedTimeSlotKey) {
          resolvedTimeSlotKey = null;
        } else if (normalizedCandidate.timeType === "unspecified") {
          resolvedTimeSlotKey = requestedTimeSlotKey === "all_day" ? null : requestedTimeSlotKey;
        } else if (normalizedCandidate.timeSlotKey === "all_day") {
          resolvedTimeSlotKey = null;
        } else if (normalizedCandidate.timeSlotKey === requestedTimeSlotKey) {
          resolvedTimeSlotKey = normalizedCandidate.timeSlotKey;
        } else {
          continue;
        }

        const key = buildMatchKey(normalizedCandidate.id, dateValue, resolvedTimeSlotKey);

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        const targetTimeSlotKey = requestedTimeSlotKey ?? resolvedTimeSlotKey;

        matches.push({
          key,
          candidateId: normalizedCandidate.id,
          dateValue,
          timeSlotKey: resolvedTimeSlotKey,
          targetTimeSlotKey,
          targetText: formatScopeTargetText(dateValue, targetTimeSlotKey),
          targetTokenIndexes: [allocateTokenIndex(key)],
          targetLabels: getMatchTargetLabels(targetTimeSlotKey),
          targetNormalizedTexts: getMatchTargetNormalizedTexts(dateValue, targetTimeSlotKey),
        });
      }
    }
  }

  return matches;
}

function mapEvaluationToConstraintLevel(evaluation: FinalEvaluation): AutoInterpretationResolvedCandidateStatus["level"] {
  if (evaluation.reviewStatus === "mixed") {
    return "unknown";
  }

  if (evaluation.availability === "行けない") {
    return evaluation.availabilityConfidence >= 0.8 ? "hard_no" : "soft_no";
  }

  if (evaluation.availability === "条件付きで行ける") {
    return "conditional";
  }

  return evaluation.availabilityConfidence >= 0.8 ? "strong_yes" : "soft_yes";
}

function mapPreferenceToAutoLevel(
  representative: InterpretationPreference | null | undefined,
): AutoInterpretationPreference["level"] | null {
  if (!representative || representative === "中立") {
    return null;
  }

  if (NEGATIVE_PREFERENCES.has(representative)) {
    return "avoid";
  }

  return representative === "かなり行きたい" ? "strong_preferred" : "preferred";
}

function mapPreferenceToResolvedLevel(
  representative: InterpretationPreference | null | undefined,
): AutoInterpretationConditionResolvedPreferenceLevel | null {
  if (!representative) {
    return null;
  }

  if (representative === "かなり行きたい") {
    return "strong_preferred";
  }

  if (representative === "行きたい") {
    return "preferred";
  }

  if (representative === "少し行きたい") {
    return "weak_accept";
  }

  return null;
}

function mapEvaluationToResolvedAvailabilityLevel(
  evaluation: FinalEvaluation,
): AutoInterpretationConditionResolvedAvailabilityLevel | null {
  if (evaluation.availability === "行けない") {
    return null;
  }

  if (evaluation.availability === "条件付きで行ける") {
    return "conditional";
  }

  return evaluation.availabilityConfidence >= 0.8 ? "strong_yes" : "soft_yes";
}

function mapReviewStatusToSignalConfidence(
  reviewStatus: "base_only" | "stable" | "mixed",
  score: number,
): AutoInterpretationComparisonPreferenceSignalConfidence | null {
  if (reviewStatus === "mixed") {
    return null;
  }

  if (reviewStatus === "stable" && score >= 0.8) {
    return "high";
  }

  if (score >= 0.6) {
    return "medium";
  }

  return null;
}

function mapComparisonPreferenceToStrength(
  representative: InterpretationPreference,
): AutoInterpretationComparisonPreferenceSignalStrength {
  return representative === "かなり行きたい" || representative === "行きたい" ? "strong" : "weak";
}

function buildSyntheticCondition(
  evaluation: FinalEvaluation,
  match: CandidateMatch,
): AutoInterpretationCondition | null {
  if (evaluation.externalConditionTexts.length === 0) {
    return null;
  }

  const resolvedAvailabilityLevel = mapEvaluationToResolvedAvailabilityLevel(evaluation);

  if (!resolvedAvailabilityLevel) {
    return null;
  }

  const resolvedPreferenceLevel = mapPreferenceToResolvedLevel(evaluation.preference?.representative);

  return {
    targetTokenIndexes: match.targetTokenIndexes,
    targetText: match.targetText,
    targetLabels: match.targetLabels,
    targetNormalizedTexts: match.targetNormalizedTexts,
    conditionTokenIndexes: [],
    markerTokenIndexes: [],
    supportingClauseIndexes: [],
    kind: "self_condition",
    resolverType: "self_convenience",
    participantScope: "self_only",
    requiredAvailabilityLevels: [],
    unresolvedBehavior: "blocked",
    resolvedAvailabilityLevel,
    resolvedPreferenceLevel,
    threshold: null,
    ...(resolvedPreferenceLevel ? { sourcePreferenceTargetTokenIndexes: match.targetTokenIndexes } : {}),
    sourceComment: evaluation.externalConditionTexts.join(" / "),
    confidence: evaluation.availabilityConfidence >= 0.8 ? "high" : "medium",
  };
}

function buildAvailabilityArtifacts(
  interpretation: FinalInterpretationJson,
  candidates: EventCandidateRecord[],
  allocateTokenIndex: (key: string) => number,
) {
  const resolvedCandidateStatuses: AutoInterpretationResolvedCandidateStatus[] = [];
  const preferences: AutoInterpretationPreference[] = [];
  const conditions: AutoInterpretationCondition[] = [];
  const seenStatuses = new Set<string>();
  const seenPreferences = new Set<string>();
  const seenConditions = new Set<string>();

  for (const evaluation of interpretation.evaluations) {
    const matches = matchScopeToCandidates(evaluation.scope, candidates, allocateTokenIndex);
    const availabilityLevel = mapEvaluationToConstraintLevel(evaluation);
    const preferenceLevel = mapPreferenceToAutoLevel(evaluation.preference?.representative);

    for (const match of matches) {
      const statusKey = JSON.stringify({
        candidateId: match.candidateId,
        dateValue: match.dateValue,
        timeSlotKey: match.timeSlotKey,
        level: availabilityLevel,
      });

      if (!seenStatuses.has(statusKey)) {
        seenStatuses.add(statusKey);
        resolvedCandidateStatuses.push({
          candidateId: match.candidateId,
          dateValue: match.dateValue,
          timeSlotKey: match.timeSlotKey,
          level: availabilityLevel,
          detailLabel: `${match.targetText} → ${availabilityLevel}`,
        });
      }

      if (preferenceLevel) {
        const preferenceKey = JSON.stringify({
          candidateId: match.candidateId,
          dateValue: match.dateValue,
          level: preferenceLevel,
        });

        if (!seenPreferences.has(preferenceKey)) {
          seenPreferences.add(preferenceKey);
          preferences.push({
            targetTokenIndexes: match.targetTokenIndexes,
            targetText: match.targetText,
            targetLabels: match.targetLabels,
            targetNormalizedTexts: match.targetNormalizedTexts,
            markerTokenIndexes: [],
            markerTexts: evaluation.preference ? [evaluation.preference.representative] : [],
            markerLabels: [],
            level: preferenceLevel,
            notes: [],
            sourceComment: interpretation.sourceText,
          });
        }
      }

      const condition = buildSyntheticCondition(evaluation, match);

      if (condition) {
        const conditionKey = JSON.stringify({
          candidateId: match.candidateId,
          dateValue: match.dateValue,
          timeSlotKey: match.timeSlotKey,
          sourceComment: condition.sourceComment,
        });

        if (!seenConditions.has(conditionKey)) {
          seenConditions.add(conditionKey);
          conditions.push(condition);
        }
      }
    }
  }

  return {
    resolvedCandidateStatuses,
    preferences,
    conditions,
  };
}

function buildComparisonSignals(
  interpretation: FinalInterpretationJson,
  candidates: EventCandidateRecord[],
  allocateTokenIndex: (key: string) => number,
) {
  const signals: AutoInterpretationComparisonPreferenceSignal[] = [];
  const seen = new Set<string>();

  interpretation.comparisons.forEach((comparison, index) => {
    const confidence = mapReviewStatusToSignalConfidence(comparison.reviewStatus, comparison.directionConfidence);

    if (!confidence) {
      return;
    }

    const preferredScopes = comparison.candidateScopes.filter((scope) =>
      matchesPreferredScopeText(scope, comparison.preferredScopeText),
    );
    const preferredScope = preferredScopes[0] ?? null;

    if (!preferredScope) {
      return;
    }

    const preferredMatches = matchScopeToCandidates(preferredScope, candidates, allocateTokenIndex);

    if (preferredMatches.length === 0) {
      return;
    }

    const dispreferredMatches = comparison.candidateScopes
      .filter((scope) => !matchesPreferredScopeText(scope, comparison.preferredScopeText))
      .flatMap((scope) => matchScopeToCandidates(scope, candidates, allocateTokenIndex));
    const strength = mapComparisonPreferenceToStrength(comparison.preference.representative);

    for (const match of preferredMatches) {
      const targetType = match.timeSlotKey ? "date_time" : "date";
      const targetValue = match.timeSlotKey ? `${match.dateValue}_${match.timeSlotKey}` : match.dateValue;
      const key = `preferred::${match.key}`;

      if (!seen.has(key)) {
        seen.add(key);
        signals.push({
          targetGroupId: `sc-preferred-${match.key}`,
          targetType,
          targetValue,
          targetText: match.targetText,
          signal: "preferred",
          strength,
          confidence,
          sourceJudgmentIndex: index,
          sourceComment: interpretation.sourceText,
          notes: comparison.externalConditionTexts,
        });
      }
    }

    for (const match of dispreferredMatches) {
      const targetType = match.timeSlotKey ? "date_time" : "date";
      const targetValue = match.timeSlotKey ? `${match.dateValue}_${match.timeSlotKey}` : match.dateValue;
      const key = `dispreferred::${match.key}`;

      if (!seen.has(key)) {
        seen.add(key);
        signals.push({
          targetGroupId: `sc-dispreferred-${match.key}`,
          targetType,
          targetValue,
          targetText: match.targetText,
          signal: "dispreferred",
          strength,
          confidence,
          sourceJudgmentIndex: index,
          sourceComment: interpretation.sourceText,
          notes: comparison.externalConditionTexts,
        });
      }
    }
  });

  return signals;
}

function buildAutoInterpretationResultFromSelfConsistency(
  note: string,
  interpretation: FinalInterpretationJson,
  debug: SelfConsistencyDebugBundle | undefined,
  candidates: EventCandidateRecord[],
) {
  const allocateTokenIndex = createSyntheticTokenIndexer();
  const { resolvedCandidateStatuses, preferences, conditions } = buildAvailabilityArtifacts(
    interpretation,
    candidates,
    allocateTokenIndex,
  );
  const comparisonPreferenceSignals = buildComparisonSignals(interpretation, candidates, allocateTokenIndex);
  const ambiguities = interpretation.unresolved.map((item) => `${item.sourceText}: ${item.reason}`);
  const hasAvailabilityArtifacts = resolvedCandidateStatuses.length > 0;
  const hasPreferenceArtifacts = preferences.length > 0 || comparisonPreferenceSignals.length > 0;
  const debugGraphJson = JSON.stringify(
    {
      interpretation,
      debug,
    },
    null,
    2,
  );

  if (!hasAvailabilityArtifacts) {
    return {
      status: "failed",
      sourceComment: note,
      rules: [],
      resolvedCandidateStatuses: [],
      ...(preferences.length > 0 ? { preferences } : {}),
      ...(conditions.length > 0 ? { conditions } : {}),
      ...(comparisonPreferenceSignals.length > 0 ? { comparisonPreferenceSignals } : {}),
      ambiguities,
      failureReason: hasPreferenceArtifacts
        ? "可否ルールは作れませんでしたが、希望情報は抽出できました。"
        : "安全に表示できる自動解釈ルールを作れませんでした。",
      debugGraphJson,
    } satisfies AutoInterpretationResult;
  }

  return {
    status: "success",
    sourceComment: note,
    rules: [],
    resolvedCandidateStatuses,
    ...(preferences.length > 0 ? { preferences } : {}),
    ...(conditions.length > 0 ? { conditions } : {}),
    ...(comparisonPreferenceSignals.length > 0 ? { comparisonPreferenceSignals } : {}),
    ambiguities,
    failureReason: null,
    debugGraphJson,
  } satisfies AutoInterpretationResult;
}

export function projectSelfConsistencyToRankingArtifacts(
  note: string,
  result: SelfConsistencyInterpretationResult,
  candidates: EventCandidateRecord[],
): RankingBridgeArtifacts {
  const autoInterpretation = buildAutoInterpretationResultFromSelfConsistency(
    note,
    result.interpretation,
    result.debug,
    candidates,
  );
  const derived = buildDerivedResponseFromAutoInterpretationResult(autoInterpretation, candidates);

  return {
    answers: derived.answers,
    parsedConstraints: derived.parsedConstraints,
    autoInterpretation,
  };
}
