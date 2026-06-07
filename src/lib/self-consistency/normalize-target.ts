import { extractCommentTimeFeatures } from "@/lib/comment-target-extractor";
import type { EventCandidateRecord } from "@/lib/domain";
import { getCandidateDateValues } from "@/lib/utils";
import type {
  BaseInterpretationScopeDraft,
  NormalizedScope,
  NormalizedScopeMember,
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

function dedupeMembers(members: NormalizedScopeMember[]) {
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

function mapDateKindToMember(targetKind: string, text: string, normalizedValue?: string): NormalizedScopeMember | null {
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
    case "month_part":
      return {
        sourceText: text,
        kind: "期間",
        value: normalizedValue ?? text,
      };
    default:
      return null;
  }
}

function mapTimeKindToMember(targetKind: string, text: string, normalizedValue?: string): NormalizedScopeMember | null {
  if (targetKind !== "time_of_day") {
    return null;
  }

  return {
    sourceText: text,
    kind: "時間帯",
    value: normalizedValue ?? text,
  };
}

function normalizeDateMembers(draft: BaseInterpretationScopeDraft, candidates: EventCandidateRecord[]) {
  if (draft.dateType === "全日付") {
    return {
      members: [
        {
          sourceText: "全日付",
          kind: "補助" as const,
          value: "all_dates",
        },
      ],
      fallbackUsed: false,
    };
  }

  const dateRange = buildEventDateRange(candidates);
  const inputs = [...new Set([draft.dateText, ...draft.dateMemberTexts].filter(Boolean))];
  const extractedTargets = inputs.flatMap((input) =>
    extractCommentTimeFeatures(input, dateRange ? { eventDateRange: dateRange } : undefined).targets,
  );
  const members = dedupeMembers(
    extractedTargets
      .map((target) => mapDateKindToMember(target.kind, target.text, target.normalizedValue))
      .filter((member): member is NormalizedScopeMember => Boolean(member)),
  );

  if (members.length > 0) {
    return { members, fallbackUsed: false };
  }

  return {
    members: [
      {
        sourceText: draft.dateText,
        kind: "補助" as const,
        value: draft.dateText,
      },
    ],
    fallbackUsed: true,
  };
}

function normalizeTimeMembers(draft: BaseInterpretationScopeDraft, candidates: EventCandidateRecord[]) {
  if (draft.timeType === "全時間") {
    return {
      members: [
        {
          sourceText: "全時間",
          kind: "補助" as const,
          value: "all_times",
        },
      ],
      fallbackUsed: false,
    };
  }

  const dateRange = buildEventDateRange(candidates);
  const extractedTargets = extractCommentTimeFeatures(draft.timeText, dateRange ? { eventDateRange: dateRange } : undefined).targets;
  const members = dedupeMembers(
    extractedTargets
      .map((target) => mapTimeKindToMember(target.kind, target.text, target.normalizedValue))
      .filter((member): member is NormalizedScopeMember => Boolean(member)),
  );

  if (members.length > 0) {
    return { members, fallbackUsed: false };
  }

  return {
    members: [
      {
        sourceText: draft.timeText,
        kind: "時間帯" as const,
        value: draft.timeText,
      },
    ],
    fallbackUsed: true,
  };
}

function normalizePlaceMembers(draft: BaseInterpretationScopeDraft) {
  if (draft.placeType === "全場所") {
    return {
      members: [
        {
          sourceText: "全場所",
          kind: "補助" as const,
          value: "all_places",
        },
      ],
      fallbackUsed: false,
    };
  }

  return {
    members: [
      {
        sourceText: draft.placeText,
        kind: "場所" as const,
        value: draft.placeText,
      },
    ],
    fallbackUsed: true,
  };
}

export function normalizeScopeDraft(
  draft: BaseInterpretationScopeDraft,
  candidates: EventCandidateRecord[],
): NormalizedScope {
  const date = normalizeDateMembers(draft, candidates);
  const time = normalizeTimeMembers(draft, candidates);
  const place = normalizePlaceMembers(draft);
  const fallbackUsed = date.fallbackUsed || time.fallbackUsed || place.fallbackUsed;

  return {
    dateText: draft.dateText,
    dateType: draft.dateType,
    dateMemberTexts:
      draft.dateMemberTexts.length > 0 ? [...new Set(draft.dateMemberTexts)] : [...new Set([draft.dateText])],
    dateMembers: date.members,
    timeText: draft.timeText,
    timeType: draft.timeType,
    timeMembers: time.members,
    placeText: draft.placeText,
    placeType: draft.placeType,
    placeMembers: place.members,
    normalizedBy: fallbackUsed ? "llm_fallback" : "system",
  };
}
