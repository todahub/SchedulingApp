import { AVAILABILITY_LEVELS } from "./config";
import type {
  AdjustmentSuggestion,
  AutoInterpretationRule,
  EventCandidateRecord,
  EventDetail,
  ParticipantResponseRecord,
  ParsedCommentConstraint,
  RankedCandidate,
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
  strongly_unavailable: -3,
} as const;

type RankedLabelWeightKey = keyof typeof LABEL_WEIGHTS;
type ResultCandidateSlice = {
  candidate: EventCandidateRecord;
  sourceCandidate: EventCandidateRecord;
  sourceCandidateId: string;
  sourceDateValue: string;
  sourceTimeSlotKey: string;
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

  return sortCandidatesByDate(slices);
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

function getCandidateSortDate(candidate: EventCandidateRecord) {
  return candidate.startDate || candidate.date;
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

export function rankCandidates(detail: EventDetail, mode: ResultMode): RankedCandidate[] {
  const orderedCandidates = buildResultCandidateSlices(detail);
  const responseModes = detail.responses.map((response) => ({
    response,
    interpretationMode: inferResponseInterpretationMode(response, detail.candidates),
  }));

  const ranked = orderedCandidates.map((candidateSlice) => {
    const { candidate } = candidateSlice;
    const statusGroups = Object.fromEntries(AVAILABILITY_LEVELS.map((level) => [level.key, [] as string[]])) as Record<string, string[]>;

    const participantStatuses = responseModes.map(({ response, interpretationMode }) => {
      const status = buildRankedParticipantStatus(response, candidateSlice, detail.candidates, interpretationMode);

      statusGroups[status.availabilityKey].push(response.participantName);

      return status;
    });

    const yesCount = participantStatuses.filter((status) => status.availabilityKey === "yes").length;
    const maybeCount = participantStatuses.filter((status) => status.availabilityKey === "maybe").length;
    const noCount = participantStatuses.filter((status) => status.availabilityKey === "no").length;
    const availableCount = participantStatuses.filter((status) => getRankedLabelWeightKey(status) === "available").length;
    const conditionalCount = participantStatuses.filter((status) => getRankedLabelWeightKey(status) === "conditional_available").length;
    const unknownCount = participantStatuses.filter((status) => getRankedLabelWeightKey(status) === "unknown").length;
    const unavailableCount = participantStatuses.filter((status) => {
      const rankedLabelWeightKey = getRankedLabelWeightKey(status);

      return rankedLabelWeightKey === "unavailable" || rankedLabelWeightKey === "strongly_unavailable";
    }).length;
    const baseScore = participantStatuses.reduce((sum, status) => sum + getRankedLabelWeight(status), 0);
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
    const hasHardNoConstraint = detail.responses.some((response) =>
      hasHardNoConstraintForCandidate(getScoredCommentConstraints(response.parsedConstraints ?? []), candidate),
    );
    const totalScore = baseScore;

    return {
      candidate,
      baseScore,
      commentScore,
      totalScore,
      availableCount,
      conditionalCount,
      unknownCount,
      unavailableCount,
      yesCount,
      maybeCount,
      noCount,
      statusGroups,
      participantStatuses,
      commentImpacts,
      hasHardNoConstraint,
    };
  });

  const filtered = mode === "strict_all" ? ranked.filter((candidate) => candidate.noCount === 0 && !candidate.hasHardNoConstraint) : ranked;

  return filtered.sort((left, right) => {
    if (left.totalScore !== right.totalScore) {
      return right.totalScore - left.totalScore;
    }

    if (left.availableCount !== right.availableCount) {
      return right.availableCount - left.availableCount;
    }

    if (left.conditionalCount !== right.conditionalCount) {
      return right.conditionalCount - left.conditionalCount;
    }

    if (left.unknownCount !== right.unknownCount) {
      return right.unknownCount - left.unknownCount;
    }

    if (left.unavailableCount !== right.unavailableCount) {
      return left.unavailableCount - right.unavailableCount;
    }

    const leftDate = getCandidateSortDate(left.candidate);
    const rightDate = getCandidateSortDate(right.candidate);

    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    return left.candidate.sortOrder - right.candidate.sortOrder;
  });
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
