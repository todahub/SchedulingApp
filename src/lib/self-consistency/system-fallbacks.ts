import { extractCommentTimeFeatures } from "@/lib/comment-target-extractor";
import type { EventCandidateRecord } from "@/lib/domain";
import { getCandidateDateValues } from "@/lib/utils";
import type {
  BaseInterpretationComparisonDraft,
  BaseInterpretationDraft,
  BaseInterpretationEvaluationDraft,
  BaseInterpretationScopeDraft,
} from "./types";

const COMPARISON_MARKER_PATTERN = /より|方が|ほうが|どちら|どっち|なら/u;
const NEGATIVE_AVAILABILITY_PATTERN = /無理|むり|厳し|難し|きつ|ダメ|だめ|不可|NG|嫌|いや|やだ/u;
const POSITIVE_AVAILABILITY_PATTERN = /行け|いけ|参加でき|空い|空いて|大丈夫|OK|おっけ|可能/u;
const WEAK_EXPRESSION_PATTERN = /少し|ちょっと|やや|かも|かな|そう|思う|たぶん/u;
const NEGATIVE_PREFERENCES = new Set(["少し避けたい", "避けたい", "かなり避けたい"]);

function buildEventDateRange(candidates: EventCandidateRecord[]) {
  const dates = [...new Set(candidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );

  return dates.length > 0 ? { start: dates[0]!, end: dates[dates.length - 1]! } : undefined;
}

function containsLoosely(note: string, text: string) {
  return note.replace(/\s+/gu, "").includes(text.replace(/\s+/gu, ""));
}

function expandDateTargetText(note: string, text: string, kind: string) {
  if (kind === "month_part" || kind === "week_ordinal" || kind === "relative_period") {
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const monthPartMatch = note.match(new RegExp(`[0-9０-９]{1,2}月${escapedText}`, "u"));

    if (monthPartMatch) {
      return monthPartMatch[0];
    }
  }

  return text;
}

function buildDateScope(text: string, kind: string, note: string): BaseInterpretationScopeDraft {
  const dateText = expandDateTargetText(note, text, kind);
  const dateType =
    kind === "date_range"
      ? "日付範囲"
      : kind === "weekday"
        ? "曜日"
        : kind === "weekday_group"
          ? "曜日群"
          : kind === "month_part" || kind === "week_ordinal" || kind === "relative_period"
            ? "月の一部"
            : "単日日付";

  return {
    dateText,
    dateType,
    dateMemberTexts: [dateText],
    timeText: "全時間",
    timeType: "全時間",
    placeText: "全場所",
    placeType: "全場所",
  };
}

function isDateLikeTarget(kind: string) {
  return [
    "date",
    "numeric_target_candidate",
    "date_range",
    "weekday",
    "weekday_group",
    "relative_period",
    "month_part",
    "week_ordinal",
  ].includes(kind);
}

function findFallbackComparison(note: string, candidates: EventCandidateRecord[]): BaseInterpretationComparisonDraft | null {
  if (!COMPARISON_MARKER_PATTERN.test(note)) {
    return null;
  }

  const eventDateRange = buildEventDateRange(candidates);
  const targets = extractCommentTimeFeatures(note, eventDateRange ? { eventDateRange } : undefined).targets.filter((target) =>
    isDateLikeTarget(target.kind),
  );
  const uniqueTargets = targets.filter(
    (target, index, array) => array.findIndex((item) => item.text === target.text && item.kind === target.kind) === index,
  );

  if (uniqueTargets.length < 2) {
    return null;
  }

  const afterMarker = note.match(/(?:なら|ならば|だったら)\s*([^、。！？!?]+)/u)?.[1] ?? note;
  const preferredTarget = uniqueTargets.find((target) => containsLoosely(afterMarker, target.text)) ?? uniqueTargets.at(-1);

  if (!preferredTarget) {
    return null;
  }

  return {
    candidateSetText: note.match(/^(.+?)(?:なら|ならば|だったら)/u)?.[1]?.trim() ?? null,
    candidateScopes: uniqueTargets.map((target) => buildDateScope(target.text, target.kind, note)),
    preferredScopeText: preferredTarget.text,
    preference: "行きたい",
    externalConditionTexts: [],
    evidenceText: note,
  };
}

function findFallbackEvaluation(note: string, candidates: EventCandidateRecord[]): BaseInterpretationEvaluationDraft | null {
  const isNegative = NEGATIVE_AVAILABILITY_PATTERN.test(note);
  const isPositive = POSITIVE_AVAILABILITY_PATTERN.test(note);

  if (!isNegative && !isPositive) {
    return null;
  }

  const eventDateRange = buildEventDateRange(candidates);
  const targets = extractCommentTimeFeatures(note, eventDateRange ? { eventDateRange } : undefined).targets;
  const dateTarget = targets.find((target) => isDateLikeTarget(target.kind));

  if (!dateTarget) {
    return null;
  }

  const availability = isNegative ? "行けない" : "行ける";
  const preference = isNegative
    ? WEAK_EXPRESSION_PATTERN.test(note)
      ? "少し避けたい"
      : "避けたい"
    : WEAK_EXPRESSION_PATTERN.test(note)
      ? "少し行きたい"
      : "中立";

  return {
    scope: buildDateScope(dateTarget.text, dateTarget.kind, note),
    availability,
    preference,
    externalConditionTexts: [],
    evidenceText: note,
  };
}

function normalizeEvaluationAvailability(evaluation: BaseInterpretationEvaluationDraft): BaseInterpretationEvaluationDraft {
  if (
    evaluation.availability === "条件付きで行ける" &&
    evaluation.externalConditionTexts.length === 0 &&
    evaluation.preference !== null &&
    NEGATIVE_PREFERENCES.has(evaluation.preference)
  ) {
    return {
      ...evaluation,
      availability: "行けない",
    };
  }

  return evaluation;
}

function removeCoveredUnresolved(draft: BaseInterpretationDraft) {
  const evidenceTexts = [
    ...draft.evaluations.map((evaluation) => evaluation.evidenceText),
    ...draft.comparisons.map((comparison) => comparison.evidenceText),
  ];

  return draft.unresolved.filter(
    (item) => !evidenceTexts.some((evidenceText) => containsLoosely(evidenceText, item.text) || containsLoosely(item.text, evidenceText)),
  );
}

export function applySystemFallbacks(
  note: string,
  draft: BaseInterpretationDraft,
  candidates: EventCandidateRecord[],
): BaseInterpretationDraft {
  const comparisons = [...draft.comparisons];
  const fallbackComparison = comparisons.length === 0 ? findFallbackComparison(note, candidates) : null;
  const fallbackEvaluation = draft.evaluations.length === 0 && fallbackComparison === null ? findFallbackEvaluation(note, candidates) : null;

  if (fallbackComparison) {
    comparisons.push(fallbackComparison);
  }

  const nextDraft = {
    evaluations: [...draft.evaluations, ...(fallbackEvaluation ? [fallbackEvaluation] : [])].map(normalizeEvaluationAvailability),
    comparisons,
    unresolved: draft.unresolved,
  } satisfies BaseInterpretationDraft;

  return {
    ...nextDraft,
    unresolved: removeCoveredUnresolved(nextDraft),
  };
}
