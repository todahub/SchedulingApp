import { requestStructuredJsonFromLlm } from "@/lib/llm-client";
import type { EventCandidateRecord } from "@/lib/domain";
import {
  INTERPRETATION_AVAILABILITIES,
  INTERPRETATION_DATE_SCOPE_TYPES,
  INTERPRETATION_PLACE_SCOPE_TYPES,
  INTERPRETATION_PREFERENCES,
  INTERPRETATION_TIME_SCOPE_TYPES,
  type BaseInterpretationComparisonDraft,
  type BaseInterpretationDraft,
  type BaseInterpretationEvaluationDraft,
  type BaseInterpretationScopeDraft,
  type BaseInterpretationUnresolvedDraft,
  type InterpretationLlmOptions,
} from "./types";
import {
  buildBaseInterpretationSchema,
  buildBaseInterpretationSystemPrompt,
  buildBaseInterpretationUserPrompt,
} from "./prompts";

const RESERVED_SCOPE_TEXTS = new Set(["全日付", "全時間", "全場所"]);

function parseJson(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("LLM response was empty.");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("LLM response was not valid JSON.");
  }
}

function containsLoosely(note: string, candidate: string | null) {
  if (candidate === null) {
    return true;
  }

  if (RESERVED_SCOPE_TEXTS.has(candidate)) {
    return true;
  }

  const normalize = (value: string) => value.replace(/\s+/gu, "").trim();
  const normalizedCandidate = normalize(candidate);

  if (!normalizedCandidate) {
    return false;
  }

  return normalize(note).includes(normalizedCandidate);
}

function isDateScopeType(value: unknown): value is BaseInterpretationScopeDraft["dateType"] {
  return typeof value === "string" && (INTERPRETATION_DATE_SCOPE_TYPES as readonly string[]).includes(value);
}

function isTimeScopeType(value: unknown): value is BaseInterpretationScopeDraft["timeType"] {
  return typeof value === "string" && (INTERPRETATION_TIME_SCOPE_TYPES as readonly string[]).includes(value);
}

function isPlaceScopeType(value: unknown): value is BaseInterpretationScopeDraft["placeType"] {
  return typeof value === "string" && (INTERPRETATION_PLACE_SCOPE_TYPES as readonly string[]).includes(value);
}

function isAvailability(value: unknown): value is BaseInterpretationEvaluationDraft["availability"] {
  return typeof value === "string" && (INTERPRETATION_AVAILABILITIES as readonly string[]).includes(value);
}

function isPreference(value: unknown): value is BaseInterpretationEvaluationDraft["preference"] {
  return typeof value === "string" && (INTERPRETATION_PREFERENCES as readonly string[]).includes(value);
}

function isNullablePreference(value: unknown): value is BaseInterpretationEvaluationDraft["preference"] {
  return value === null || isPreference(value);
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function toScopeDraft(value: unknown, note: string): BaseInterpretationScopeDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const dateText = "dateText" in value && typeof value.dateText === "string" ? value.dateText.trim() : "";
  const dateType = "dateType" in value ? value.dateType : null;
  const dateMemberTexts = "dateMemberTexts" in value ? toStringArray(value.dateMemberTexts) : [];
  const timeText = "timeText" in value && typeof value.timeText === "string" ? value.timeText.trim() : "";
  const timeType = "timeType" in value ? value.timeType : null;
  const placeText = "placeText" in value && typeof value.placeText === "string" ? value.placeText.trim() : "";
  const placeType = "placeType" in value ? value.placeType : null;

  if (
    !dateText ||
    !timeText ||
    !placeText ||
    !isDateScopeType(dateType) ||
    !isTimeScopeType(timeType) ||
    !isPlaceScopeType(placeType)
  ) {
    return null;
  }

  if (!containsLoosely(note, dateText) || !containsLoosely(note, timeText) || !containsLoosely(note, placeText)) {
    return null;
  }

  if ((dateType === "全日付") !== (dateText === "全日付")) {
    return null;
  }

  if ((timeType === "全時間") !== (timeText === "全時間")) {
    return null;
  }

  if ((placeType === "全場所") !== (placeText === "全場所")) {
    return null;
  }

  const safeDateMembers = dateMemberTexts.filter((item) => containsLoosely(note, item));
  const normalizedDateMembers =
    safeDateMembers.length > 0 ? [...new Set(safeDateMembers)] : [...new Set([dateText])];

  return {
    dateText,
    dateType,
    dateMemberTexts: normalizedDateMembers,
    timeText,
    timeType,
    placeText,
    placeType,
  };
}

