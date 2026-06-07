import { extractCommentTimeFeatures } from "@/lib/comment-target-extractor";
import type { EventCandidateRecord } from "@/lib/domain";
import { getCandidateDateValues } from "@/lib/utils";
import type {
  BaseInterpretationTargetDraft,
  InterpretationTargetType,
  NormalizedTarget,
  NormalizedTargetMember,
} from "./types";

function buildEventDateRange(candidates: EventCandidateRecord[]) {
  const dates = [...new Set(candidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );

  if (dates.length === 0) {
    return undefined;
  }

  return {
    start: dates[0]!,
    end: dates[dates.length - 1]!,
  };
}

function dedupeMembers(members: NormalizedTargetMember[]) {
  const seen = new Set<string>();

  return members.filter((member) => {
    const key = `${member.kind}:${member.value}:${member.sourceText}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mapKindToMember(targetKind: string, text: string, normalizedValue?: string): NormalizedTargetMember {
  switch (targetKind) {
    case "date":
    case "numeric_target_candidate":
      return {
        sourceText: text,
        kind: "日付",
        value: normalizedValue ?? text,
      };
    case "date_range":
      return {
        sourceText: text,
        kind: "日付範囲",
        value: normalizedValue ?? text,
      };
    case "weekday":
      return {
        sourceText: text,
        kind: "曜日",
        value: normalizedValue ?? text,
      };
    case "weekday_group":
      return {
        sourceText: text,
        kind: "曜日群",
        value: normalizedValue ?? text,
      };
    case "time_of_day":
      return {
        sourceText: text,
        kind: "時間帯",
        value: normalizedValue ?? text,
      };
    case "month_part":
      return {
        sourceText: text,
        kind: "期間",
        value: normalizedValue ?? text,
      };
    case "relative_period":
    case "week_ordinal":
    case "holiday_related":
      return {
        sourceText: text,
        kind: "補助",
        value: normalizedValue ?? text,
      };
    default:
      return {
        sourceText: text,
        kind: "補助",
        value: normalizedValue ?? text,
      };
  }
}

function inferTargetType(
  targetText: string,
  fallback: InterpretationTargetType,
  members: NormalizedTargetMember[],
  timeRole: BaseInterpretationTargetDraft["timeRole"],
): InterpretationTargetType {
  const kinds = new Set(members.map((member) => member.kind));
  const dayCount = members.filter((member) => member.kind === "日付").length;
  const hasTime = timeRole === "対象" && kinds.has("時間帯");

  if (members.some((member) => member.kind === "日付範囲")) {
    return hasTime ? "期間と時間帯" : "日付範囲";
  }
  if (dayCount >= 2) {
    return hasTime ? "期間と時間帯" : "複数日付";
  }
  if (dayCount === 1 && hasTime) {
    return "単日日付と時間帯";
  }
  if (kinds.has("曜日群")) {
    return "曜日群";
  }
  if (kinds.has("曜日")) {
    return "曜日";
  }
  if (hasTime) {
    return "時間帯";
  }
  if (/^\s*\d{1,2}月\s*$/u.test(targetText) || /今月|来月|再来月/u.test(targetText)) {
    return "月全体";
  }
  if (/前半|後半|上旬|中旬|下旬/u.test(targetText)) {
    return "月の一部";
  }

  return fallback;
}

export function normalizeTargetDraft(
  draft: BaseInterpretationTargetDraft,
  candidates: EventCandidateRecord[],
): NormalizedTarget {
  const dateRange = buildEventDateRange(candidates);
  const extractionInputs = [
    ...new Set([draft.targetText, ...draft.memberTexts, draft.timeText].filter((item): item is string => Boolean(item))),
  ];
  const extractedTargets = extractionInputs.flatMap((input) =>
    extractCommentTimeFeatures(input, dateRange ? { eventDateRange: dateRange } : undefined).targets,
  );
  const members = dedupeMembers(
    extractedTargets.map((target) => mapKindToMember(target.kind, target.text, target.normalizedValue)),
  );

  if (members.length === 0) {
    return {
      targetText: draft.targetText,
      targetType: draft.targetType,
      memberTexts:
        draft.memberTexts.length > 0
          ? draft.memberTexts
          : [...new Set([draft.targetText, draft.timeText].filter((item): item is string => Boolean(item)))],
      timeText: draft.timeText,
      timeRole: draft.timeRole,
      members: [
        {
          sourceText: draft.targetText,
          kind: "補助",
          value: draft.targetText,
        },
        ...(draft.timeText
          ? [
              {
                sourceText: draft.timeText,
                kind: "時間帯" as const,
                value: draft.timeText,
              },
            ]
          : []),
      ],
      normalizedBy: "llm_fallback",
    };
  }

  return {
    targetText: draft.targetText,
    targetType: inferTargetType(draft.targetText, draft.targetType, members, draft.timeRole),
    memberTexts:
      draft.memberTexts.length > 0
        ? [...new Set(draft.memberTexts)]
        : [...new Set(members.map((member) => member.sourceText))],
    timeText: draft.timeText,
    timeRole: draft.timeRole,
    members,
    normalizedBy: "system",
  };
}
