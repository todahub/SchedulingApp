import { requestStructuredJsonFromLlm } from "@/lib/llm-client";
import type { EventCandidateRecord } from "@/lib/domain";
import {
  INTERPRETATION_AVAILABILITIES,
  INTERPRETATION_PREFERENCES,
  INTERPRETATION_TARGET_TYPES,
  type BaseInterpretationComparisonDraft,
  type BaseInterpretationConditionDraft,
  type BaseInterpretationDraft,
  type BaseInterpretationEvaluationDraft,
  type BaseInterpretationTargetDraft,
  type BaseInterpretationUnresolvedDraft,
  type InterpretationLlmOptions,
} from "./types";
import {
  buildBaseInterpretationSchema,
  buildBaseInterpretationSystemPrompt,
  buildBaseInterpretationUserPrompt,
} from "./prompts";

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

  const normalize = (value: string) => value.replace(/\s+/gu, "").trim();
  const normalizedCandidate = normalize(candidate);

  if (!normalizedCandidate) {
    return false;
  }

  return normalize(note).includes(normalizedCandidate);
}

function isTargetType(value: unknown): value is BaseInterpretationTargetDraft["targetType"] {
  return typeof value === "string" && (INTERPRETATION_TARGET_TYPES as readonly string[]).includes(value);
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

function toTargetDraft(value: unknown, note: string): BaseInterpretationTargetDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const targetText = "targetText" in value && typeof value.targetText === "string" ? value.targetText.trim() : "";
  const targetType = "targetType" in value ? value.targetType : null;
  const memberTexts =
    "memberTexts" in value && Array.isArray(value.memberTexts)
      ? value.memberTexts.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [];

  if (!targetText || !isTargetType(targetType) || !containsLoosely(note, targetText)) {
    return null;
  }

  const safeMembers = memberTexts.filter((item) => containsLoosely(note, item));

  return {
    targetText,
    targetType,
    memberTexts: safeMembers.length > 0 ? [...new Set(safeMembers)] : [targetText],
  };
}

function toEvaluationDraft(value: unknown, note: string): BaseInterpretationEvaluationDraft | null {
  const target = toTargetDraft(value, note);
  if (!target || !value || typeof value !== "object") {
    return null;
  }

  const availability = "availability" in value ? value.availability : null;
  const preference = "preference" in value ? value.preference : null;
  const conditionText =
    "conditionText" in value && (typeof value.conditionText === "string" || value.conditionText === null)
      ? value.conditionText
      : null;
  const evidenceText = "evidenceText" in value && typeof value.evidenceText === "string" ? value.evidenceText.trim() : "";

  if (!isAvailability(availability) || !isNullablePreference(preference) || !evidenceText || !containsLoosely(note, evidenceText)) {
    return null;
  }
  if (conditionText !== null && !containsLoosely(note, conditionText)) {
    return null;
  }

  return {
    ...target,
    availability,
    preference,
    conditionText,
    evidenceText,
  };
}

function toComparisonDraft(value: unknown, note: string): BaseInterpretationComparisonDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidateTargets =
    "candidateTargets" in value && Array.isArray(value.candidateTargets)
      ? value.candidateTargets.map((item) => toTargetDraft(item, note)).filter((item): item is BaseInterpretationTargetDraft => Boolean(item))
      : [];
  const candidateSetText =
    "candidateSetText" in value && (typeof value.candidateSetText === "string" || value.candidateSetText === null)
      ? value.candidateSetText
      : null;
  const preferredTargetText =
    "preferredTargetText" in value && typeof value.preferredTargetText === "string" ? value.preferredTargetText.trim() : "";
  const preference = "preference" in value ? value.preference : null;
  const conditionText =
    "conditionText" in value && (typeof value.conditionText === "string" || value.conditionText === null)
      ? value.conditionText
      : null;
  const evidenceText = "evidenceText" in value && typeof value.evidenceText === "string" ? value.evidenceText.trim() : "";

  if (
    candidateTargets.length < 2 ||
    !preferredTargetText ||
    !containsLoosely(note, preferredTargetText) ||
    !isPreference(preference) ||
    !evidenceText ||
    !containsLoosely(note, evidenceText)
  ) {
    return null;
  }
  if (candidateSetText !== null && !containsLoosely(note, candidateSetText)) {
    return null;
  }
  if (conditionText !== null && !containsLoosely(note, conditionText)) {
    return null;
  }

  const validatedPreference = preference as BaseInterpretationComparisonDraft["preference"];

  return {
    candidateSetText,
    candidateTargets,
    preferredTargetText,
    preference: validatedPreference,
    conditionText,
    evidenceText,
  };
}

function toConditionDraft(value: unknown, note: string): BaseInterpretationConditionDraft | null {
  const target = toTargetDraft(value, note);
  if (!target || !value || typeof value !== "object") {
    return null;
  }

  const availability = "availability" in value ? value.availability : null;
  const conditionText = "conditionText" in value && typeof value.conditionText === "string" ? value.conditionText.trim() : "";
  const evidenceText = "evidenceText" in value && typeof value.evidenceText === "string" ? value.evidenceText.trim() : "";

  if (
    !isAvailability(availability) ||
    !conditionText ||
    !evidenceText ||
    !containsLoosely(note, conditionText) ||
    !containsLoosely(note, evidenceText)
  ) {
    return null;
  }

  return {
    ...target,
    availability,
    conditionText,
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
      conditions: [],
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
  const conditions = Array.isArray(record.conditions)
    ? record.conditions.map((item) => toConditionDraft(item, note)).filter((item): item is BaseInterpretationConditionDraft => Boolean(item))
    : [];
  const unresolved = Array.isArray(record.unresolved)
    ? record.unresolved.map((item) => toUnresolvedDraft(item, note)).filter((item): item is BaseInterpretationUnresolvedDraft => Boolean(item))
    : [];

  return {
    evaluations,
    comparisons,
    conditions,
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