function toExternalConditionTexts(value: unknown, note: string) {
  return toStringArray(value).filter((item) => containsLoosely(note, item));
}

function toEvaluationDraft(value: unknown, note: string): BaseInterpretationEvaluationDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const scope = "scope" in value ? toScopeDraft(value.scope, note) : null;
  const availability = "availability" in value ? value.availability : null;
  const preference = "preference" in value ? value.preference : null;
  const externalConditionTexts =
    "externalConditionTexts" in value ? toExternalConditionTexts(value.externalConditionTexts, note) : [];
  const evidenceText = "evidenceText" in value && typeof value.evidenceText === "string" ? value.evidenceText.trim() : "";

  if (
    !scope ||
    !isAvailability(availability) ||
    !isNullablePreference(preference) ||
    !evidenceText ||
    !containsLoosely(note, evidenceText)
  ) {
    return null;
  }

  return {
    scope,
    availability,
    preference,
    externalConditionTexts,
    evidenceText,
  };
}

function toComparisonDraft(value: unknown, note: string): BaseInterpretationComparisonDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidateScopes =
    "candidateScopes" in value && Array.isArray(value.candidateScopes)
      ? value.candidateScopes.map((item) => toScopeDraft(item, note)).filter((item): item is BaseInterpretationScopeDraft => Boolean(item))
      : [];
  const candidateSetText =
    "candidateSetText" in value && (typeof value.candidateSetText === "string" || value.candidateSetText === null)
      ? value.candidateSetText
      : null;
  const preferredScopeText =
    "preferredScopeText" in value && typeof value.preferredScopeText === "string" ? value.preferredScopeText.trim() : "";
  const preference = "preference" in value ? value.preference : null;
  const externalConditionTexts =
    "externalConditionTexts" in value ? toExternalConditionTexts(value.externalConditionTexts, note) : [];
  const evidenceText = "evidenceText" in value && typeof value.evidenceText === "string" ? value.evidenceText.trim() : "";

  if (
    candidateScopes.length < 2 ||
    !preferredScopeText ||
    !containsLoosely(note, preferredScopeText) ||
    !isPreference(preference) ||
    !evidenceText ||
    !containsLoosely(note, evidenceText)
  ) {
    return null;
  }

  if (candidateSetText !== null && !containsLoosely(note, candidateSetText)) {
    return null;
  }

  const validatedPreference = preference as BaseInterpretationComparisonDraft["preference"];

  return {
    candidateSetText,
    candidateScopes,
    preferredScopeText,
    preference: validatedPreference,
    externalConditionTexts,
    evidenceText,
  };
}

function toUnresolvedDraft(value: unknown, note: string): BaseInterpretationUnresolvedDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const text = "text" in value && typeof value.text === "string" ? value.text.trim() : "";
  const reason = "reason" in value && typeof value.reason === "string" ? value.reason.trim() : "";

  if (!text || !reason || !containsLoosely(note, text)) {
    return null;
  }

  return { text, reason };
}

function sanitizeBaseInterpretation(note: string, parsed: unknown): BaseInterpretationDraft {
  if (!parsed || typeof parsed !== "object") {
    return {
      evaluations: [],
      comparisons: [],
      unresolved: [{ text: note, reason: "LLM の初回解釈を構造化できませんでした。" }],
    };
  }

  const record = parsed as Record<string, unknown>;
  const evaluations = Array.isArray(record.evaluations)
    ? record.evaluations.map((item) => toEvaluationDraft(item, note)).filter((item): item is BaseInterpretationEvaluationDraft => Boolean(item))
    : [];
  const comparisons = Array.isArray(record.comparisons)
    ? record.comparisons.map((item) => toComparisonDraft(item, note)).filter((item): item is BaseInterpretationComparisonDraft => Boolean(item))
    : [];
  const unresolved = Array.isArray(record.unresolved)
    ? record.unresolved.map((item) => toUnresolvedDraft(item, note)).filter((item): item is BaseInterpretationUnresolvedDraft => Boolean(item))
    : [];

  return {
    evaluations,
    comparisons,
    unresolved,
  };
}

export async function requestBaseInterpretation(
  note: string,
  candidates: EventCandidateRecord[],
  options: InterpretationLlmOptions,
) {
  const responseText = await requestStructuredJsonFromLlm(options, {
    systemPrompt: buildBaseInterpretationSystemPrompt(),
    userPrompt: buildBaseInterpretationUserPrompt(note, candidates),
    schema: buildBaseInterpretationSchema(),
    temperature: 0.1,
  });

  return sanitizeBaseInterpretation(note, parseJson(responseText));
}
